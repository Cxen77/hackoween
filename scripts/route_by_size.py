"""Which model is best for which river size? Scores both candidate models, band by band, on catchments neither saw in training.

Models (both hold-out versions, trained without the test catchments):
  gauges  data/experiments/basinshift_model/models_heldout.joblib   trained on the 55 USGS gauges only
  mixed   data/experiments/basinshift_model/models_aug_holdout.joblib  55 gauges + Caravan basins
Tests: 11 held-out USGS gauges 2022-24 and 60 held-out Caravan basins 2010-14 (same splits as scripts/eval_routed.py).
For each drainage-area band and horizon: RMSE of each model divided by persistence RMSE (below 1 beats repeating yesterday).
Prints the winner per band and writes data/experiments/basinshift_model/route_by_size.json.

Usage: python -m scripts.route_by_size
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm

EXP = Path('data/experiments/basinshift_model')
BANDS = [(0, 500), (500, 2000), (2000, 10000), (10000, 50000), (50000, 1e9)]


def main() -> None:
    new = joblib.load(EXP / 'models_aug_holdout.joblib')
    old = joblib.load(EXP / 'models_heldout.joblib')
    bm.HORIZONS[:] = [1, 3, 7]
    df = pd.read_csv('data/augmented_v2/train_augmented.csv', dtype={'station_id': str}).sort_values(['station_id', 'date']).reset_index(drop=True)
    orig_ids = sorted(df[df.source == 'original'].station_id.unique())
    car_ids = sorted(df[df.source == 'caravan'].station_id.unique())
    held_o = sorted(np.random.default_rng(42).choice(orig_ids, size=max(2, len(orig_ids) // 5), replace=False).tolist())
    held_c = sorted(np.random.default_rng(7).choice(car_ids, size=60, replace=False).tolist())
    rows = []
    for label, ids, t0, t1, old_cut in (('gauges', held_o, '2022-01-01', '2024-12-31', '2022-01-01'), ('caravan', held_c, '2010-01-01', '2014-12-31', '2010-01-01')):
        test = df[df.station_id.isin(ids)].sort_values(['station_id', 'date']).reset_index(drop=True)
        in_test = ((test.date >= t0) & (test.date <= t1)).to_numpy()
        y, area = test.discharge_cfs.to_numpy(float), test.drainage_area_sqmi.to_numpy(float)
        for h in bm.HORIZONS:
            a = bm.forecast(new['bundle'], test, '2000-01-01', h)   # mixed model
            b = bm.forecast(old['bundle'], test, old_cut, h)         # 55-gauge model
            ok = in_test & ~np.isnan(a['thr'].T90.to_numpy()) & ~np.isnan(b['thr'].T90.to_numpy()) & ~np.isnan(a['persistence'])
            for lo, hi in BANDS:
                m = ok & (area >= lo) & (area < hi)
                if m.sum() < 100:
                    continue
                se = lambda p: float(np.sum((y[m] - p[m]) ** 2))
                rows.append({'set': label, 'h': h, 'band': f'{lo:g}-{hi:g}', 'n_basins': int(test[m].station_id.nunique()), 'rows': int(m.sum()),
                             'sse_persist': se(a['persistence']), 'sse_mixed': se(a['point']), 'sse_gauges': se(b['point'])})
    r = pd.DataFrame(rows)
    out = []
    for band, g in r.groupby('band', sort=False):
        agg = g.groupby('h')[['sse_persist', 'sse_mixed', 'sse_gauges']].sum()
        ratio_m, ratio_g = np.sqrt(agg.sse_mixed / agg.sse_persist), np.sqrt(agg.sse_gauges / agg.sse_persist)
        basins = int(g.groupby('set').n_basins.max().sum())
        best = 'mixed' if ratio_m.mean() < ratio_g.mean() else 'gauges'
        out.append({'band_sqmi': band, 'basins': basins, 'mixed_ratio_by_h': ratio_m.round(3).to_dict(), 'gauges_ratio_by_h': ratio_g.round(3).to_dict(), 'best': best})
        print(f"{band:>12s} sq mi | basins {basins:3d} | mixed {ratio_m.round(3).tolist()} | gauges-only {ratio_g.round(3).tolist()} | best: {best}", flush=True)
    (EXP / 'route_by_size.json').write_text(json.dumps({'rows': rows, 'summary': out}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
