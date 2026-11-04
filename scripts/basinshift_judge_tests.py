"""Judge-facing tests from the BASINSHIFT PDF that were not yet run, saved to public/reports/model/judge_tests.json.

Test A (temporal): stations the model WAS trained on, but only dates >= 2022-01-01 (after the fit and calibration periods).
H1 ablation: does adding static catchment attributes help unseen catchments? Same model, with vs without attributes,
             scored on the held-out stations (the model never saw them).
Uses the saved heldout bundle for Test A; trains 3 small heads per variant for the ablation.

Usage: python -m scripts.basinshift_judge_tests
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np

from solution import read_input
from scripts.basinshift_model import HORIZONS, P, build, clim_forecast, evaluate, forecast, point_metrics
from scripts.basinshift_stress import SCENARIOS  # noqa: F401  (keeps the scenario names importable)
from scripts.clean_data import clean_frame
from scripts.export_model_page_data import compact_horizon, r

EXP = Path('data/experiments/basinshift_model')
OUT = Path('public/reports/model/judge_tests.json')
STATIC = ['drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct',
          'log_drainage_area', 'rain_drainage_interaction']


def main() -> None:
    saved = joblib.load(EXP / 'models_heldout.joblib')
    ours, _ = clean_frame(read_input('data/large/train/train.csv', True), target=True)
    ids = sorted(ours.station_id.unique())
    held = sorted(np.random.default_rng(42).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())
    seen = ours[~ours.station_id.isin(held)].sort_values(['station_id', 'date']).reset_index(drop=True)
    unseen = ours[ours.station_id.isin(held)].sort_values(['station_id', 'date']).reset_index(drop=True)
    results = {'test_a_temporal': {}, 'h1_static_attributes': {}}

    # ---- Test A: trained stations, dates >= 2022 (reference period < 2022)
    y, area = seen.discharge_cfs.to_numpy(float), seen.drainage_area_sqmi.to_numpy(float)
    in_test = (seen.date >= '2022-01-01').to_numpy()
    clim = clim_forecast(seen, (seen.date < '2022-01-01').to_numpy())
    results['test_a_temporal'] = {'stations': int(seen.station_id.nunique()), 'rows': int(in_test.sum()), 'horizons': {}}
    for h in HORIZONS:
        o = forecast(saved['bundle'], seen, '2022-01-01', h)
        mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
        results['test_a_temporal']['horizons'][str(h)] = compact_horizon(evaluate(o, seen, y, mask, saved['bundle']['horizons'][h], area, True, clim))
        f = results['test_a_temporal']['horizons'][str(h)]
        print(f"Test A h={h}: RMSE blend {f['blend']['rmse']:.0f} vs persistence {f['persistence']['rmse']:.0f}; median NSE {f['blend']['median_basin_nse']:.3f} vs {f['persistence']['median_basin_nse']:.3f}", flush=True)

    # ---- H1: with vs without static catchment attributes (mean head only, blend point forecast)
    fit_df = seen
    cal_start = '2020-07-01'
    in_train = (fit_df.date < cal_start).to_numpy()
    yf = fit_df.discharge_cfs.to_numpy(float)
    ytest = unseen.discharge_cfs.to_numpy(float)
    in_u = (unseen.date >= '2022-01-01').to_numpy()
    results['h1_static_attributes'] = {'heldout_stations': len(held), 'horizons': {}}
    for h in HORIZONS:
        Xf, thr_f, lag_f = build(fit_df, '2022-01-01', h)
        Xu, thr_u, lag_u = build(unseen, '2022-01-01', h)
        ok = ~np.isnan(lag_f) & ~np.isnan(thr_f.T90.to_numpy()) & in_train
        r_fit = np.log1p(yf) - np.log1p(lag_f)
        mask = in_u & ~np.isnan(lag_u) & ~np.isnan(thr_u.T90.to_numpy())
        entry = {}
        for name, drop in [('with_attributes', []), ('without_attributes', STATIC)]:
            cols = [c for c in Xf.columns if c not in drop]
            m = lgb.LGBMRegressor(**P).fit(Xf.loc[ok, cols], r_fit[ok])
            point = 0.5 * lag_u + 0.5 * np.expm1(np.log1p(lag_u) + m.predict(Xu[cols]))
            pm = point_metrics(ytest[mask], point[mask], unseen.station_id.to_numpy()[mask])
            entry[name] = {k: r(v, 4) for k, v in pm.items() if k in ('rmse', 'extreme_rmse', 'mae', 'median_basin_nse')}
        results['h1_static_attributes']['horizons'][str(h)] = entry
        print(f"H1 h={h}: with {entry['with_attributes']} | without {entry['without_attributes']}", flush=True)

    OUT.write_text(json.dumps(results, separators=(',', ':')), encoding='utf-8')
    print('wrote', OUT)


if __name__ == '__main__':
    main()
