"""Train the 1/3/7-day model on the 55 USGS gauges + Caravan basins, with the threshold and split fixes.

Fixes over scripts/train_augmented.py:
  * The 55 USGS gauges start in 2010, so thresholds from "before 2000" were empty and those gauges dropped out of training.
    basinshift_model.thresholds now falls back to a station's own first five years.
  * Each source gets its own train/calibration split: USGS gauges train before 2022 and calibrate 2022-2023 (their data run
    to 2024), Caravan basins train before 2012 and calibrate 2012-2014 (their streamflow ends 2014).

Modes
  holdout  leaves out the same 11 USGS gauges the earlier model was tested on (seed 42) and 60 random Caravan basins, so the
           model can be compared with the earlier one on catchments it never saw. Writes models_aug_holdout.joblib and
           basinshift_aug_holdout.json.
  final    trains on everything (USGS cal 2023-2024). Writes models_aug_final.joblib.

Usage: python -m scripts.train_augmented_v2 --mode holdout
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm

CSV = Path('data/augmented_v2/train_augmented.csv')
EXP = Path('data/experiments/basinshift_model')


def split_masks(df, orig_train_end, orig_cal_end):
    is_o = (df.source == 'original').to_numpy()
    d = df.date
    tr = np.where(is_o, d < orig_train_end, d < '2012-01-01')
    ca = np.where(is_o, (d >= orig_train_end) & (d < orig_cal_end), (d >= '2012-01-01') & (d < '2015-01-01'))
    return tr, ca


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['holdout', 'final'], required=True)
    ap.add_argument('--tuned', action='store_true', help='tuned settings from scripts/tune_aug.py: 5x weight on USGS rows, 127 leaves')
    args = ap.parse_args()
    bm.HORIZONS[:] = [1, 3, 7]
    bm.QUANTILES[:] = [0.05, 0.95]
    df = pd.read_csv(CSV, dtype={'station_id': str}).sort_values(['station_id', 'date']).reset_index(drop=True)
    orig_ids = sorted(df[df.source == 'original'].station_id.unique())
    car_ids = sorted(df[df.source == 'caravan'].station_id.unique())
    held_o = sorted(np.random.default_rng(42).choice(orig_ids, size=max(2, len(orig_ids) // 5), replace=False).tolist())
    held_c = sorted(np.random.default_rng(7).choice(car_ids, size=60, replace=False).tolist())
    t = time.time()
    if args.mode == 'holdout':
        fit = df[~df.station_id.isin(held_o + held_c)].reset_index(drop=True)
        tr, ca = split_masks(fit, '2022-01-01', '2024-01-01')
    else:
        fit = df
        tr, ca = split_masks(fit, '2023-01-01', '2025-01-01')
    print(f'{args.mode}: fitting on {len(fit):,} rows / {fit.station_id.nunique()} stations (train {int(tr.sum()):,}, calibration {int(ca.sum()):,})', flush=True)
    params = dict(num_leaves=127) if args.tuned else None
    weights = np.where(fit.source == 'original', 5.0, 1.0) if args.tuned else None
    bundle = bm.fit_bundle(fit, '2000-01-01', None, None, in_train=tr, in_cal=ca, params=params, weights=weights)
    tag = '_tuned' if args.tuned else ''
    out = EXP / f'models_aug_{args.mode}{tag}.joblib'
    joblib.dump({'bundle': bundle, 'fit_ref_cut': '2000-01-01', 'test_ref_cut': '2000-01-01'}, out, compress=3)
    print(f'saved {out} ({out.stat().st_size / 1e6:.1f} MB) in {(time.time() - t) / 60:.1f} min', flush=True)

    if args.mode == 'holdout':
        results = {}
        for label, ids, t0, t1 in (('heldout_gauges', held_o, '2022-01-01', '2024-12-31'), ('heldout_caravan', held_c, '2010-01-01', '2014-12-31')):
            test = df[df.station_id.isin(ids)].sort_values(['station_id', 'date']).reset_index(drop=True)
            in_test = ((test.date >= t0) & (test.date <= t1)).to_numpy()
            y, area = test.discharge_cfs.to_numpy(float), test.drainage_area_sqmi.to_numpy(float)
            clim = bm.clim_forecast(test, (test.date < t0).to_numpy())
            res = {'label': label, 'test_rows': int(in_test.sum()), 'test_stations': len(ids), 'horizons': {}}
            for h in bm.HORIZONS:
                o = bm.forecast(bundle, test, '2000-01-01', h)
                mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
                rep = bm.evaluate(o, test, y, mask, bundle['horizons'][h], area, True, clim)
                res['horizons'][str(h)] = rep
                f = rep['forecast']
                print(f"[{label}] h={h} rows={rep['rows_scored']:,} RMSE blend {f['basinshift_blend']['rmse']:,.1f} persist {f['persistence']['rmse']:,.1f} "
                      f"ratio {f['basinshift_blend']['rmse'] / f['persistence']['rmse']:.3f} | medNSE {f['basinshift_blend']['median_basin_nse']:.3f} vs {f['persistence']['median_basin_nse']:.3f} "
                      f"| cov {rep['interval_90']['coverage']:.3f}", flush=True)
            results[label] = res
        (EXP / f'basinshift_aug_holdout{tag}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
