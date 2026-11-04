"""Hyperparameter variants of the V2 regional_raw component, validated on the cached splits. No retraining of the rest.

Each variant replaces regional_raw in the V2 blend (0.25 baseline_log [cached] + 0.75 variant) and is scored on both
validation splits. Gate vs the cached V2 ensemble: overall AND extreme RMSE lower in BOTH splits. 2025 never opened.

Usage: python -m scripts.tune_regional --out data/experiments/tune_regional_v1
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline

from solution import metrics, read_input
from scripts.download_data import parse_rdb
from scripts.improve_model import regional_features

BASE = dict(max_iter=420, learning_rate=.055, max_leaf_nodes=23, l2_regularization=40, early_stopping=False)
VARIANTS = {
    'leaf15': dict(max_leaf_nodes=15, max_iter=520, learning_rate=.05),
    'leaf31': dict(max_leaf_nodes=31),
    'l2_120': dict(l2_regularization=120),
    'min_leaf_200': dict(min_samples_leaf=200),
    'slow_700': dict(max_iter=700, learning_rate=.03),
    'cols_60': dict(max_features=0.6),
    'depth6_cols_70': dict(max_depth=6, max_leaf_nodes=40, max_features=0.7, max_iter=600, learning_rate=.04),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--metadata', default='data/large/metadata/station_metadata.csv')
    ap.add_argument('--inventory', default='data/large/raw/station_inventory.rdb')
    ap.add_argument('--cache', default='data/experiments/v6')
    ap.add_argument('--out', default='data/experiments/tune_regional_v1')
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    cache = json.loads((Path(args.cache) / 'metrics.json').read_text(encoding='utf-8'))
    z = np.load(Path(args.cache) / 'validation_predictions.npz')
    v2 = cache['validation']['ensemble_v2']
    train = read_input(args.train, True)
    meta = pd.read_csv(args.metadata, dtype={'station_id': str, 'huc2': str})
    inv = parse_rdb(Path(args.inventory).read_text(encoding='utf-8'))
    inv = inv[inv.agency_cd == 'USGS'].drop_duplicates('site_no')
    regions = meta.station_id.map(inv.set_index('site_no').huc_cd.str[:2])
    meta['huc2'] = meta['huc2'].combine_first(regions) if 'huc2' in meta else regions
    X = regional_features(train, meta).reset_index(drop=True)
    y = train.discharge_cfs.to_numpy(float)

    cutoff, held = cache['validation_cutoff'], cache['held_out_stations']
    splits = {'future_dates': (train.date < cutoff, train.date >= cutoff),
              'unseen_station_future_dates': ((train.date < cutoff) & ~train.station_id.isin(held),
                                              (train.date >= cutoff) & train.station_id.isin(held))}
    results = {}
    for name, extra in {'control_v2': {}, **VARIANTS}.items():
        results[name] = {}
        for split, (fit, val) in splits.items():
            fit_m, val_m = fit.to_numpy(), val.to_numpy()
            model = make_pipeline(SimpleImputer(strategy='median', add_indicator=True, keep_empty_features=True),
                                  HistGradientBoostingRegressor(random_state=args.seed, **{**BASE, **extra}))
            model.fit(X[fit_m], y[fit_m])
            comp = np.maximum(0, model.predict(X[val_m]))
            blend = 0.25 * z[f'baseline_log__{split}'] + 0.75 * comp
            results[name][split] = metrics(y[val_m], blend, train.station_id[val_m])
        ok = all(results[name][s]['rmse'] < v2[s]['model']['rmse'] and results[name][s]['extreme_rmse'] < v2[s]['model']['extreme_rmse']
                 for s in splits)
        results[name]['gate_passed'] = bool(ok)
        line = {s: (round(results[name][s]['rmse']), round(results[name][s]['extreme_rmse'])) for s in splits}
        print(f'{name:16s} {line} gate={ok}', flush=True)
        (out / 'tune_results.json').write_text(json.dumps({'v2_reference': {s: v2[s]['model'] for s in splits}, 'results': results}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
