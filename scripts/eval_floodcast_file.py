"""Score each model choice on the FLOODCAST 2025 test file.

For every 2025 row the forecast model predicts the flow h days ahead from the discharge known h days earlier (history from the
training file plus the 2025 actuals) and the weather. Each choice is scored on the rows it can forecast:
  auto   routed by drainage area (>= 10,000 sq mi -> models/models_large.joblib, else models/models_daily.joblib)
  mixed  models/models_daily.joblib for every gauge
  gauge  models/models_large.joblib for every gauge
Metrics are the four FLOODCAST metrics (RMSE, extreme RMSE on each gauge's top 10%, MAE, R2), plus persistence for comparison.
Note: 44 of the 55 gauges and the 479 Caravan basins were in the served models' training years (before 2022-2025); the 11
held-out gauges were not. 2025 is later than all training data, so this is a later-dates test, not an unseen-catchment test.

Output: public/reports/model/floodcast_by_choice.json
Usage: python -m scripts.eval_floodcast_file
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm
from scripts.clean_data import clean_frame
from solution import read_input

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'models'
LARGE_SQMI = 10000.0


def metrics(y, p, station):
    thr = pd.Series(y).groupby(station).transform(lambda s: s.quantile(0.9)).to_numpy()
    ext = y >= thr
    err = y - p
    return {'rmse': float(np.sqrt(np.mean(err ** 2))), 'extreme_rmse': float(np.sqrt(np.mean(err[ext] ** 2))),
            'mae': float(np.mean(np.abs(err))), 'r2': float(1 - np.sum(err ** 2) / np.sum((y - y.mean()) ** 2)), 'rows': int(len(y))}


def main() -> None:
    daily = joblib.load(MODELS / 'models_daily.joblib')['bundle']
    large = joblib.load(MODELS / 'models_large.joblib')['bundle']
    meta = json.loads((MODELS / 'model_meta.json').read_text(encoding='utf-8'))
    thr_by_station = pd.DataFrame(meta['thresholds']).T.astype(float)
    bm.HORIZONS[:] = [1, 3, 7]

    train, _ = clean_frame(read_input(str(ROOT / 'data/large/train/train.csv'), True), target=True)
    test = pd.read_csv(ROOT / 'test/test.csv', dtype={'station_id': str})
    acts = pd.read_csv(ROOT / 'test/actuals.csv', dtype={'station_id': str})
    test = test.merge(acts, on=['station_id', 'date'], how='left')
    frame = pd.concat([train, test[train.columns]], ignore_index=True).sort_values(['station_id', 'date']).reset_index(drop=True)
    thr = frame[['station_id']].join(thr_by_station, on='station_id')[['T90', 'T99']]
    in_2025 = (frame.date >= '2025-01-01').to_numpy()
    y = frame.discharge_cfs.to_numpy(float)
    big = frame.drainage_area_sqmi.to_numpy(float) >= LARGE_SQMI
    out = {'note': 'Forecast models scored on the FLOODCAST 2025 test file. Later-dates test: 2025 is after all training data.', 'choices': {}}
    for h in (1, 3, 7):
        a = bm.forecast(daily, frame, '2000-01-01', h, thr_override=thr)
        b = bm.forecast(large, frame, '2000-01-01', h, thr_override=thr)
        preds = {'mixed': a['point'], 'gauge': b['point'], 'auto': np.where(big, b['point'], a['point'])}
        # the row's target is its own date, so the forecast for date t is stored at row t (history lagged by h inside forecast)
        pers = a['persistence']
        mask = in_2025 & ~np.isnan(y)
        for choice, p in preds.items():
            ok = mask & ~np.isnan(p) & ~np.isnan(pers)
            m = metrics(y[ok], p[ok], frame.station_id.to_numpy()[ok])
            m['persistence'] = metrics(y[ok], pers[ok], frame.station_id.to_numpy()[ok])
            out['choices'].setdefault(choice, {})[str(h)] = m
            print(f'{choice:6s} +{h}d rows {m["rows"]:,} RMSE {m["rmse"]:,.0f} (persistence {m["persistence"]["rmse"]:,.0f}) MAE {m["mae"]:,.0f} R2 {m["r2"]:.4f}', flush=True)
    (ROOT / 'public/reports/model/floodcast_by_choice.json').write_text(json.dumps(out, indent=1), encoding='utf-8')

    # Downloadable prediction files in the submission format (station_id,date,discharge_cfs), one per model choice and horizon,
    # aligned to test/test.csv. Rows a forecast cannot cover (first days of a gauge's record) use the same-day estimate.
    dest = ROOT / 'public' / 'test-data'
    dest.mkdir(parents=True, exist_ok=True)
    same_day = pd.read_csv(ROOT / 'test/predictions.csv', dtype={'station_id': str}).rename(columns={'discharge_cfs': 'fallback'})
    keys = pd.read_csv(ROOT / 'test/test.csv', dtype={'station_id': str})[['station_id', 'date']]
    for h in (1, 3, 7):
        a = bm.forecast(daily, frame, '2000-01-01', h, thr_override=thr)
        b = bm.forecast(large, frame, '2000-01-01', h, thr_override=thr)
        for choice, p in {'auto': np.where(big, b['point'], a['point']), 'mixed': a['point'], 'gauge': b['point']}.items():
            f = frame[['station_id', 'date']].assign(discharge_cfs=p)
            f = keys.merge(f, on=['station_id', 'date'], how='left').merge(same_day, on=['station_id', 'date'], how='left')
            f['discharge_cfs'] = f.discharge_cfs.fillna(f.fallback).clip(lower=0).round(3)
            f[['station_id', 'date', 'discharge_cfs']].to_csv(dest / f'predictions_{choice}_plus{h}d.csv', index=False)
    for name, src in (('test.csv', 'test/test.csv'), ('actuals.csv', 'test/actuals.csv'), ('predictions_same_day.csv', 'test/predictions.csv')):
        (dest / name).write_bytes((ROOT / src).read_bytes())
    print('wrote downloadable files to', dest)


if __name__ == '__main__':
    main()
