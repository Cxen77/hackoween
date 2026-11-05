"""Score the production (augmented, +1/+3/+7) model on data it never saw: everything from 2015-01-01 on.

The model trains on rows before 2015 (calibration 2012-2014). Test: the 55 USGS gauges, 2015-2024 (thresholds from model_meta.json, as in the live server). Caravan has no
streamflow after 2014, so no unseen-time Caravan test exists.
Writes basinshift_augmented_original.json and basinshift_stress_augmented.json in data/experiments/basinshift_model/.

Usage: python -m scripts.eval_augmented
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

EXP = Path('data/experiments/basinshift_model')
TEST_START = '2015-01-01'


def score(bundle, df, test_end, label, ref_cut, thr_override=None):
    df = df.sort_values(['station_id', 'date']).reset_index(drop=True)
    in_test = ((df.date >= TEST_START) & (df.date <= test_end)).to_numpy()
    y = df.discharge_cfs.to_numpy(float)
    area = df.drainage_area_sqmi.to_numpy(float)
    clim = bm.clim_forecast(df, (df.date < TEST_START).to_numpy())
    thr = thr_override(df) if thr_override else None
    res = {'label': label, 'test_rows': int(in_test.sum()), 'test_stations': int(df[in_test].station_id.nunique()), 'horizons': {}}
    for h in bundle['horizons']:
        o = bm.forecast(bundle, df, ref_cut, h, thr_override=thr)
        mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
        rep = bm.evaluate(o, df, y, mask, bundle['horizons'][h], area, True, clim)
        res['horizons'][str(h)] = rep
        f = rep['forecast']
        print(f"[{label}] h={h} rows={rep['rows_scored']:,} RMSE blend {f['basinshift_blend']['rmse']:,.1f} persist {f['persistence']['rmse']:,.1f} "
              f"| median NSE {f['basinshift_blend']['median_basin_nse']:.3f} vs {f['persistence']['median_basin_nse']:.3f} | 90% cov {rep['interval_90']['coverage']:.3f}", flush=True)
    (EXP / f'basinshift_augmented_{label}.json').write_text(json.dumps(res, indent=2), encoding='utf-8')


def main() -> None:
    saved = joblib.load(EXP / 'models_daily.joblib')
    bundle = saved['bundle']
    bm.HORIZONS[:] = sorted(bundle['horizons'])
    meta = json.loads((EXP / 'model_meta.json').read_text(encoding='utf-8'))
    ours, _ = clean_frame(read_input('data/large/train/train.csv', True), target=True)

    def meta_thr(df):
        t = pd.DataFrame(meta['thresholds']).T
        return df[['station_id']].join(t, on='station_id')[['T90', 'T99']]

    score(bundle, ours, '2024-12-31', 'original', saved['fit_ref_cut'], meta_thr)
    stress(bundle, ours, saved, meta_thr)


def stress(bundle, ours, saved, meta_thr):
    """Missing/gap/noise/delay stress tests and CPU efficiency on 20 of the 55 gauges, 2015-2024."""
    import os, time, psutil
    from scripts.basinshift_stress import SCENARIOS, perturb, summarize
    pick = sorted(np.random.default_rng(7).choice(sorted(ours.station_id.unique()), size=20, replace=False))
    df = ours[ours.station_id.isin(pick)].sort_values(['station_id', 'date']).reset_index(drop=True)
    in_test = (df.date >= TEST_START).to_numpy()
    y, area = df.discharge_cfs.to_numpy(float), df.drainage_area_sqmi.to_numpy(float)
    clim = bm.clim_forecast(df, (df.date < TEST_START).to_numpy())
    thr = meta_thr(df)
    res = {'experiment': 'augmented', 'basins': len(pick), 'scenarios': {}}
    clean = {}
    for sc in SCENARIOS:
        hist, wx, delay = perturb(df, sc)
        res['scenarios'][sc] = {}
        for h in bundle['horizons']:
            o = bm.forecast(bundle, df, saved['fit_ref_cut'], h, hist_frame=hist, weather_frame=wx, delay=delay, thr_override=thr)
            if sc == 'clean':
                clean['mask'] = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
            rep = bm.evaluate(o, df, y, clean['mask'], bundle['horizons'][h], area, True, clim)
            if sc == 'clean':
                clean[h] = rep
            res['scenarios'][sc][str(h)] = summarize(rep, clean[h])
            v = res['scenarios'][sc][str(h)]
            print(f"[stress] {sc:17s} h={h} RMSE {v['rmse']:,.0f} x{v['rmse_ratio_vs_clean']:.2f} medNSE {v['median_nse']:.3f}", flush=True)
    sample = df[df.station_id.isin(sorted(pick)[:3])].reset_index(drop=True)
    proc = psutil.Process(os.getpid())
    rss0 = proc.memory_info().rss
    t = time.perf_counter()
    for h in bundle['horizons']:
        bm.forecast(bundle, sample, saved['fit_ref_cut'], h, thr_override=meta_thr(sample))
    secs = time.perf_counter() - t
    res['efficiency'] = {'rows': len(sample), 'horizons': len(bundle['horizons']), 'cpu_threads': os.cpu_count(), 'seconds_total': secs,
                         'ms_per_1000_forecasts_all_heads_all_horizons': 1000 * secs / len(sample) * 1000,
                         'model_file_mb': (EXP / 'models_daily.joblib').stat().st_size / 1e6,
                         'rss_increase_mb': (proc.memory_info().rss - rss0) / 1e6, 'peak_process_rss_mb': proc.memory_info().rss / 1e6}
    (EXP / 'basinshift_stress_augmented.json').write_text(json.dumps(res, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
