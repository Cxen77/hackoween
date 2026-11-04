"""Independent geographic test of the FLOODCAST V2 recipe on Caravan US basins (different source, different gauges).

Caravan (CC-BY 4.0, https://doi.org/10.5281/zenodo.7944025) supplies ERA5-Land weather, streamflow in mm/day and
HydroATLAS/other static attributes. This script converts a basin to the FLOODCAST schema:
  discharge_cfs        = streamflow[mm/d] * area_km2 / 86.4 * 35.3147
  precipitation_mm     = total_precipitation_sum         temp_max_c/min = temperature_2m_max/min
  soil_moisture        = volumetric_soil_water_layer_1_mean (ERA5-Land 0-7 cm, same family as Open-Meteo's layer)
  drainage_area_sqmi   = area_km2 / 2.58999             mean_elevation_ft = ele_mt_sav * 3.28084
  slope_pct            = tan(slp_dg_sav / 10 degrees)*100   forest_cover_pct = for_pc_sse
Attribute definitions differ from StreamStats (domain shift); impervious surface is left missing.
The V2 recipe (0.25 baseline_log + 0.75 regional_raw) is refit on the ORIGINAL training rows only; no Caravan row is
used for fitting. Basins whose gauge is also a training station are excluded. Scored on 2010-2020.

Usage: python -m scripts.external_caravan_eval --out data/experiments/caravan_eval
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import pandas as pd

from solution import metrics, read_input
from scripts.clean_data import clean_frame
from scripts.download_data import fetch, parse_rdb
from scripts.improve_model import fit_candidate, predict_candidate, features, regional_features

START, END = '2010-01-01', '2020-12-31'


def nse(a, p):
    return float(1 - ((a - p) ** 2).sum() / ((a - a.mean()) ** 2).sum())


def load_basins(root: Path, exclude: set[str]):
    attr = {n: pd.read_csv(root / 'attributes' / 'camels' / f'attributes_{n}_camels.csv').set_index('gauge_id')
            for n in ('other', 'hydroatlas')}
    area = attr['other']['area']
    frames = []
    for path in sorted((root / 'timeseries' / 'csv' / 'camels').glob('camels_*.csv')):
        gid = path.stem
        sid = gid.split('_', 1)[1]
        if sid in exclude or gid not in area.index:
            continue
        d = pd.read_csv(path, parse_dates=['date'])
        d = d[(d.date >= '1981-01-01') & d.streamflow.notna()]
        km2 = float(area[gid])
        h = attr['hydroatlas'].loc[gid]
        f = pd.DataFrame({
            'station_id': sid, 'date': d.date.dt.strftime('%Y-%m-%d'),
            'discharge_cfs': d.streamflow.clip(lower=0) * km2 / 86.4 * 35.3147,
            'precipitation_mm': d.total_precipitation_sum, 'temp_max_c': d.temperature_2m_max,
            'temp_min_c': d.temperature_2m_min, 'soil_moisture': d.volumetric_soil_water_layer_1_mean,
            'drainage_area_sqmi': km2 / 2.58999, 'mean_elevation_ft': float(h['ele_mt_sav']) * 3.28084,
            'slope_pct': float(np.tan(np.radians(float(h['slp_dg_sav']) / 10.0)) * 100),
            'forest_cover_pct': float(h['for_pc_sse']), 'impervious_surface_pct': np.nan})
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


def huc2_map(ids: list[str], cache: Path) -> dict[str, str]:
    out = {}
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        text = fetch('https://waterservices.usgs.gov/nwis/site/?' + urlencode(
            {'format': 'rdb', 'sites': ','.join(chunk), 'siteOutput': 'expanded'}), cache / f'caravan_sites_{i}.rdb')
        s = parse_rdb(text)
        s = s[s.agency_cd == 'USGS'].drop_duplicates('site_no')
        out.update({r.site_no: str(r.huc_cd)[:2] for r in s.itertuples() if isinstance(r.huc_cd, str)})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--caravan', default='data/external/caravan/Caravan')
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--metadata', default='data/large/metadata/station_metadata.csv')
    ap.add_argument('--inventory', default='data/large/raw/station_inventory.rdb')
    ap.add_argument('--out', default='data/experiments/caravan_eval')
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    train = read_input(args.train, True)
    meta = pd.read_csv(args.metadata, dtype={'station_id': str, 'huc2': str})
    inv = parse_rdb(Path(args.inventory).read_text(encoding='utf-8'))
    inv = inv[inv.agency_cd == 'USGS'].drop_duplicates('site_no')
    regions = meta.station_id.map(inv.set_index('site_no').huc_cd.str[:2])
    meta['huc2'] = meta['huc2'].combine_first(regions) if 'huc2' in meta else regions

    train, train_report = clean_frame(train, target=True)
    frame = load_basins(Path(args.caravan), set(train.station_id))
    frame, caravan_report = clean_frame(frame, target=True)
    (out / 'data_quality.json').write_text(json.dumps({'train': train_report, 'caravan': caravan_report}, indent=2), encoding='utf-8')
    print('cleaning:', json.dumps({'caravan': {k: v for k, v in caravan_report.items() if k.startswith(('rows', 'dropped', 'clipped'))}}), flush=True)
    ids = sorted(frame.station_id.unique())
    huc = huc2_map(ids, out)
    cmeta = pd.DataFrame({'station_id': ids, 'huc2': [huc.get(i) for i in ids]})
    print(f'{len(ids)} Caravan US basins, {len(frame):,} rows; HUC2 found for {cmeta.huc2.notna().sum()}', flush=True)
    frame = frame.sort_values(['station_id', 'date']).reset_index(drop=True)

    # Refit the V2 recipe on original training rows only.
    base_tr, reg_tr = features(train), regional_features(train, meta)
    comp_b = fit_candidate('baseline_log', train, base_tr, args.seed)
    comp_r = fit_candidate('regional_raw', train, reg_tr, args.seed)

    base_te = features(frame)
    reg_te = regional_features(frame, cmeta)
    for col in comp_r['features']:  # HUC2 one-hots / columns absent in the new frame
        if col not in reg_te:
            reg_te[col] = 0.0 if col.startswith('huc2_') else np.nan
    pred = 0.25 * predict_candidate(comp_b, frame, base_te) + 0.75 * predict_candidate(comp_r, frame, reg_te)

    test = (frame.date >= START).to_numpy() & (frame.date <= END).to_numpy()
    f, p = frame[test].reset_index(drop=True), pred[test]
    y = f.discharge_cfs.to_numpy()
    result = {'basins': len(ids), 'test_rows': int(test.sum()), 'period': [START, END],
              'v2_recipe': metrics(y, p, f.station_id),
              'median_baseline': metrics(y, np.full(len(y), float(train.discharge_cfs.median())), f.station_id)}
    per = []
    for sid, g in f.assign(pred=p).groupby('station_id'):
        a, q = g.discharge_cfs.to_numpy(), g.pred.to_numpy()
        per.append({'station_id': sid, 'rows': len(g), 'area_sqmi': float(g.drainage_area_sqmi.iloc[0]),
                    'nse': nse(a, q), 'rmse': float(np.sqrt(np.mean((a - q) ** 2))),
                    'bias_pct': float(100 * (q.sum() - a.sum()) / a.sum())})
    per = pd.DataFrame(per)
    result['per_basin'] = {'median_nse': float(per.nse.median()), 'share_nse_positive': float((per.nse > 0).mean()),
                           'share_nse_above_0_5': float((per.nse > 0.5).mean()), 'median_bias_pct': float(per.bias_pct.median())}
    per.to_csv(out / 'per_basin.csv', index=False)
    (out / 'caravan_metrics.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=1), flush=True)


if __name__ == '__main__':
    main()
