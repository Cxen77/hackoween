"""Regenerate every evaluation report from the shipped held-out models.

Tests (catchments the served models never trained on):
  * 11 USGS gauges, 2022-2024          (ids in models/holdout_ids.json)
  * 60 Caravan basins, 2010-2014       (ids in models/holdout_ids.json)
Routing is the same as the live server: drainage area >= 10,000 sq mi uses the large-river model.

Writes (under reports/):
  baseline_comparison.csv   routed model vs persistence, seasonal climatology, weather-only, per test set and horizon
  metrics_by_horizon.csv    routed model metrics at +1, +3, +7 days
  metrics_by_basin.csv      metrics for every held-out catchment and horizon
  ablations.csv             routed vs mixed-only vs gauge-only models, same splits
  figures/*.png             forecast examples, baseline comparison, catchment performance

Needs the combined training table, which is built locally (not in git):
    python -m scripts.prepare_augmented --out data/augmented_v2
Run time: several minutes (it scores every held-out catchment for three horizons, plus stress-free baselines).

Usage: python -m scripts.evaluate
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import scripts.basinshift_model as bm
from scripts.eval_routed import LARGE_SQMI, routed

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'models'
REPORTS = ROOT / 'reports'
FIG = REPORTS / 'figures'
DATA = ROOT / 'data' / 'augmented_v2' / 'train_augmented.csv'


def nse(y, p):
    den = np.sum((y - y.mean()) ** 2)
    return float(1 - np.sum((y - p) ** 2) / den) if den > 0 else float('nan')


def main() -> None:
    if not DATA.exists():
        raise SystemExit(f'missing {DATA}: build it with python -m scripts.prepare_augmented --out data/augmented_v2')
    REPORTS.mkdir(exist_ok=True)
    FIG.mkdir(exist_ok=True)
    new = joblib.load(MODELS / 'models_daily.joblib')     # mixed model (gauges + Caravan), tuned
    old = joblib.load(MODELS / 'models_large.joblib')     # USGS-gauge model, used for large rivers
    held = json.loads((MODELS / 'holdout_ids.json').read_text(encoding='utf-8'))
    bm.HORIZONS[:] = [1, 3, 7]
    df = pd.read_csv(DATA, dtype={'station_id': str}).sort_values(['station_id', 'date']).reset_index(drop=True)

    sets = [('unseen_gauges', held['usgs_gauges'], '2022-01-01', '2024-12-31', '2022-01-01'),
            ('unseen_caravan', held['caravan_basins'], '2010-01-01', '2014-12-31', '2010-01-01')]
    base_rows, basin_rows, horizon_rows, figdata = [], [], [], {}
    abl_rows = []
    for label, ids, t0, t1, old_cut in sets:
        test = df[df.station_id.isin(ids)].sort_values(['station_id', 'date']).reset_index(drop=True)
        in_test = ((test.date >= t0) & (test.date <= t1)).to_numpy()
        y, area = test.discharge_cfs.to_numpy(float), test.drainage_area_sqmi.to_numpy(float)
        clim = bm.clim_forecast(test, (test.date < t0).to_numpy())
        big = area >= LARGE_SQMI
        for h in bm.HORIZONS:
            o = routed(new, old, test, h, old_cut, big)
            mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
            rep = bm.evaluate(o, test, y, mask, new['bundle']['horizons'][h], area, True, clim)
            f = rep['forecast']
            for method, key in [('routed model (served)', 'basinshift_blend'), ('persistence', 'persistence'),
                                ('seasonal climatology', 'seasonal_climatology'), ('weather-only boosting', 'weather_only_gbm')]:
                m = f[key]
                base_rows.append({'test_set': label, 'horizon_days': h, 'method': method, 'rows': rep['rows_scored'],
                                  'rmse_cfs': round(m['rmse'], 1), 'extreme_rmse_cfs': round(m['extreme_rmse'], 1),
                                  'mae_cfs': round(m['mae'], 1), 'median_basin_nse': round(m['median_basin_nse'], 4)})
            pers = f['persistence']['rmse']
            horizon_rows.append({'test_set': label, 'horizon_days': h, 'rows': rep['rows_scored'],
                                 'rmse_routed': round(f['basinshift_blend']['rmse'], 1), 'rmse_persistence': round(pers, 1),
                                 'rmse_ratio': round(f['basinshift_blend']['rmse'] / pers, 4),
                                 'median_nse_routed': round(f['basinshift_blend']['median_basin_nse'], 4),
                                 'median_nse_persistence': round(f['persistence']['median_basin_nse'], 4),
                                 'interval_90_coverage': round(rep['interval_90']['coverage'], 4),
                                 'q90_auprc': round(rep['events']['high_flow_q90']['model'].get('auprc', float('nan')), 4),
                                 'q90_auprc_persistence': round(rep['events']['high_flow_q90']['persistence_indicator'].get('auprc', float('nan')), 4),
                                 'q99_auprc': round(rep['events']['extreme_flow_q99']['model'].get('auprc', float('nan')), 4)})
            # per catchment
            for sid in np.unique(test.station_id.to_numpy()[mask]):
                sel = mask & (test.station_id.to_numpy() == sid)
                yy, pm = y[sel], o['point'][sel]
                pp = np.where(np.isnan(o['persistence'][sel]), o['weather_only'][sel], o['persistence'][sel])
                rm, rp = np.sqrt(np.mean((yy - pm) ** 2)), np.sqrt(np.mean((yy - pp) ** 2))
                cov = float(np.mean((yy >= o['lo'][sel]) & (yy <= o['hi'][sel]))) if (~o['fallback'][sel]).any() else float('nan')
                basin_rows.append({'test_set': label, 'station_id': sid, 'horizon_days': h, 'days': int(sel.sum()),
                                   'drainage_area_sqmi': round(float(area[sel][0]), 1),
                                   'routed_model': 'models_large' if big[sel][0] else 'models_daily',
                                   'rmse_routed': round(rm, 1), 'rmse_persistence': round(rp, 1),
                                   'rmse_ratio': round(rm / rp, 4) if rp > 0 else float('nan'),
                                   'nse_routed': round(nse(yy, pm), 4), 'nse_persistence': round(nse(yy, pp), 4),
                                   'interval_90_coverage': round(cov, 4)})
            # ablations on the same rows: single mixed model, single gauge model
            mixed = bm.forecast(new['bundle'], test, '2000-01-01', h)
            gauge = bm.forecast(old['bundle'], test, old_cut, h)
            for name, arr in [('routed (served)', o['point']), ('mixed model only', mixed['point']), ('gauge model only', gauge['point'])]:
                pm = arr[mask]
                rmse = float(np.sqrt(np.mean((y[mask] - pm) ** 2)))
                abl_rows.append({'test_set': label, 'horizon_days': h, 'variant': name, 'rows': int(mask.sum()),
                                 'rmse_cfs': round(rmse, 1), 'rmse_ratio_vs_persistence': round(rmse / pers, 4)})
            if h == 1:
                figdata[label] = (test, o, mask, y)
    pd.DataFrame(base_rows).to_csv(REPORTS / 'baseline_comparison.csv', index=False)
    pd.DataFrame(horizon_rows).to_csv(REPORTS / 'metrics_by_horizon.csv', index=False)
    pd.DataFrame(basin_rows).to_csv(REPORTS / 'metrics_by_basin.csv', index=False)
    pd.DataFrame(abl_rows).to_csv(REPORTS / 'ablations.csv', index=False)
    make_figures(figdata, pd.DataFrame(horizon_rows), pd.DataFrame(basin_rows))
    print('wrote reports for', len(basin_rows), 'basin-horizon rows')


def make_figures(figdata, horizons, basins):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    # 1. observed vs predicted on one held-out gauge (+1 day, 2022-2024)
    test, o, mask, y = figdata['unseen_gauges']
    sid = test.station_id[mask].value_counts().index[0]
    sel = mask & (test.station_id.to_numpy() == sid)
    d = pd.to_datetime(test.date[sel])
    fig, ax = plt.subplots(figsize=(11, 4.2))
    ax.fill_between(d, o['lo'][sel], o['hi'][sel], color='#9ecae1', alpha=0.5, label='90% interval')
    ax.plot(d, y[sel], color='#0f172a', lw=1.2, label='observed')
    ax.plot(d, o['point'][sel], color='#0284c7', lw=1.0, label='forecast (+1 day)')
    ax.set_yscale('log')
    ax.set_title(f'Held-out gauge {sid}: observed vs +1 day forecast, 2022-2024')
    ax.set_ylabel('discharge (cfs, log scale)')
    ax.legend(loc='upper right')
    fig.tight_layout()
    fig.savefig(FIG / 'forecast_examples.png', dpi=130)
    plt.close(fig)
    # 2. routed model vs persistence by horizon, both test sets
    fig, ax = plt.subplots(figsize=(8, 4.5))
    w = 0.35
    for k, label in enumerate(['unseen_gauges', 'unseen_caravan']):
        h = horizons[horizons.test_set == label]
        x = np.arange(len(h)) + (k - 0.5) * w
        ax.bar(x, h.rmse_ratio, width=w, label={'unseen_gauges': '11 unseen USGS gauges', 'unseen_caravan': '60 unseen Caravan basins'}[label])
    ax.axhline(1.0, color='#e11d48', lw=1, ls='--', label='persistence (ratio 1.00)')
    ax.set_xticks(range(len(h)))
    ax.set_xticklabels([f'+{d} day' for d in h.horizon_days])
    ax.set_ylabel('RMSE ÷ persistence RMSE (below 1 wins)')
    ax.set_title('Routed forecaster against persistence on unseen catchments')
    ax.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(FIG / 'baseline_comparison.png', dpi=130)
    plt.close(fig)
    # 3. spread of per-catchment performance at +1 day
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for label, color in [('unseen_gauges', '#065a82'), ('unseen_caravan', '#e8a33d')]:
        r = basins[(basins.test_set == label) & (basins.horizon_days == 1)].rmse_ratio.dropna()
        ax.hist(r, bins=20, alpha=0.7, color=color, label=f'{label.replace("_", " ")} (n={len(r)})')
    ax.axvline(1.0, color='#e11d48', lw=1, ls='--')
    ax.set_xlabel('RMSE ÷ persistence RMSE per catchment, +1 day (below 1 wins)')
    ax.set_ylabel('number of catchments')
    ax.set_title('Performance varies across catchments')
    ax.legend(fontsize=9)
    fig.tight_layout()
    fig.savefig(FIG / 'catchment_performance.png', dpi=130)
    plt.close(fig)


if __name__ == '__main__':
    main()
