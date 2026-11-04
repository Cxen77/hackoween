"""Controlled test: does adding extra stations (data/large_plus) improve the V2 recipe? Gated, no promotion here.

Fits the production V2 recipe (0.25 baseline_log + 0.75 regional_raw) twice:
  control : original 55-station training rows  (should reproduce production V2 on the 2025 benchmark)
  plus    : original + extra stations (calibrated NASA POWER weather)
and scores BOTH on the ORIGINAL stations' 2025 rows (same rows, same labels). The plus model is also scored on the
new stations' 2025 rows, which have never been inspected (an independent signal).
2025 labels are opened only after fitting; they are never used for fitting or selection.

Usage: python -m scripts.plus_experiment --out data/experiments/plus_v1
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from solution import metrics, read_input
from scripts.improve_model import KEYS, features, fit_candidate, predict_candidate, regional_features


def fit_predict(train, test, metadata, seed):
    history = train[pd.to_datetime(train.date) >= pd.to_datetime(test.date).min() - pd.Timedelta(days=90)]
    base, regional = features(train), regional_features(train, metadata)
    tb, tr = features(test, history=history), regional_features(test, metadata, history=history)
    pred = np.zeros(len(test))
    for kind, weight, xtr, xte in [('baseline_log', 0.25, base, tb), ('regional_raw', 0.75, regional, tr)]:
        comp = fit_candidate(kind, train, xtr, seed)
        pred += weight * predict_candidate(comp, test, xte)
        print('fitted', kind, len(train), 'rows', flush=True)
    return pred


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--plus', default='data/large_plus')
    ap.add_argument('--original-actuals', default='data/large/evaluation/actuals.csv')
    ap.add_argument('--out', default='data/experiments/plus_v1')
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    plus = Path(args.plus)

    train = read_input(plus / 'train.csv', True)
    test = read_input(plus / 'test.csv')
    meta = pd.read_csv(plus / 'station_metadata.csv', dtype={'station_id': str, 'huc2': str})
    new_actuals = pd.read_csv(plus / 'new_station_actuals.csv', dtype={'station_id': str})
    old_actuals = pd.read_csv(args.original_actuals, dtype={'station_id': str})
    old_ids = set(old_actuals.station_id)
    new_ids = set(new_actuals.station_id)

    is_old_tr, is_old_te = train.station_id.isin(old_ids).to_numpy(), test.station_id.isin(old_ids).to_numpy()
    control = fit_predict(train[is_old_tr].reset_index(drop=True), test[is_old_te].reset_index(drop=True),
                          meta[meta.station_id.isin(old_ids)], args.seed)
    plus_pred = fit_predict(train, test, meta, args.seed)

    def score(pred_frame, actual):
        m = actual.merge(pred_frame, on=KEYS, suffixes=('_a', '_p'), validate='one_to_one')
        return metrics(m.discharge_cfs_a, m.discharge_cfs_p.to_numpy(), m.station_id)

    c_frame = test[is_old_te][KEYS].assign(discharge_cfs=control).reset_index(drop=True)
    p_frame = test[KEYS].assign(discharge_cfs=plus_pred)
    result = {
        'control_on_original_stations': score(c_frame, old_actuals),
        'plus_on_original_stations': score(p_frame[p_frame.station_id.isin(old_ids)], old_actuals),
        'plus_on_new_stations_independent': score(p_frame[p_frame.station_id.isin(new_ids)], new_actuals),
        'new_station_count': len(new_ids), 'plus_train_rows': len(train),
    }
    p_frame.to_csv(out / 'predictions_plus.csv', index=False)
    (out / 'plus_metrics.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    for k in ['control_on_original_stations', 'plus_on_original_stations', 'plus_on_new_stations_independent']:
        m = result[k]
        print(f"{k:36s} RMSE {m['rmse']:>9,.0f} extreme {m['extreme_rmse']:>9,.0f} MAE {m['mae']:>8,.0f} R2 {m['r2']:.4f}", flush=True)


if __name__ == '__main__':
    main()
