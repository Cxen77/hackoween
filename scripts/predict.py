"""Reproducible BASINSHIFT-style prediction: +1, +3 and +7 day forecasts with 90% intervals and flood probabilities.

Input  (CSV, one row per station and day):
    station_id, date, discharge_cfs, precipitation_mm, temp_max_c, temp_min_c, soil_moisture,
    drainage_area_sqmi, mean_elevation_ft, slope_pct, forest_cover_pct, impervious_surface_pct
  - discharge_cfs must be filled up to the forecast origin and may be blank after it.
  - weather must be filled up to origin + 7 days (weather is known for the forecast days).
Output (CSV): station_id, origin_date, horizon_days, target_date, model, point_cfs, lo_cfs, hi_cfs,
              p_high_flow, p_extreme_flow, persistence_cfs, used_fallback

Routing (same rule as the live server): drainage area >= 10,000 sq mi uses models/models_large.joblib,
otherwise models/models_daily.joblib. Thresholds Q90/Q99 come from models/model_meta.json for the 55
training gauges; any other station uses its own first five years of record.

Usage:
    python -m scripts.predict --input my_history.csv --output my_forecasts.csv
    python -m scripts.predict --input test/example_history.csv --output forecasts.csv
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm

MODELS = Path('models')
LARGE_SQMI = 10000.0
REQUIRED = ['station_id', 'date', 'discharge_cfs', 'precipitation_mm', 'temp_max_c', 'temp_min_c', 'soil_moisture',
            'drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']


def load_models(models_dir: Path = MODELS):
    daily = joblib.load(models_dir / 'models_daily.joblib')['bundle']
    large = joblib.load(models_dir / 'models_large.joblib')['bundle']
    meta = json.loads((models_dir / 'model_meta.json').read_text(encoding='utf-8'))
    thresholds = pd.DataFrame(meta['thresholds']).T.astype(float)
    return daily, large, thresholds


def predict_station(frame: pd.DataFrame, daily, large, thresholds: pd.DataFrame) -> list[dict]:
    frame = frame.sort_values('date').reset_index(drop=True)
    sid = str(frame.station_id.iloc[0])
    known = frame[frame.discharge_cfs.notna()]
    if known.empty:
        raise ValueError(f'{sid}: no discharge observations, so there is no forecast origin')
    origin = known.date.max()
    if sid in thresholds.index:
        t90, t99 = float(thresholds.loc[sid, 'T90']), float(thresholds.loc[sid, 'T99'])
    else:  # short or unseen record: first five years of this station
        first = pd.to_datetime(known.date).min()
        early = known[pd.to_datetime(known.date) < first + pd.DateOffset(years=5)]
        t90, t99 = float(early.discharge_cfs.quantile(0.9)), float(early.discharge_cfs.quantile(0.99))
    thr = pd.DataFrame({'T90': t90, 'T99': t99}, index=range(len(frame)))
    area = float(frame.drainage_area_sqmi.iloc[0])
    bundle, name = (large, 'models_large.joblib') if area >= LARGE_SQMI else (daily, 'models_daily.joblib')
    rows = []
    for h in sorted(bundle['horizons']):
        target = (pd.Timestamp(origin) + pd.Timedelta(days=h)).strftime('%Y-%m-%d')
        if target not in set(frame.date):
            raise ValueError(f'{sid}: weather for {target} is missing; the input must extend to origin + {h} days')
        o = bm.forecast(bundle, frame, '2000-01-01', h, thr_override=thr)
        i = int(np.flatnonzero(frame.date.to_numpy() == target)[0])
        fallback = bool(o['fallback'][i])
        rows.append({'station_id': sid, 'origin_date': origin, 'horizon_days': h, 'target_date': target, 'model': name,
                     'point_cfs': round(float(o['point'][i]), 1),
                     'lo_cfs': None if fallback else round(float(o['lo'][i]), 1),
                     'hi_cfs': None if fallback else round(float(o['hi'][i]), 1),
                     'p_high_flow': round(float(o['p90'][i]), 4), 'p_extreme_flow': round(float(o['p99'][i]), 4),
                     'persistence_cfs': None if np.isnan(o['persistence'][i]) else round(float(o['persistence'][i]), 1),
                     'used_fallback': fallback})
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--models', default=str(MODELS))
    args = ap.parse_args()
    df = pd.read_csv(args.input, dtype={'station_id': str})
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise SystemExit(f'input is missing columns: {missing}')
    daily, large, thresholds = load_models(Path(args.models))
    out = []
    for sid, frame in df.groupby('station_id', sort=True):
        out.extend(predict_station(frame, daily, large, thresholds))
    result = pd.DataFrame(out)
    result.to_csv(args.output, index=False)
    print(f'wrote {len(result)} forecasts for {result.station_id.nunique()} stations to {args.output}')


if __name__ == '__main__':
    main()
