"""Build data/large_plus: original 55-station data + vetted extra USGS stations.

Why NASA POWER: Open-Meteo's daily quota was exhausted. New stations therefore use NASA POWER daily weather
(PRECTOTCORR, T2M_MAX, T2M_MIN, GWETTOP), calibrated to the Open-Meteo scale by quantile mapping fitted ONLY on
training-period rows (<= 2024-12-31) of the original stations. No discharge enters the calibration.
This mixes two weather sources; it must be declared in model_card.md if used, and the experiment is gated.

Usage: python -m scripts.build_plus_dataset
"""
from __future__ import annotations

import argparse
import json
import shutil
import threading
from argparse import Namespace
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import pandas as pd

from scripts import download_catchments
from scripts.download_data import fetch, parse_rdb

POWER = ['PRECTOTCORR', 'T2M_MAX', 'T2M_MIN', 'GWETTOP']
TARGETS = {'PRECTOTCORR': 'precipitation_mm', 'T2M_MAX': 'temp_max_c', 'T2M_MIN': 'temp_min_c', 'GWETTOP': 'soil_moisture'}
START, END = '2010-01-01', '2025-12-31'
lock = threading.Lock()


def power_weather(sid: str, lat: float, lon: float, raw: Path) -> pd.DataFrame:
    url = 'https://power.larc.nasa.gov/api/temporal/daily/point?' + urlencode({
        'parameters': ','.join(POWER), 'community': 'AG', 'longitude': lon, 'latitude': lat,
        'start': START.replace('-', ''), 'end': END.replace('-', ''), 'format': 'JSON'})
    data = json.loads(fetch(url, raw / 'power' / f'{sid}.json'))['properties']['parameter']
    frame = pd.DataFrame(data)
    frame.index = pd.to_datetime(frame.index, format='%Y%m%d').strftime('%Y-%m-%d')
    frame = frame.replace(-999, np.nan).rename(columns=TARGETS)
    frame.insert(0, 'date', frame.index)
    frame.insert(0, 'station_id', sid)
    return frame.reset_index(drop=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default='data/large')
    ap.add_argument('--output', default='data/large_plus')
    ap.add_argument('--candidates', default='reports/expansion_candidates.json')
    args = ap.parse_args()
    src, out = Path(args.source), Path(args.output)
    raw = out / 'raw'
    raw.mkdir(parents=True, exist_ok=True)
    for f in (src / 'raw').iterdir():
        if f.is_file() and not (raw / f.name).exists():
            shutil.copy2(f, raw / f.name)

    train = pd.read_csv(src / 'train' / 'train.csv', dtype={'station_id': str})
    test = pd.read_csv(src / 'test' / 'test.csv', dtype={'station_id': str})
    actuals = pd.read_csv(src / 'evaluation' / 'actuals.csv', dtype={'station_id': str})
    meta = pd.read_csv(src / 'metadata' / 'station_metadata.csv', dtype={'station_id': str})
    cands = json.loads(Path(args.candidates).read_text(encoding='utf-8'))
    new_ids = [c['id'] for c in cands]

    # NWIS site info for the new stations (free, no quota): coordinates, HUC, state.
    sites = parse_rdb(fetch('https://waterservices.usgs.gov/nwis/site/?' + urlencode(
        {'format': 'rdb', 'sites': ','.join(new_ids), 'siteOutput': 'expanded'}), raw / 'plus_site_inventory.rdb'))
    sites = sites[sites.agency_cd == 'USGS'].drop_duplicates('site_no').set_index('site_no')

    def discharge(sid: str) -> pd.DataFrame:
        url = 'https://waterservices.usgs.gov/nwis/dv/?' + urlencode({
            'format': 'json', 'sites': sid, 'startDT': START, 'endDT': END, 'parameterCd': '00060', 'statCd': '00003'})
        d = json.loads(fetch(url, raw / f'{sid}-discharge-{START}-{END}.json'))
        rows = [{'station_id': sid, 'date': v['dateTime'][:10], 'discharge_cfs': float(v['value'])}
                for ts in d['value']['timeSeries'] for g in ts['values'] for v in g['value'] if float(v['value']) >= 0]
        return pd.DataFrame(rows).drop_duplicates(['station_id', 'date'])

    old_ids = sorted(meta.station_id)
    coords = {r.station_id: (float(r.latitude), float(r.longitude)) for r in meta.itertuples()}
    for sid in new_ids:
        coords[sid] = (float(sites.loc[sid, 'dec_lat_va']), float(sites.loc[sid, 'dec_long_va']))

    with ThreadPoolExecutor(4) as pool:
        weather = dict(zip(old_ids + new_ids, pool.map(lambda s: power_weather(s, *coords[s], raw), old_ids + new_ids)))
        flows = dict(zip(new_ids, pool.map(discharge, new_ids)))
    print(f'fetched POWER weather for {len(weather)} stations and discharge for {len(flows)} new stations', flush=True)

    # Quantile-map POWER -> Open-Meteo using original stations, training period only.
    old_train = train[train.date <= '2024-12-31']
    cal = {}
    qs = np.linspace(0, 1, 1001)
    pw_old = pd.concat([weather[s] for s in old_ids])
    paired = old_train.merge(pw_old, on=['station_id', 'date'], suffixes=('_om', '_pw'))
    report = {}
    for col in TARGETS.values():
        a, b = paired[col + '_pw'].dropna(), paired[col + '_om'].dropna()
        cal[col] = (np.quantile(a, qs), np.quantile(b, qs))
        j = paired[[col + '_pw', col + '_om']].dropna()
        report[col] = {'pairs': int(len(j)), 'corr_raw': float(j.corr().iloc[0, 1])}
    for col, (px, py) in cal.items():
        mapped = np.interp(paired[col + '_pw'].to_numpy(), px, py)
        ok = ~np.isnan(mapped) & paired[col + '_om'].notna().to_numpy()
        report[col]['corr_mapped'] = float(np.corrcoef(mapped[ok], paired[col + '_om'].to_numpy()[ok])[0, 1])
    print(json.dumps(report, indent=1), flush=True)

    new_rows, new_meta, skipped = [], [], []
    for sid in new_ids:
        q = flows[sid]
        if len(q) < 5500:
            skipped.append(sid)
            continue
        w = weather[sid].copy()
        for col, (px, py) in cal.items():
            w[col] = np.interp(w[col].to_numpy(), px, py)
        m = q.merge(w, on=['station_id', 'date'], how='inner', validate='one_to_one')
        m['drainage_area_sqmi'] = float(sites.loc[sid, 'drain_area_va'])
        for col in ['mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']:
            m[col] = np.nan
        new_rows.append(m)
        new_meta.append({'station_id': sid, 'station_name': sites.loc[sid, 'station_nm'], 'river_name': sites.loc[sid, 'station_nm'],
                         'latitude': coords[sid][0], 'longitude': coords[sid][1], 'state': sites.loc[sid].get('state_cd', '')})
    plus = pd.concat(new_rows, ignore_index=True)
    cols = list(train.columns)
    plus = plus[cols]
    new_train = plus[plus.date < '2025-01-01']
    new_test = plus[plus.date >= '2025-01-01']

    all_train = pd.concat([train, new_train], ignore_index=True).sort_values(['date', 'station_id'])
    all_test = pd.concat([test, new_test.drop(columns='discharge_cfs')], ignore_index=True).sort_values(['date', 'station_id'])
    all_meta = pd.concat([meta, pd.DataFrame(new_meta)], ignore_index=True)
    hucs = {s: str(sites.loc[s, 'huc_cd'])[:2] for s in new_ids if s in sites.index}
    inv = parse_rdb((src / 'raw' / 'station_inventory.rdb').read_text(encoding='utf-8'))
    inv = inv[inv.agency_cd == 'USGS'].drop_duplicates('site_no').set_index('site_no')
    hucs.update({s: str(inv.loc[s, 'huc_cd'])[:2] for s in old_ids if s in inv.index})
    all_meta['huc2'] = all_meta.station_id.map(hucs)

    all_train.to_csv(out / 'train.csv', index=False)
    all_test.to_csv(out / 'test.csv', index=False)
    all_meta.to_csv(out / 'station_metadata.csv', index=False)
    pd.concat([actuals, new_test[['station_id', 'date', 'discharge_cfs']]]).to_csv(out / 'actuals.csv', index=False)
    new_test[['station_id', 'date', 'discharge_cfs']].to_csv(out / 'new_station_actuals.csv', index=False)
    (out / 'plus_provenance.json').write_text(json.dumps({
        'purpose': 'Experiment only: original data plus extra USGS stations with calibrated NASA POWER weather.',
        'new_stations': [m['station_id'] for m in new_meta], 'skipped': skipped, 'calibration': report,
        'sources': ['https://waterservices.usgs.gov/', 'https://power.larc.nasa.gov/']}, indent=2), encoding='utf-8')

    download_catchments.main(Namespace(data=str(out)))
    print(f'PLUS DATASET READY: {all_train.station_id.nunique()} stations, {len(all_train)} train rows, {len(all_test)} test rows', flush=True)


if __name__ == '__main__':
    main()
