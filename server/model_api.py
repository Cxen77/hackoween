"""Local model API for the FLOODCAST site (standard library HTTP server, no extra dependencies).

Serves the BASINSHIFT-style forecasting system (models trained on all 55 USGS gauges) to the web app:
  GET /api/health
  GET /api/live_forecast?station=<USGS id>   live 1/3/7-day forecast + 90% interval + exceedance probabilities,
                                              plus a discharge->stage rating fitted from the gauge's own recent readings
  GET /api/run_test?dataset=caravan&n=12     live test on N random Caravan basins the model never saw (<= 30)
Live inputs: USGS daily discharge (last ~70 days), Open-Meteo forecast API weather. Neither needs a key.
Weather note: the forecast API's soil moisture layers are combined into an approximate 0-7 cm value; training used
ERA5-Land 0-7 cm, so live soil moisture is an approximation. Research use only; not a flood warning.

Run from the repo root:  python -m server.model_api   (default port 8765)
The Vite dev server proxies /api to it.
"""
from __future__ import annotations

import argparse
import json
import math
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from solution import read_input
from scripts.basinshift_model import HORIZONS, clim_forecast, evaluate, forecast
from scripts.clean_data import clean_frame
from scripts.external_caravan_eval import load_basins

ROOT = Path(__file__).resolve().parents[1]
UA = {'User-Agent': 'FLOODCAST-hackathon/1.0'}
STATE: dict = {}
LOCK = threading.Lock()
CACHE: dict = {}
CACHE_SECONDS = 600
FT_PER_M = 3.28084


def http_json(url: str, timeout: int = 60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def clean(v):
    """JSON-safe numbers: NaN/inf -> None, numpy -> python."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, np.ndarray)):
        return [clean(x) for x in v]
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def load_state(model_path: Path, train_path: Path, metadata_path: Path) -> None:
    saved = joblib.load(model_path)
    ours, quality = clean_frame(read_input(str(train_path), True), target=True)
    meta = pd.read_csv(metadata_path, dtype={'station_id': str}).set_index('station_id')
    thr = ours.groupby('station_id').discharge_cfs.quantile([0.9, 0.99]).unstack()
    thr.columns = ['T90', 'T99']
    static_cols = ['drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']
    static = ours.sort_values('date').groupby('station_id')[static_cols].last()
    STATE.update(bundle=saved['bundle'], thr=thr, static=static, meta=meta, train_rows=len(ours), quality=quality,
                 stations=sorted(ours.station_id.unique()), model_path=str(model_path))
    print(f"loaded model {model_path.name}; {len(STATE['stations'])} stations, {len(ours):,} training rows", flush=True)


# ------------------------------------------------------------------ live inputs
def recent_discharge(sid: str, days: int = 70) -> pd.Series:
    d = http_json('https://waterservices.usgs.gov/nwis/dv/?' + urllib.parse.urlencode(
        {'format': 'json', 'sites': sid, 'period': f'P{days}D', 'parameterCd': '00060', 'statCd': '00003'}))
    series = d['value']['timeSeries']
    if not series:
        raise ValueError(f'USGS returned no recent daily discharge for {sid}')
    vals = {v['dateTime'][:10]: float(v['value']) for v in series[0]['values'][0]['value'] if float(v['value']) >= 0}
    if len(vals) < 20:
        raise ValueError(f'Only {len(vals)} recent daily values for {sid}; need at least 20')
    s = pd.Series(vals)
    s.index = pd.to_datetime(s.index)
    return s.sort_index()


def recent_weather(lat: float, lon: float, days_back: int = 75, days_ahead: int = 9) -> pd.DataFrame:
    w = http_json('https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
        'latitude': lat, 'longitude': lon, 'past_days': days_back, 'forecast_days': days_ahead, 'timezone': 'auto',
        'daily': 'precipitation_sum,temperature_2m_max,temperature_2m_min',
        'hourly': 'soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm'}))
    daily = pd.DataFrame(w['daily']).rename(columns={'time': 'date', 'precipitation_sum': 'precipitation_mm',
                                                     'temperature_2m_max': 'temp_max_c', 'temperature_2m_min': 'temp_min_c'})
    h = pd.DataFrame(w['hourly'])
    h['date'] = h.time.str[:10]
    # Approximate the 0-7 cm layer: 1 cm + 2 cm + 4 cm of the 3-9 cm layer.
    h['soil_moisture'] = (h.soil_moisture_0_to_1cm + 2 * h.soil_moisture_1_to_3cm + 4 * h.soil_moisture_3_to_9cm) / 7
    soil = h.groupby('date', as_index=False).soil_moisture.mean()
    return daily.merge(soil, on='date', how='left')


def fit_rating(sid: str):
    """Discharge -> gauge height (ft) from this gauge's own last 30 days of instantaneous readings."""
    d = http_json('https://waterservices.usgs.gov/nwis/iv/?' + urllib.parse.urlencode(
        {'format': 'json', 'sites': sid, 'parameterCd': '00060,00065', 'period': 'P30D'}), timeout=90)
    by = {}
    for ts in d['value']['timeSeries']:
        code = ts['variable']['variableCode'][0]['value']
        by[code] = {v['dateTime']: float(v['value']) for v in ts['values'][0]['value'] if float(v['value']) > -999000}
    if '00060' not in by or '00065' not in by:
        return None
    keys = sorted(set(by['00060']) & set(by['00065']))
    pairs = np.array([(by['00060'][k], by['00065'][k]) for k in keys if by['00060'][k] > 0])
    if len(pairs) < 50 or np.ptp(pairs[:, 0]) < 1e-6:
        return None
    lnq, stage = np.log(pairs[:, 0]), pairs[:, 1]
    coef = np.polyfit(lnq, stage, 2)
    fitted = np.polyval(coef, lnq)
    r2 = float(1 - ((stage - fitted) ** 2).sum() / max(((stage - stage.mean()) ** 2).sum(), 1e-9))
    lo, hi = float(np.quantile(lnq, 0.02)), float(np.quantile(lnq, 0.98))
    slope_hi = max(0.0, float(np.polyval(np.polyder(coef), hi)))
    slope_lo = max(0.0, float(np.polyval(np.polyder(coef), lo)))

    def stage_of(q: float):
        x = math.log(max(q, 1e-6))
        if x > hi:
            return float(np.polyval(coef, hi) + slope_hi * (x - hi)), True
        if x < lo:
            return float(np.polyval(coef, lo) - slope_lo * (lo - x)), True
        return float(np.polyval(coef, x)), False

    return {'stage_of': stage_of, 'n': int(len(pairs)), 'r2': r2, 'q_min': float(math.exp(lo)), 'q_max': float(math.exp(hi)),
            'current_stage_ft': float(stage[-1]), 'current_q': float(pairs[-1, 0])}


def live_forecast(sid: str) -> dict:
    if sid not in STATE['stations']:
        raise KeyError(f'Station {sid} is not one of the {len(STATE["stations"])} gauges this model was trained on.')
    hit = CACHE.get(sid)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    meta = STATE['meta'].loc[sid]
    q = recent_discharge(sid)
    last = q.index.max()
    w = recent_weather(float(meta.latitude), float(meta.longitude))
    # Open-Meteo's forecast API keeps only about the last 40 days of weather; start at the first day it has.
    first_wx = pd.to_datetime(w.dropna(subset=['precipitation_mm']).date.min())
    start = max(last - pd.Timedelta(days=59), first_wx)
    days = pd.date_range(start, last + pd.Timedelta(days=max(HORIZONS)))
    frame = pd.DataFrame({'station_id': sid, 'date': days.strftime('%Y-%m-%d')})
    frame = frame.merge(w, on='date', how='left')
    frame['discharge_cfs'] = q.reindex(days).to_numpy()
    for c, v in STATE['static'].loc[sid].items():
        frame[c] = v
    missing_wx = frame[['precipitation_mm', 'temp_max_c', 'temp_min_c', 'soil_moisture']].isna().any(axis=1)
    warnings = []
    if len(days) - max(HORIZONS) < 30:
        warnings.append(f'Only {len(days) - max(HORIZONS)} days of input history are available; accuracy may be reduced.')
    if missing_wx.any():
        warnings.append(f'{int(missing_wx.sum())} day(s) lack weather data; the model treats them as missing.')
    thr = pd.DataFrame({'T90': STATE['thr'].loc[sid, 'T90'], 'T99': STATE['thr'].loc[sid, 'T99']}, index=range(len(frame)))
    rating = None
    try:
        rating = fit_rating(sid)
    except Exception as e:  # rating is optional; forecasts still work
        warnings.append(f'Stage rating unavailable: {e}')
    out = {'station': sid, 'name': str(meta.station_name), 'origin_date': last.strftime('%Y-%m-%d'), 'latest_observed_cfs': float(q.iloc[-1]),
           'threshold_q90_cfs': float(thr.T90.iloc[0]), 'threshold_q99_cfs': float(thr.T99.iloc[0]),
           'recent': [{'date': d.strftime('%Y-%m-%d'), 'cfs': float(v)} for d, v in q.iloc[-30:].items()], 'horizons': [], 'warnings': warnings,
           'sources': ['USGS NWIS daily values', 'Open-Meteo forecast API (weather)', 'FLOODCAST BASINSHIFT-style model trained on 55 USGS gauges'],
           'rating': None if rating is None else {k: rating[k] for k in ('n', 'r2', 'q_min', 'q_max', 'current_stage_ft', 'current_q')}}
    with LOCK:
        for h in HORIZONS:
            o = forecast(STATE['bundle'], frame, '2000-01-01', h, thr_override=thr)
            i = int(np.flatnonzero(frame.date.to_numpy() == (last + pd.Timedelta(days=h)).strftime('%Y-%m-%d'))[0])
            entry = {'horizon_days': h, 'target_date': frame.date.iloc[i], 'point_cfs': float(o['point'][i]),
                     'lo_cfs': float(o['lo'][i]) if not o['fallback'][i] else None, 'hi_cfs': float(o['hi'][i]) if not o['fallback'][i] else None,
                     'p_high_flow': float(o['p90'][i]), 'p_extreme_flow': float(o['p99'][i]), 'persistence_cfs': float(o['persistence'][i]),
                     'used_fallback': bool(o['fallback'][i])}
            if rating:
                for key, val in (('point', entry['point_cfs']), ('lo', entry['lo_cfs']), ('hi', entry['hi_cfs'])):
                    if val is not None:
                        st, extra = rating['stage_of'](val)
                        entry[f'stage_{key}_ft'] = st
                        entry[f'rise_{key}_m'] = round(st / FT_PER_M, 2)
                        if key == 'point':
                            entry['extrapolated'] = extra
            out['horizons'].append(entry)
    out = clean(out)
    CACHE[sid] = (time.time(), out)
    return out


# ------------------------------------------------------------------ live dataset test
def run_caravan_test(n: int, seed: int) -> dict:
    root = ROOT / 'data' / 'external' / 'caravan' / 'Caravan'
    files = sorted((root / 'timeseries' / 'csv' / 'camels').glob('camels_*.csv'))
    if not files:
        raise FileNotFoundError('Caravan data not found under data/external/caravan; see HANDOFF.md to download it.')
    ids = [f.stem.split('_', 1)[1] for f in files if f.stem.split('_', 1)[1] not in set(STATE['stations'])]
    pick = sorted(np.random.default_rng(seed).choice(ids, size=min(n, 30, len(ids)), replace=False).tolist())
    frame, report = clean_frame(load_basins(root, set(STATE['stations']), only=set(pick)), target=True)
    frame = frame[frame.date >= '1995-01-01'].sort_values(['station_id', 'date']).reset_index(drop=True)
    in_test = ((frame.date >= '2010-01-01') & (frame.date <= '2020-12-31')).to_numpy()
    y, area = frame.discharge_cfs.to_numpy(float), frame.drainage_area_sqmi.to_numpy(float)
    clim = clim_forecast(frame, (frame.date < '2010-01-01').to_numpy())
    res = {'dataset': 'caravan_random_subset', 'basins': len(pick), 'seed': seed, 'cleaning': {k: v for k, v in report.items() if k.startswith(('rows', 'dropped', 'clipped'))}, 'horizons': {}}
    with LOCK:
        for h in HORIZONS:
            o = forecast(STATE['bundle'], frame, '2010-01-01', h)
            mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
            rep = evaluate(o, frame, y, mask, STATE['bundle']['horizons'][h], area, True, clim)
            f = rep['forecast']
            res['horizons'][str(h)] = {'rows': rep['rows_scored'], 'blend': f['basinshift_blend'], 'persistence': f['persistence'],
                                       'climatology': f['seasonal_climatology'], 'weather_only': f['weather_only_gbm'],
                                       'interval_coverage': rep.get('interval_90', {}).get('coverage'),
                                       'high_flow_auprc': rep['events']['high_flow_q90']['model'].get('auprc'),
                                       'persistence_high_flow_auprc': rep['events']['high_flow_q90']['persistence_indicator'].get('auprc')}
    return clean(res)


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter
        pass

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        try:
            if url.path == '/api/health':
                self._send(200, {'ok': True, 'model': Path(STATE['model_path']).name, 'stations': STATE['stations'], 'train_rows': STATE['train_rows'],
                                 'horizons': HORIZONS, 'note': 'Research benchmark; not a certified flood warning.'})
            elif url.path == '/api/live_forecast':
                self._send(200, live_forecast(q.get('station', [''])[0]))
            elif url.path == '/api/run_test':
                if q.get('dataset', ['caravan'])[0] != 'caravan':
                    self._send(400, {'error': 'Only dataset=caravan runs live; other tests are precomputed.'})
                else:
                    self._send(200, run_caravan_test(int(q.get('n', ['12'])[0]), int(q.get('seed', ['7'])[0])))
            else:
                self._send(404, {'error': 'Unknown endpoint'})
        except KeyError as e:
            self._send(404, {'error': str(e.args[0])})
        except urllib.error.URLError as e:
            self._send(502, {'error': f'Upstream data source unavailable: {e}'})
        except Exception as e:  # report cleanly to the UI
            self._send(500, {'error': f'{type(e).__name__}: {e}'})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--model', default=str(ROOT / 'data/experiments/basinshift_model/models_caravan.joblib'))
    ap.add_argument('--train', default=str(ROOT / 'data/large/train/train.csv'))
    ap.add_argument('--metadata', default=str(ROOT / 'data/large/metadata/station_metadata.csv'))
    args = ap.parse_args()
    load_state(Path(args.model), Path(args.train), Path(args.metadata))
    print(f'Model API on http://{args.host}:{args.port}  (try /api/health)', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
