"""Local model API for the FLOODCAST site (standard library HTTP server, no extra dependencies).

Serves the BASINSHIFT-style forecasting system (models trained on all 55 USGS gauges) to the web app:
  GET /api/health
  GET /api/live_forecast?lat=..&lon=..&name=..   same for a NEW river with no gauge (GloFAS modelled flow as history)
  GET /api/live_forecast?india=<registry key>   Indian gauge with a live NWIC feed (observed flow as history; model-vs-observed hindcast)
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
import os
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
from scripts.basinshift_model import clim_forecast, evaluate, forecast
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
    """Load the model plus the small per-gauge facts it needs. Prefers model_meta.json (sits next to the model, so the
    dataset is NOT required); falls back to computing the same facts from the training CSV."""
    saved = joblib.load(model_path)
    meta_file = model_path.with_name('model_meta.json')
    if meta_file.exists():
        m = json.loads(meta_file.read_text(encoding='utf-8'))
        thr = pd.DataFrame(m['thresholds']).T.astype(float)
        static = pd.DataFrame(m['static']).T.astype(float)
        meta = pd.DataFrame(m['stations']).T.astype({'latitude': float, 'longitude': float})
        train_rows, quality, stations, source = m['train_rows'], m['quality'], sorted(m['thresholds']), meta_file.name
    else:
        ours, quality = clean_frame(read_input(str(train_path), True), target=True)
        meta = pd.read_csv(metadata_path, dtype={'station_id': str}).set_index('station_id')
        thr = ours.groupby('station_id').discharge_cfs.quantile([0.9, 0.99]).unstack()
        thr.columns = ['T90', 'T99']
        static_cols = ['drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']
        static = ours.sort_values('date').groupby('station_id')[static_cols].last()
        train_rows, stations, source = len(ours), sorted(ours.station_id.unique()), 'training CSV'
    # Large rivers use a model trained on the USGS gauges only (best for them in the held-out comparison, scripts/route_by_size.py).
    large_path = next((model_path.with_name(n) for n in ('models_large.joblib', 'models_caravan.joblib') if model_path.with_name(n).exists() and model_path.with_name(n) != model_path), None)
    large = joblib.load(large_path)['bundle'] if large_path else None
    STATE.update(bundle_large=large, large_model=large_path.name if large_path else None)
    STATE.update(horizons=sorted(saved['bundle']['horizons']), bundle=saved['bundle'], thr=thr, static=static, meta=meta, train_rows=train_rows, quality=quality,
                 stations=stations, model_path=str(model_path))
    print(f"loaded model {model_path.name} (gauge facts from {source}); {len(stations)} stations, {train_rows:,} training rows", flush=True)


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

    return {'stage_of': stage_of, 'median_stage_ft': float(np.median(stage)), 'n': int(len(pairs)), 'r2': r2, 'q_min': float(math.exp(lo)), 'q_max': float(math.exp(hi)),
            'current_stage_ft': float(stage[-1]), 'current_q': float(pairs[-1, 0])}


def rule_rise(q_cfs: float, ref_cfs: float) -> float:
    """Rough rise in metres of the water surface when flow goes from the reference (normal) flow to q. Rule of thumb
    h ~ (Q/300 m3/s)^0.42, as used elsewhere in the app for ungauged rivers. Never negative."""
    f = lambda c: (max(c, 1e-6) / CFS_PER_M3S / 300.0) ** 0.42
    return round(float(min(22.0, max(0.0, f(q_cfs) - f(ref_cfs)))), 2)


def live_forecast(sid: str, choice: str = 'auto') -> dict:
    if sid not in STATE['stations']:
        raise KeyError(f'Station {sid} is not one of the {len(STATE["stations"])} gauges this model was trained on.')
    hit = CACHE.get((sid, choice))
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    meta = STATE['meta'].loc[sid]
    q = recent_discharge(sid)
    last = q.index.max()
    ref_flow = float(q.iloc[-30:].median())  # the river's normal level: median of the last 30 days
    w = recent_weather(float(meta.latitude), float(meta.longitude))
    # Open-Meteo's forecast API keeps only about the last 40 days of weather; start at the first day it has.
    first_wx = pd.to_datetime(w.dropna(subset=['precipitation_mm']).date.min())
    start = max(last - pd.Timedelta(days=59), first_wx)
    days = pd.date_range(start, last + pd.Timedelta(days=max(STATE['horizons'])))
    frame = pd.DataFrame({'station_id': sid, 'date': days.strftime('%Y-%m-%d')})
    frame = frame.merge(w, on='date', how='left')
    frame['discharge_cfs'] = q.reindex(days).to_numpy()
    for c, v in STATE['static'].loc[sid].items():
        frame[c] = v
    missing_wx = frame[['precipitation_mm', 'temp_max_c', 'temp_min_c', 'soil_moisture']].isna().any(axis=1)
    warnings = []
    if len(days) - max(STATE['horizons']) < 30:
        warnings.append(f"Only {len(days) - max(STATE['horizons'])} days of input history are available; accuracy may be reduced.")
    # Only warn about gaps that can matter: the last 30 days before the forecast origin and the forecast days. A gap in the
    # oldest part of the window (e.g. the first day's soil moisture, which the weather API publishes a day late) is harmless.
    relevant = missing_wx.to_numpy() & (pd.to_datetime(frame.date) > last - pd.Timedelta(days=30)).to_numpy()
    if relevant.any():
        warnings.append(f'{int(relevant.sum())} recent or forecast day(s) lack weather data; the model treats them as missing.')
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
           'rating': None if rating is None else {k: rating[k] for k in ('n', 'r2', 'q_min', 'q_max', 'current_stage_ft', 'current_q', 'median_stage_ft')}}
    out['rain_forecast'] = [{'date': r.date, 'mm': None if pd.isna(r.precipitation_mm) else float(r.precipitation_mm)}
                            for r in frame[frame.date > last.strftime('%Y-%m-%d')].itertuples()]
    with LOCK:
        bundle, used = pick_bundle(frame, choice)
        out['model_used'] = used
        for h in STATE['horizons']:
            o = forecast(bundle, frame, '2000-01-01', h, thr_override=thr)
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
                        # Rise above the reference river surface (the gauge's 30-day median stage), never negative.
                        entry[f'rise_{key}_m'] = round(max(0.0, (st - rating['median_stage_ft']) / FT_PER_M), 2)
                        if key == 'point':
                            entry['extrapolated'] = extra
            if not rating:  # no stage gauge: rule-of-thumb rise of the forecast flow above its normal flow
                entry['rise_point_m'] = rule_rise(entry['point_cfs'], ref_flow)
                entry['rise_is_rule_of_thumb'] = True
            out['horizons'].append(entry)
    out['reference_flow_cfs'] = ref_flow
    out['live_flow_cfs'] = float(q.iloc[-1])
    out['live_last_date'] = q.index.max().strftime('%Y-%m-%d')
    if rating:
        out['live_rise_m'] = round(max(0.0, (rating['current_stage_ft'] - rating['median_stage_ft']) / FT_PER_M), 2)
        out['live_rise_basis'] = 'live gauge height above its 30-day median'
    else:
        out['live_rise_m'] = rule_rise(float(q.iloc[-1]), ref_flow)
        out['live_rise_basis'] = 'estimated from today\'s flow compared with its 30-day median (no stage gauge)'
    out = clean(out)
    CACHE[(sid, choice)] = (time.time(), out)
    return out



# ------------------------------------------------------------------ new rivers (not in training data)
SNAP_CACHE: dict = {}
CFS_PER_M3S = 35.3146667


def snap_to_river(lat: float, lon: float) -> dict:
    """GloFAS uses a ~0.05 degree grid, so a map point can land beside the river. Look at a 7x7 neighbourhood
    (about +/-0.15 degrees) and use the cell with the largest recent discharge, i.e. the main channel."""
    key = (round(lat, 3), round(lon, 3))
    if key in SNAP_CACHE:
        return SNAP_CACHE[key]
    offs = [round(i * 0.05, 2) for i in range(-3, 4)]
    pts = [(round(lat + a, 3), round(lon + b, 3)) for a in offs for b in offs]
    d = http_json('https://flood-api.open-meteo.com/v1/flood?' + urllib.parse.urlencode({
        'latitude': ','.join(str(p[0]) for p in pts), 'longitude': ','.join(str(p[1]) for p in pts),
        'daily': 'river_discharge', 'past_days': 14, 'forecast_days': 1}))
    d = d if isinstance(d, list) else [d]
    means = []
    for r in d:
        vals = [v for v in r['daily']['river_discharge'] if v is not None]
        means.append(float(np.mean(vals)) if vals else 0.0)
    best = int(np.argmax(means))
    centre = means[len(means) // 2]  # the middle point of the 7x7 grid is the requested location
    out = {'lat': pts[best][0], 'lon': pts[best][1], 'mean_m3s': means[best], 'original_mean_m3s': centre}
    SNAP_CACHE[key] = out
    return out


def live_forecast_new(lat: float, lon: float, name: str, choice: str = 'auto') -> dict:
    """Forecast for a river the model was NOT trained on. There is no gauge record here, so the flow history is GloFAS
    modelled discharge (Open-Meteo flood API). This is a transfer test, not a verified forecast."""
    ck = ('new', round(lat, 3), round(lon, 3), choice)
    hit = CACHE.get(ck)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    snap = snap_to_river(lat, lon)
    slat, slon = snap['lat'], snap['lon']
    recent = http_json('https://flood-api.open-meteo.com/v1/flood?' + urllib.parse.urlencode({
        'latitude': slat, 'longitude': slon, 'daily': 'river_discharge', 'past_days': 60, 'forecast_days': 8}))
    hist = http_json('https://flood-api.open-meteo.com/v1/flood?' + urllib.parse.urlencode({
        'latitude': slat, 'longitude': slon, 'daily': 'river_discharge', 'start_date': '2015-01-01', 'end_date': '2024-12-31'}))
    gl = pd.Series(recent['daily']['river_discharge'], index=pd.to_datetime(recent['daily']['time'])).dropna()
    hq = np.array([v for v in hist['daily']['river_discharge'] if v is not None], float) * CFS_PER_M3S
    if len(hq) < 1000 or gl.empty:
        raise ValueError('GloFAS returned too little data for this location.')
    last = pd.Timestamp(date.today() - timedelta(days=1))
    obs = gl[gl.index <= last] * CFS_PER_M3S
    last = obs.index.max()
    ref_flow = float(obs.iloc[-30:].median())  # the river's normal level: median of the last 30 days
    glofas_fc = gl[gl.index > last] * CFS_PER_M3S
    w = recent_weather(lat, lon)
    first_wx = pd.to_datetime(w.dropna(subset=['precipitation_mm']).date.min())
    start = max(last - pd.Timedelta(days=59), first_wx)
    days = pd.date_range(start, last + pd.Timedelta(days=max(STATE['horizons'])))
    frame = pd.DataFrame({'station_id': 'NEW', 'date': days.strftime('%Y-%m-%d')}).merge(w, on='date', how='left')
    frame['discharge_cfs'] = obs.reindex(days).to_numpy()
    for c in ('drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct'):
        frame[c] = np.nan  # no catchment attributes supplied for a new river; the model handles missing values
    thr = pd.DataFrame({'T90': float(np.quantile(hq, 0.9)), 'T99': float(np.quantile(hq, 0.99))}, index=range(len(frame)))
    warnings = ['New river: not in the training data. Flow history is GloFAS modelled discharge (no gauge record), so this is a transfer test and the numbers are unverified.']
    if snap['mean_m3s'] > 2 * max(snap['original_mean_m3s'], 1e-6):
        warnings.append(f"The map point was moved to the main river channel in GloFAS's grid ({slat}, {slon}); the original cell carried only {snap['original_mean_m3s']:.1f} m3/s.")
    if len(days) - max(STATE['horizons']) < 30:
        warnings.append(f"Only {len(days) - max(STATE['horizons'])} days of input history are available; accuracy may be reduced.")
    out = {'station': name, 'name': name, 'new_river': True, 'origin_date': last.strftime('%Y-%m-%d'), 'latest_observed_cfs': float(obs.iloc[-1]),
           'threshold_q90_cfs': float(thr.T90.iloc[0]), 'threshold_q99_cfs': float(thr.T99.iloc[0]), 'snapped_to': [slat, slon],
           'recent': [{'date': d.strftime('%Y-%m-%d'), 'cfs': float(v)} for d, v in obs.iloc[-30:].items()], 'horizons': [], 'warnings': warnings, 'rating': None,
           'sources': ['GloFAS modelled river discharge via Open-Meteo flood API', 'Open-Meteo forecast API (weather)', 'FLOODCAST BASINSHIFT-style model trained on 55 US USGS gauges']}
    out['rain_forecast'] = [{'date': r.date, 'mm': None if pd.isna(r.precipitation_mm) else float(r.precipitation_mm)}
                            for r in frame[frame.date > last.strftime('%Y-%m-%d')].itertuples()]
    with LOCK:
        bundle, used = pick_bundle(frame, choice)
        out['model_used'] = used
        for h in STATE['horizons']:
            o = forecast(bundle, frame, '2000-01-01', h, thr_override=thr)
            tgt = last + pd.Timedelta(days=h)
            i = int(np.flatnonzero(frame.date.to_numpy() == tgt.strftime('%Y-%m-%d'))[0])
            q_m3s = float(o['point'][i]) / CFS_PER_M3S
            entry = {'horizon_days': h, 'target_date': frame.date.iloc[i], 'point_cfs': float(o['point'][i]),
                     'lo_cfs': float(o['lo'][i]) if not o['fallback'][i] else None, 'hi_cfs': float(o['hi'][i]) if not o['fallback'][i] else None,
                     'p_high_flow': float(o['p90'][i]), 'p_extreme_flow': float(o['p99'][i]), 'persistence_cfs': float(o['persistence'][i]),
                     'used_fallback': bool(o['fallback'][i]), 'glofas_forecast_cfs': float(glofas_fc.get(tgt, np.nan)),
                     # Same rough flow->water-rise rule the map already uses for ungauged rivers.
                     'rise_point_m': rule_rise(float(o['point'][i]), ref_flow), 'rise_is_rule_of_thumb': True, 'extrapolated': False}
            out['horizons'].append(entry)
    out['reference_flow_cfs'] = ref_flow
    out['live_flow_cfs'] = float(obs.iloc[-1])
    out['live_last_date'] = obs.index.max().strftime('%Y-%m-%d')
    out['live_rise_m'] = rule_rise(float(obs.iloc[-1]), ref_flow)
    out['live_rise_basis'] = 'estimated from today\'s flow compared with its 30-day median (no stage gauge)'
    out = clean(out)
    CACHE[ck] = (time.time(), out)
    return out



# ------------------------------------------------------------------ Indian rivers with a live NWIC feed (new rivers)
NWIC_BASE = 'https://nwdp.nwic.gov.in/api/3/action/'


def india_registry() -> dict:
    if 'india' not in STATE:
        path = ROOT / 'server' / 'india_stations.json'
        data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'stations': []}
        STATE['india'] = {s['key']: s for s in data['stations']}
    return STATE['india']


def nwic_recent_daily(station: dict) -> pd.Series:
    """Daily mean discharge (cfs) for the station from the portal's live 2026 table. Portal units are m3/sec."""
    flt = json.dumps({'Station': station['station']})
    url = NWIC_BASE + 'datastore_search?' + urllib.parse.urlencode({'resource_id': station['resource_id'], 'filters': flt, 'limit': 32000})
    rows = http_json(url, timeout=120)['result']['records']
    if not rows:
        raise ValueError('The portal returned no recent rows for this station.')
    d = pd.DataFrame(rows)
    col = next(c for c in d.columns if 'discharge' in c.lower())
    tim = next(c for c in d.columns if 'time' in c.lower() or 'date' in c.lower())
    s = pd.Series(pd.to_numeric(d[col], errors='coerce').to_numpy(), index=pd.to_datetime(d[tim], format='%d-%m-%Y %H:%M', errors='coerce'))
    s = s[s.index.notna() & s.notna() & (s >= 0)]
    s = s.groupby(s.index.floor('D')).mean() * CFS_PER_M3S
    if len(s) < 30:
        raise ValueError(f'Only {len(s)} recent daily values for this station.')
    return s.sort_index()


def live_forecast_india(key: str, choice: str = 'auto') -> dict:
    reg = india_registry()
    if key not in reg:
        raise KeyError(f'Station {key} is not in the Indian live-feed registry.')
    hit = CACHE.get(('in', key, choice))
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    st = reg[key]
    obs = nwic_recent_daily(st)
    last = obs.index.max()
    ref_flow = float(obs.iloc[-30:].median())  # the river's normal level: median of the last 30 days
    w = recent_weather(st['lat'], st['lon'])
    first_wx = pd.to_datetime(w.dropna(subset=['precipitation_mm']).date.min())
    start = max(last - pd.Timedelta(days=59), first_wx)
    days = pd.date_range(start, last + pd.Timedelta(days=max(STATE['horizons'])))
    frame = pd.DataFrame({'station_id': st['key'], 'date': days.strftime('%Y-%m-%d')}).merge(w, on='date', how='left')
    frame['discharge_cfs'] = obs.reindex(days).to_numpy()
    for c in ('drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct'):
        frame[c] = np.nan  # catchment attributes are not supplied for these gauges
    thr = pd.DataFrame({'T90': st['threshold_q90_cfs'], 'T99': st['threshold_q99_cfs']}, index=range(len(frame)))
    warnings = ['New river: this gauge is not in the training data (the model was trained on 55 US gauges). Treat results as a transfer test.']
    stale = (pd.Timestamp.today().normalize() - last).days
    if stale > 3:
        warnings.append(f'The latest NWIC value is {stale} days old (last reading {last.strftime("%Y-%m-%d")}); forecasts start from that date.')
    if len(days) - max(STATE['horizons']) < 30:
        warnings.append(f"Only {len(days) - max(STATE['horizons'])} days of input history are available.")
    out = {'station': key, 'name': f"{st['station']} ({st['river']})", 'new_river': True, 'origin_date': last.strftime('%Y-%m-%d'),
           'latest_observed_cfs': float(obs.iloc[-1]), 'threshold_q90_cfs': st['threshold_q90_cfs'], 'threshold_q99_cfs': st['threshold_q99_cfs'],
           'recent': [{'date': d.strftime('%Y-%m-%d'), 'cfs': float(v)} for d, v in obs.iloc[-30:].items()], 'horizons': [], 'warnings': warnings,
           'rating': None, 'sources': ['NWIC National Water Data Portal: CWC manual daily discharge (m3/sec, converted to cfs)', 'Open-Meteo forecast API (weather)',
                                       'FLOODCAST BASINSHIFT-style model trained on 55 US USGS gauges'],
           'hindcast': {'window_days': 30, 'horizons': {}, 'series': {}}}
    out['rain_forecast'] = [{'date': r.date, 'mm': None if pd.isna(r.precipitation_mm) else float(r.precipitation_mm)}
                            for r in frame[frame.date > last.strftime('%Y-%m-%d')].itertuples()]
    with LOCK:
        bundle, used = pick_bundle(frame, choice)
        out['model_used'] = used
        for h in STATE['horizons']:
            o = forecast(bundle, frame, '2000-01-01', h, thr_override=thr)
            tgt = last + pd.Timedelta(days=h)
            i = int(np.flatnonzero(frame.date.to_numpy() == tgt.strftime('%Y-%m-%d'))[0])
            q_m3s = float(o['point'][i]) / CFS_PER_M3S
            out['horizons'].append({'horizon_days': h, 'target_date': frame.date.iloc[i], 'point_cfs': float(o['point'][i]),
                                    'lo_cfs': float(o['lo'][i]) if not o['fallback'][i] else None, 'hi_cfs': float(o['hi'][i]) if not o['fallback'][i] else None,
                                    'p_high_flow': float(o['p90'][i]), 'p_extreme_flow': float(o['p99'][i]), 'persistence_cfs': float(o['persistence'][i]),
                                    'used_fallback': bool(o['fallback'][i]),
                                    'rise_point_m': rule_rise(float(o['point'][i]), ref_flow), 'rise_is_rule_of_thumb': True, 'extrapolated': False})
            # Hindcast: forecasts the model would have made for each of the last 30 observed days, scored against NWIC.
            ts = pd.to_datetime(frame.date)
            win = (ts > last - pd.Timedelta(days=30)) & (ts <= last)
            actual = frame.discharge_cfs.to_numpy()
            ok = win.to_numpy() & ~np.isnan(actual) & ~np.isnan(o['persistence']) & ~np.isnan(o['point'])
            if ok.sum() >= 8:
                a, m, p = actual[ok], o['point'][ok], o['persistence'][ok]
                rm = lambda x: float(np.sqrt(np.mean((a - x) ** 2)))
                mae = lambda x: float(np.mean(np.abs(a - x)))
                out['hindcast']['horizons'][str(h)] = {'n': int(ok.sum()), 'rmse_model': rm(m), 'rmse_persistence': rm(p), 'mae_model': mae(m), 'mae_persistence': mae(p),
                                                       'rmse_ratio': rm(m) / max(rm(p), 1e-9)}
                out['hindcast']['series'][str(h)] = {'dates': frame.date[ok].tolist(), 'observed': a.tolist(), 'model': m.tolist(), 'persistence': p.tolist()}
    out['reference_flow_cfs'] = ref_flow
    out['live_flow_cfs'] = float(obs.iloc[-1])
    out['live_last_date'] = obs.index.max().strftime('%Y-%m-%d')
    out['live_rise_m'] = rule_rise(float(obs.iloc[-1]), ref_flow)
    out['live_rise_basis'] = 'estimated from today\'s flow compared with its 30-day median (no stage gauge)'
    out = clean(out)
    CACHE[('in', key, choice)] = (time.time(), out)
    return out


# ------------------------------------------------------------------ live dataset test
def run_caravan_test(n: int, seed: int) -> dict:
    root = ROOT / 'data' / 'external' / 'caravan' / 'Caravan'
    files = sorted((root / 'timeseries' / 'csv' / 'camels').glob('camels_*.csv'))
    if not files:
        raise FileNotFoundError('Caravan data not found under data/external/caravan; see HANDOFF.md to download it.')
    ids = [f.stem.split('_', 1)[1] for f in files if f.stem.split('_', 1)[1] not in set(STATE['stations'])]
    held_file = Path(STATE['model_path']).with_name('holdout_ids.json')
    if held_file.exists():  # only basins the served models never trained on, so the test stays honest
        held = set(json.loads(held_file.read_text(encoding='utf-8'))['caravan_basins'])
        ids = [i for i in ids if i in held]
    pick = sorted(np.random.default_rng(seed).choice(ids, size=min(n, 30, len(ids)), replace=False).tolist())
    frame, report = clean_frame(load_basins(root, set(STATE['stations']), only=set(pick)), target=True)
    frame = frame[frame.date >= '1995-01-01'].sort_values(['station_id', 'date']).reset_index(drop=True)
    in_test = ((frame.date >= '2010-01-01') & (frame.date <= '2020-12-31')).to_numpy()
    y, area = frame.discharge_cfs.to_numpy(float), frame.drainage_area_sqmi.to_numpy(float)
    clim = clim_forecast(frame, (frame.date < '2010-01-01').to_numpy())
    res = {'dataset': 'caravan_random_subset', 'basins': len(pick), 'seed': seed, 'cleaning': {k: v for k, v in report.items() if k.startswith(('rows', 'dropped', 'clipped'))}, 'horizons': {}}
    with LOCK:
        for h in STATE['horizons']:
            o = routed_forecast(frame, '2010-01-01', h)
            mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
            rep = evaluate(o, frame, y, mask, STATE['bundle']['horizons'][h], area, True, clim)
            f = rep['forecast']
            res['horizons'][str(h)] = {'rows': rep['rows_scored'], 'blend': f['basinshift_blend'], 'persistence': f['persistence'],
                                       'climatology': f['seasonal_climatology'], 'weather_only': f['weather_only_gbm'],
                                       'interval_coverage': rep.get('interval_90', {}).get('coverage'),
                                       'high_flow_auprc': rep['events']['high_flow_q90']['model'].get('auprc'),
                                       'persistence_high_flow_auprc': rep['events']['high_flow_q90']['persistence_indicator'].get('auprc')}
    return clean(res)


def caravan_test_available() -> bool:
    root = ROOT / 'data/external/caravan/Caravan/timeseries/csv/camels'
    return next(root.glob('camels_*.csv'), None) is not None


# ------------------------------------------------------------------ HTTP
LARGE_SQMI = 10000.0  # catchments at least this large use the USGS-gauge model; smaller ones use the gauges + Caravan model


MODEL_CHOICES = {
    'auto': 'routed by river size (served default)',
    'mixed': 'gauges + Caravan model for every river',
    'gauge': 'USGS-gauge model for every river (falls back to the mixed model if it is not loaded)',
}


def pick_bundle(frame: pd.DataFrame, choice: str = 'auto'):
    """(bundle, model file name) for a catchment. choice: 'auto' routes by drainage area; 'mixed' always uses the
    gauges + Caravan model; 'gauge' always uses the USGS-gauge model when it is loaded."""
    if choice not in MODEL_CHOICES:
        raise ValueError(f"model must be one of {sorted(MODEL_CHOICES)}")
    large_ok = STATE.get('bundle_large') is not None and set(STATE['bundle_large']['horizons']) >= set(STATE['horizons'])
    if choice == 'mixed' or (choice == 'gauge' and not large_ok):
        return STATE['bundle'], Path(STATE['model_path']).name
    if choice == 'gauge':
        return STATE['bundle_large'], STATE['large_model']
    area = float(frame.drainage_area_sqmi.iloc[0]) if 'drainage_area_sqmi' in frame and len(frame) else float('nan')
    if large_ok and area >= LARGE_SQMI:
        return STATE['bundle_large'], STATE['large_model']
    return STATE['bundle'], Path(STATE['model_path']).name


def routed_forecast(frame: pd.DataFrame, ref_cut: str, h: int) -> dict:
    """forecast() with each row sent to the model its catchment size selects (same rule as pick_bundle)."""
    a = forecast(STATE['bundle'], frame, ref_cut, h)
    large = STATE.get('bundle_large')
    big = frame.drainage_area_sqmi.to_numpy(float) >= LARGE_SQMI
    if large is None or h not in large['horizons'] or not big.any():
        return a
    b = forecast(large, frame, ref_cut, h)
    o = {}
    for k, v in a.items():
        if k == 'thr':
            o[k] = v.where(~pd.Series(big), b[k])
        elif v.ndim == 1:
            o[k] = np.where(big, b[k], v)
        else:
            bq = b[k][:, [0, -1]] if b[k].shape[1] != v.shape[1] else b[k]  # keep the outer two quantiles
            o[k] = np.where(big[:, None], bq, v)
    return o


def with_model(result: dict) -> dict:
    """Label a live forecast with the model file that produced it (so a stale server is obvious in the UI)."""
    out = dict(result)
    out['model'] = out.pop('model_used', None) or Path(STATE['model_path']).name
    out['model_routing'] = f"catchments of {LARGE_SQMI:,.0f} sq mi or more use {STATE['large_model']}" if STATE.get('bundle_large') is not None else None
    out['model_horizons'] = STATE['horizons']
    return out


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
                                 'horizons': STATE['horizons'], 'large_model': STATE.get('large_model'), 'large_from_sqmi': LARGE_SQMI, 'model_choices': MODEL_CHOICES,
                                 'capabilities': {'live_forecast': True, 'caravan_live_test': caravan_test_available()},
                                 'note': 'Research benchmark; not a certified flood warning.'})
            elif url.path == '/api/live_forecast':
                choice = q.get('model', ['auto'])[0]
                if choice not in MODEL_CHOICES:
                    self._send(400, {'error': f"model must be one of {sorted(MODEL_CHOICES)}"})
                elif 'india' in q:
                    self._send(200, with_model(live_forecast_india(q['india'][0], choice)))
                elif 'lat' in q and 'lon' in q:
                    self._send(200, with_model(live_forecast_new(float(q['lat'][0]), float(q['lon'][0]), q.get('name', ['New river'])[0][:80], choice)))
                else:
                    self._send(200, with_model(live_forecast(q.get('station', [''])[0], choice)))
            elif url.path == '/api/run_test':
                if q.get('dataset', ['caravan'])[0] != 'caravan':
                    self._send(400, {'error': 'Only dataset=caravan runs live; other tests are precomputed.'})
                elif not caravan_test_available():
                    self._send(503, {'error': 'Live benchmark reruns are unavailable on this deployment. Saved results remain available.'})
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
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8765')))
    ap.add_argument('--host', default='0.0.0.0' if os.environ.get('PORT') else '127.0.0.1')
    daily = ROOT / 'data/experiments/basinshift_model/models_daily.joblib'
    ap.add_argument('--model', default=str(daily if daily.exists() else ROOT / 'data/experiments/basinshift_model/models_caravan.joblib'),
                    help='trained model bundle (models_daily.joblib = horizons +1..+7 if present, else models_caravan.joblib = +1/+3/+7)')
    ap.add_argument('--train', default=str(ROOT / 'data/large/train/train.csv'))
    ap.add_argument('--metadata', default=str(ROOT / 'data/large/metadata/station_metadata.csv'))
    args = ap.parse_args()
    load_state(Path(args.model), Path(args.train), Path(args.metadata))
    print(f'Model API on http://{args.host}:{args.port}  (try /api/health)', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
