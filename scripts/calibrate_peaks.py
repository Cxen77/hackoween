"""Monotone (isotonic) recalibration of V2 predictions, learned on cached training-period validation predictions.

V2 under-predicts flood peaks on the largest rivers. This tests whether a monotone map prediction -> actual,
learned ONLY from validation predictions of stations that are NOT in the held-out set, improves the held-out
stations (unseen_station_future_dates), where the map has never seen those stations' labels.

Gate (held-out stations): overall RMSE, extreme RMSE and MAE must all improve. Only then is the final map fitted on
all future_dates validation rows and applied to production predictions. 2025 labels are never used to fit the map.

Usage: python -m scripts.calibrate_peaks --cache data/experiments/v6 --out data/experiments/calibration_v1
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from solution import metrics, read_input


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--cache', default='data/experiments/v6')
    ap.add_argument('--predictions', default='predictions.csv')
    ap.add_argument('--out', default='data/experiments/calibration_v1')
    ap.add_argument('--shrink', type=float, default=1.0, help='1.0 = full correction, 0 = none')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    cache = json.loads((Path(args.cache) / 'metrics.json').read_text(encoding='utf-8'))
    z = np.load(Path(args.cache) / 'validation_predictions.npz')
    train = read_input(args.train, True)
    cutoff, held = cache['validation_cutoff'], set(cache['held_out_stations'])
    later = (train.date >= cutoff).to_numpy()
    is_held = train.station_id.isin(held).to_numpy()
    ens = lambda split: 0.25 * z[f'baseline_log__{split}'] + 0.75 * z[f'regional_raw__{split}']

    fut_rows = train[later]
    fut_pred = ens('future_dates')
    held_rows = train[later & is_held]
    held_pred = ens('unseen_station_future_dates')
    y_fut, y_held = fut_rows.discharge_cfs.to_numpy(), held_rows.discharge_cfs.to_numpy()

    fit_mask = ~fut_rows.station_id.isin(held).to_numpy()
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0).fit(fut_pred[fit_mask], y_fut[fit_mask])
    corrected = args.shrink * iso.predict(held_pred) + (1 - args.shrink) * held_pred

    before = metrics(y_held, held_pred, held_rows.station_id)
    after = metrics(y_held, corrected, held_rows.station_id)
    gate = all(after[k] < before[k] for k in ('rmse', 'extreme_rmse', 'mae'))
    report = {'held_out_before': before, 'held_out_after': after, 'gate_passed': gate, 'shrink': args.shrink}
    print(json.dumps({k: {m: round(v[m], 4 if m == 'r2' else 0) for m in ('rmse', 'extreme_rmse', 'mae', 'r2')}
                      for k, v in [('before', before), ('after', after)]}, indent=1), 'GATE', gate, flush=True)

    if gate:
        final = IsotonicRegression(out_of_bounds='clip', y_min=0).fit(fut_pred, y_fut)
        prod = pd.read_csv(args.predictions, dtype={'station_id': str})
        prod['discharge_cfs'] = args.shrink * final.predict(prod.discharge_cfs.to_numpy()) + (1 - args.shrink) * prod.discharge_cfs
        prod['discharge_cfs'] = prod.discharge_cfs.clip(lower=0)
        prod.to_csv(out / 'predictions_calibrated.csv', index=False, float_format='%.6f')
        print('wrote calibrated candidate predictions')
    (out / 'calibration_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
