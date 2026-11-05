"""Hyper-parameter search for the 1/3/7-day model's point head, aimed at the large-river weakness.

Tuned on the CALIBRATION windows (USGS gauges 2022-2023, Caravan 2012-2014) of the hold-out split, never on the 11 held-out
gauges or the 60 held-out Caravan basins. Horizon +3 only (a middle horizon) to keep it fast; the winner is then used for all
three. Reports RMSE ratio vs persistence on (A) large USGS gauges (>= 10,000 sq mi), (B) all USGS gauges, (C) Caravan basins.

Searched: weight on USGS rows (they are 5% of the data), tree size, leaf size, number of trees/learning rate.

Usage: python -m scripts.tune_aug
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm
from scripts.train_augmented_v2 import CSV, EXP, split_masks

H = 3
CONFIGS = [
    dict(name='baseline', w=1, leaves=63, mcs=60, trees=300, lr=0.06),
    dict(name='w5', w=5, leaves=63, mcs=60, trees=300, lr=0.06),
    dict(name='w20', w=20, leaves=63, mcs=60, trees=300, lr=0.06),
    dict(name='w5_leaves31', w=5, leaves=31, mcs=60, trees=300, lr=0.06),
    dict(name='w5_leaves127', w=5, leaves=127, mcs=60, trees=300, lr=0.06),
    dict(name='w5_mcs200', w=5, leaves=63, mcs=200, trees=300, lr=0.06),
    dict(name='w5_600trees', w=5, leaves=63, mcs=60, trees=600, lr=0.03),
]


def main() -> None:
    df = pd.read_csv(CSV, dtype={'station_id': str}).sort_values(['station_id', 'date']).reset_index(drop=True)
    orig_ids = sorted(df[df.source == 'original'].station_id.unique())
    car_ids = sorted(df[df.source == 'caravan'].station_id.unique())
    held_o = sorted(np.random.default_rng(42).choice(orig_ids, size=max(2, len(orig_ids) // 5), replace=False).tolist())
    held_c = sorted(np.random.default_rng(7).choice(car_ids, size=60, replace=False).tolist())
    fit = df[~df.station_id.isin(held_o + held_c)].reset_index(drop=True)
    tr, ca = split_masks(fit, '2022-01-01', '2024-01-01')
    bm.HORIZONS[:] = [H]
    X, thr, lag = bm.build(fit, '2000-01-01', H)
    y = fit.discharge_cfs.to_numpy(float)
    ok = ~np.isnan(lag) & ~np.isnan(thr.T90.to_numpy())
    r = np.log1p(y) - np.log1p(lag)
    is_o = (fit.source == 'original').to_numpy()
    area = fit.drainage_area_sqmi.to_numpy(float)
    rng = np.random.default_rng(0)
    keep = tr & ok & (is_o | (rng.random(len(fit)) < 0.15))   # all USGS rows, 15% of Caravan rows: ~0.8M rows per fit
    print(f'tuning on {int(keep.sum()):,} train rows ({int((keep & is_o).sum()):,} USGS); validating on {int((ca & ok).sum()):,} calibration rows', flush=True)
    val = ca & ok
    groups = {'A_large_usgs': val & is_o & (area >= 10000), 'B_all_usgs': val & is_o, 'C_caravan': val & ~is_o}
    lag_safe = np.where(np.isnan(lag), 0.0, lag)
    Ll = np.log1p(lag_safe)
    results = []
    for c in CONFIGS:
        t = time.time()
        params = dict(bm.P, num_leaves=c['leaves'], min_child_samples=c['mcs'], n_estimators=c['trees'], learning_rate=c['lr'])
        w = np.where(is_o[keep], c['w'], 1.0)
        m = lgb.LGBMRegressor(**params).fit(X[keep], r[keep], sample_weight=w)
        pred = np.expm1(Ll[val] + m.predict(X[val]))
        point = pd.Series(0.5 * lag_safe[val] + 0.5 * pred, index=np.flatnonzero(val))
        row = {'config': c}
        for g, mask in groups.items():
            idx = np.flatnonzero(mask)
            p, l, yy = point.loc[idx].to_numpy(), lag_safe[idx], y[idx]
            row[g] = float(np.sqrt(np.mean((yy - p) ** 2)) / np.sqrt(np.mean((yy - l) ** 2)))
        row['score'] = (row['A_large_usgs'] + row['C_caravan']) / 2
        row['minutes'] = (time.time() - t) / 60
        results.append(row)
        print(f"{c['name']:14s} large-USGS ratio {row['A_large_usgs']:.3f} | all-USGS {row['B_all_usgs']:.3f} | Caravan {row['C_caravan']:.3f} | score {row['score']:.3f} ({row['minutes']:.1f} min)", flush=True)
        (EXP / 'tune_aug.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    best = min(results, key=lambda x: x['score'])
    print('best:', best['config'], flush=True)


if __name__ == '__main__':
    main()
