"""BASINSHIFT Test C style stress tests + efficiency measurement on a saved model bundle.

Perturbation families (published method, fixed seeds): random missing observations (10%, 30%), short contiguous gaps
(7-day blocks, ~10% of days), measurement noise, delayed discharge availability (one extra day). Perturbations hit the
INPUTS only (past discharge and weather); targets stay true. The thresholds come from the unperturbed reference period.
Missing history rule (gaps <= 7 days filled, else weather-only fallback) is part of the model, not the test.

Reported: relative degradation vs the clean run (RMSE ratio, median-NSE change, AUPRC change, interval coverage,
fallback share), plus efficiency: model size, latency per 1,000 forecasts (CPU), memory.

Usage: python -m scripts.basinshift_stress --experiment heldout --out data/experiments/basinshift_model
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import psutil

from solution import read_input
from scripts.basinshift_model import HORIZONS, clim_forecast, evaluate, forecast
from scripts.clean_data import clean_frame

SCENARIOS = ['clean', 'missing_10pct', 'missing_30pct', 'gaps_7day_blocks', 'noise', 'delay_1day']


def perturb(frame: pd.DataFrame, scenario: str, seed: int = 2026):
    """Return (hist_frame, weather_frame, delay). Copies; the input frame is untouched."""
    rng = np.random.default_rng(seed)
    hist, wx = frame.copy(), frame.copy()
    n = len(frame)
    wcols = ['precipitation_mm', 'temp_max_c', 'temp_min_c', 'soil_moisture']
    if scenario in ('missing_10pct', 'missing_30pct'):
        rate = 0.10 if scenario == 'missing_10pct' else 0.30
        hist.loc[rng.random(n) < rate, 'discharge_cfs'] = np.nan
        wx.loc[rng.random(n) < rate, wcols] = np.nan
    elif scenario == 'gaps_7day_blocks':
        # Per station, start 7-day blocks at random so that ~10% of days are inside a block.
        for target, cols in ((hist, ['discharge_cfs']), (wx, wcols)):
            for sid, idx in frame.groupby('station_id').indices.items():
                starts = rng.random(len(idx)) < (0.10 / 7)
                hit = np.zeros(len(idx), bool)
                for s in np.flatnonzero(starts):
                    hit[s:s + 7] = True
                target.iloc[idx[hit], [target.columns.get_loc(c) for c in cols]] = np.nan
    elif scenario == 'noise':
        hist['discharge_cfs'] = frame.discharge_cfs * np.exp(rng.normal(0, 0.10, n))
        wx['precipitation_mm'] = (frame.precipitation_mm * np.exp(rng.normal(0, 0.20, n))).clip(lower=0)
        for c in ('temp_max_c', 'temp_min_c'):
            wx[c] = frame[c] + rng.normal(0, 1.0, n)
    delay = 1 if scenario == 'delay_1day' else 0
    return hist, wx, delay


def summarize(rep, clean):
    f, fc = rep['forecast']['basinshift_blend'], clean['forecast']['basinshift_blend']
    ev, ec = rep['events']['high_flow_q90']['model'], clean['events']['high_flow_q90']['model']
    return {'rmse': f['rmse'], 'rmse_ratio_vs_clean': f['rmse'] / fc['rmse'], 'median_nse': f['median_basin_nse'],
            'median_nse_change': f['median_basin_nse'] - fc['median_basin_nse'], 'extreme_rmse_ratio_vs_clean': f['extreme_rmse'] / fc['extreme_rmse'],
            'q90_auprc': ev.get('auprc'), 'q90_auprc_change': (ev.get('auprc') - ec.get('auprc')) if ev.get('auprc') is not None else None,
            'interval_coverage': rep.get('interval_90', {}).get('coverage'), 'fallback_share': rep['fallback_rows'] / max(rep['rows_scored'], 1),
            'persistence_rmse': rep['forecast']['persistence']['rmse']}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--experiment', choices=['heldout', 'caravan'], required=True)
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--caravan', default='data/external/caravan/Caravan')
    ap.add_argument('--out', default='data/experiments/basinshift_model')
    ap.add_argument('--caravan-subset', type=int, default=100, help='basins used for stress runs (runtime)')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--efficiency-only', action='store_true', help='skip scenarios; merge efficiency into existing results')
    args = ap.parse_args()
    out = Path(args.out)
    saved = joblib.load(out / f'models_{args.experiment}.joblib')
    bundle, test_ref_cut = saved['bundle'], saved['test_ref_cut']
    ours, _ = clean_frame(read_input(args.train, True), target=True)
    if args.experiment == 'heldout':
        ids = sorted(ours.station_id.unique())
        held = sorted(np.random.default_rng(args.seed).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())
        test_df, t0, t1 = ours[ours.station_id.isin(held)], '2022-01-01', '2024-12-31'
    else:
        from scripts.external_caravan_eval import load_basins
        caravan, _ = clean_frame(load_basins(Path(args.caravan), set(ours.station_id)), target=True)
        caravan = caravan[caravan.date >= '1995-01-01']
        pick = sorted(np.random.default_rng(7).choice(sorted(caravan.station_id.unique()), size=args.caravan_subset, replace=False))
        test_df, t0, t1 = caravan[caravan.station_id.isin(pick)], '2010-01-01', '2020-12-31'
    test_df = test_df.sort_values(['station_id', 'date']).reset_index(drop=True)
    in_test = ((test_df.date >= t0) & (test_df.date <= t1)).to_numpy()
    y, area = test_df.discharge_cfs.to_numpy(float), test_df.drainage_area_sqmi.to_numpy(float)
    clim = clim_forecast(test_df, (test_df.date < test_ref_cut).to_numpy())
    print(f'stress test on {test_df.station_id.nunique()} catchments, {int(in_test.sum()):,} test rows', flush=True)

    results = {'experiment': args.experiment, 'basins': int(test_df.station_id.nunique()), 'scenarios': {}}
    result_path = out / f'basinshift_stress_{args.experiment}.json'
    if args.efficiency_only:
        results = json.loads(result_path.read_text(encoding='utf-8'))
    clean_reports = {}
    for scenario in ([] if args.efficiency_only else SCENARIOS):
        hist, wx, delay = perturb(test_df, scenario)
        results['scenarios'][scenario] = {}
        for h in HORIZONS:
            o = forecast(bundle, test_df, test_ref_cut, h, hist_frame=hist, weather_frame=wx, delay=delay)
            if scenario == 'clean':
                mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
                clean_reports['mask'] = mask
            rep = evaluate(o, test_df, y, clean_reports['mask'], bundle['horizons'][h], area, True, clim)
            if scenario == 'clean':
                clean_reports[h] = rep
            results['scenarios'][scenario][str(h)] = summarize(rep, clean_reports[h])
            s = results['scenarios'][scenario][str(h)]
            print(f"{scenario:18s} h={h} RMSE {s['rmse']:>9,.0f} (x{s['rmse_ratio_vs_clean']:.2f} vs clean) medNSE {s['median_nse']:.3f} "
                  f"q90 AUPRC {s['q90_auprc']:.3f} cov {s['interval_coverage'] if s['interval_coverage'] is None else round(s['interval_coverage'], 3)} "
                  f"fallback {s['fallback_share']:.2%}", flush=True)
        (out / f'basinshift_stress_{args.experiment}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')

    # Efficiency: CPU latency and memory for a full 3-horizon forecast on 20,000 rows.
    # Whole station histories (the reference period is needed for thresholds); timing is per scored forecast.
    first = sorted(test_df.station_id.unique())[:3]
    sample = test_df[test_df.station_id.isin(first)].reset_index(drop=True)
    proc = psutil.Process(os.getpid())
    rss0 = proc.memory_info().rss
    t = time.perf_counter()
    for h in HORIZONS:
        forecast(bundle, sample, test_ref_cut, h)
    secs = time.perf_counter() - t
    results['efficiency'] = {'rows': len(sample), 'horizons': len(HORIZONS), 'cpu_threads': os.cpu_count(),
                             'seconds_total': secs, 'ms_per_1000_forecasts_all_heads_all_horizons': 1000 * secs / len(sample) * 1000,
                             'model_file_mb': (out / f'models_{args.experiment}.joblib').stat().st_size / 1e6,
                             'rss_increase_mb': (proc.memory_info().rss - rss0) / 1e6, 'peak_process_rss_mb': proc.memory_info().rss / 1e6,
                             'note': 'CPU-only, includes feature construction and 8 LightGBM heads per horizon.'}
    print('efficiency', json.dumps(results['efficiency']), flush=True)
    (out / f'basinshift_stress_{args.experiment}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
