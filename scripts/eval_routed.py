"""Score the routed forecaster on catchments the models never saw.

Routing rule (same as server/model_api.py): drainage area >= LARGE_SQMI -> the 55-gauge model, otherwise the model trained on
the 55 gauges plus Caravan basins. Both models here are the HOLD-OUT versions (trained without the test catchments):
  small/medium: data/experiments/basinshift_model/models_aug_holdout.joblib   (scripts/train_augmented_v2.py --mode holdout)
  large:        data/experiments/basinshift_model/models_heldout.joblib       (scripts/basinshift_model.py --experiment heldout)
Tests: the 11 held-out USGS gauges, 2022-2024, and 60 held-out Caravan basins, 2010-2014.
The 10,000 sq mi cutoff was picked from the by-size comparison on the 11 gauges, so large-river numbers are slightly optimistic.
Writes data/experiments/basinshift_model/basinshift_routed.json.

Usage: python -m scripts.eval_routed
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm

EXP = Path('data/experiments/basinshift_model')
LARGE_SQMI = 10000.0


def routed(new, old, test, h, old_cut, big, **kw):
    """Forecast every row with the model its catchment size selects (extra kwargs go to bm.forecast: stress-test inputs)."""
    a = bm.forecast(new['bundle'], test, '2000-01-01', h, **kw)
    b = bm.forecast(old['bundle'], test, old_cut, h, **kw)
    o = {}
    for k, v in a.items():
        if k == 'thr':
            o[k] = v.where(~pd.Series(big), b[k])
        elif v.ndim == 1:
            o[k] = np.where(big, b[k], v)
        else:
            bq = b[k][:, [0, -1]] if b[k].shape[1] != v.shape[1] else b[k]  # old model has 5 quantiles; keep the outer two
            o[k] = np.where(big[:, None], bq, v)
    return o


def stress(new, old, df, held_o, tag=''):
    """Missing/gap/noise/delay stress tests and CPU timing for the routed forecaster on the 11 held-out gauges, 2022-2024."""
    import os, time, psutil
    from scripts.basinshift_stress import SCENARIOS, perturb, summarize
    test = df[df.station_id.isin(held_o)].sort_values(['station_id', 'date']).reset_index(drop=True)
    in_test = ((test.date >= '2022-01-01') & (test.date <= '2024-12-31')).to_numpy()
    y, area = test.discharge_cfs.to_numpy(float), test.drainage_area_sqmi.to_numpy(float)
    clim = bm.clim_forecast(test, (test.date < '2022-01-01').to_numpy())
    big = area >= LARGE_SQMI
    res = {'experiment': 'routed', 'basins': len(held_o), 'scenarios': {}}
    clean = {}
    for sc in SCENARIOS:
        hist, wx, delay = perturb(test, sc)
        res['scenarios'][sc] = {}
        for h in bm.HORIZONS:
            o = routed(new, old, test, h, '2022-01-01', big, hist_frame=hist, weather_frame=wx, delay=delay)
            if sc == 'clean':
                clean['mask'] = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
            rep = bm.evaluate(o, test, y, clean['mask'], new['bundle']['horizons'][h], area, True, clim)
            if sc == 'clean':
                clean[h] = rep
            res['scenarios'][sc][str(h)] = summarize(rep, clean[h])
            v = res['scenarios'][sc][str(h)]
            print(f"[stress] {sc:17s} h={h} RMSE {v['rmse']:,.0f} x{v['rmse_ratio_vs_clean']:.2f} medNSE {v['median_nse']:.3f}", flush=True)
    sample = test[test.station_id.isin(sorted(held_o)[:3])].reset_index(drop=True)
    proc = psutil.Process(os.getpid())
    rss0 = proc.memory_info().rss
    t = time.perf_counter()
    for h in bm.HORIZONS:
        routed(new, old, sample, h, '2022-01-01', sample.drainage_area_sqmi.to_numpy(float) >= LARGE_SQMI)
    secs = time.perf_counter() - t
    res['efficiency'] = {'rows': len(sample), 'horizons': 3, 'cpu_threads': os.cpu_count(), 'seconds_total': secs,
                         'ms_per_1000_forecasts_all_heads_all_horizons': 1000 * secs / len(sample) * 1000,
                         'model_file_mb': 13.6 + 46.5, 'rss_increase_mb': (proc.memory_info().rss - rss0) / 1e6,
                         'peak_process_rss_mb': proc.memory_info().rss / 1e6}
    (EXP / f'basinshift_stress_routed{tag}.json').write_text(json.dumps(res, indent=2), encoding='utf-8')


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--new', default='models_aug_holdout.joblib', help='small/medium-river model file in data/experiments/basinshift_model')
    ap.add_argument('--tag', default='', help='suffix for the output files')
    args = ap.parse_args()
    new = joblib.load(EXP / args.new)
    old = joblib.load(EXP / 'models_heldout.joblib')
    bm.HORIZONS[:] = [1, 3, 7]
    df = pd.read_csv('data/augmented_v2/train_augmented.csv', dtype={'station_id': str}).sort_values(['station_id', 'date']).reset_index(drop=True)
    orig_ids = sorted(df[df.source == 'original'].station_id.unique())
    car_ids = sorted(df[df.source == 'caravan'].station_id.unique())
    held_o = sorted(np.random.default_rng(42).choice(orig_ids, size=max(2, len(orig_ids) // 5), replace=False).tolist())
    held_c = sorted(np.random.default_rng(7).choice(car_ids, size=60, replace=False).tolist())
    results = {}
    for label, ids, t0, t1, old_cut in (('heldout_gauges', held_o, '2022-01-01', '2024-12-31', '2022-01-01'),
                                        ('heldout_caravan', held_c, '2010-01-01', '2014-12-31', '2010-01-01')):
        test = df[df.station_id.isin(ids)].sort_values(['station_id', 'date']).reset_index(drop=True)
        in_test = ((test.date >= t0) & (test.date <= t1)).to_numpy()
        y, area = test.discharge_cfs.to_numpy(float), test.drainage_area_sqmi.to_numpy(float)
        clim = bm.clim_forecast(test, (test.date < t0).to_numpy())
        big = area >= LARGE_SQMI
        res = {'label': label, 'test_rows': int(in_test.sum()), 'test_stations': len(ids), 'large_stations': int(test[big].station_id.nunique()), 'horizons': {}}
        for h in bm.HORIZONS:
            o = routed(new, old, test, h, old_cut, big)
            mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
            rep = bm.evaluate(o, test, y, mask, new['bundle']['horizons'][h], area, True, clim)
            res['horizons'][str(h)] = rep
            f = rep['forecast']
            print(f"[{label}] h={h} rows={rep['rows_scored']:,} routed RMSE {f['basinshift_blend']['rmse']:,.1f} persist {f['persistence']['rmse']:,.1f} "
                  f"ratio {f['basinshift_blend']['rmse'] / f['persistence']['rmse']:.3f} | medNSE {f['basinshift_blend']['median_basin_nse']:.3f} vs {f['persistence']['median_basin_nse']:.3f} "
                  f"| cov {rep['interval_90']['coverage']:.3f} | Q90 AUPRC {rep['events']['high_flow_q90']['model'].get('auprc', float('nan')):.3f}", flush=True)
        results[label] = res
    (EXP / f'basinshift_routed{args.tag}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    stress(new, old, df, held_o, args.tag)


if __name__ == '__main__':
    main()
