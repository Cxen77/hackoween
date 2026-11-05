"""Score data/experiments/basinshift_model/models_aug_holdout.joblib on the catchments it never saw (see train_augmented_v2.py)."""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm

EXP = Path('data/experiments/basinshift_model')


def main() -> None:
    saved = joblib.load(EXP / 'models_aug_holdout.joblib')
    bundle = saved['bundle']
    bm.HORIZONS[:] = sorted(bundle['horizons'])
    df = pd.read_csv('data/augmented_v2/train_augmented.csv', dtype={'station_id': str}).sort_values(['station_id', 'date']).reset_index(drop=True)
    orig_ids = sorted(df[df.source == 'original'].station_id.unique())
    car_ids = sorted(df[df.source == 'caravan'].station_id.unique())
    held_o = sorted(np.random.default_rng(42).choice(orig_ids, size=max(2, len(orig_ids) // 5), replace=False).tolist())
    held_c = sorted(np.random.default_rng(7).choice(car_ids, size=60, replace=False).tolist())
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
            for size, v in rep['by_catchment_size'].items():
                print(f"     {size:6s} ratio {v['blend']['rmse'] / v['persistence']['rmse']:.3f}  medNSE {v['blend']['median_basin_nse']:.3f} vs {v['persistence']['median_basin_nse']:.3f}", flush=True)
        results[label] = res
    (EXP / 'basinshift_aug_holdout.json').write_text(json.dumps(results, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
