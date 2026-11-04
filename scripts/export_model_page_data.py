"""Export compact JSON for the Discharge ML Model page (public/reports/model/).

Files:
  summary.json         production FLOODCAST benchmark + BASINSHIFT held-out / Caravan / stress / efficiency summaries
  stations_2025.json   per-station actual vs predicted daily series for the 2025 public benchmark (production V2)
  forecast_bands.json  BASINSHIFT forecasts with 90% intervals + exceedance probabilities for held-out stations, 2024
Only already-computed evaluation outputs are read. Values are rounded to keep files small.

Usage: python -m scripts.export_model_page_data
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from solution import read_input
from scripts.basinshift_model import HORIZONS, forecast
from scripts.clean_data import clean_frame

OUT = Path('public/reports/model')
EXP = Path('data/experiments/basinshift_model')


def r(x, n=1):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), n)


def compact_horizon(h):
    f, i, e = h['forecast'], h['interval_90'], h['events']
    pick = lambda m: {k: r(m[k], 4) for k in ('rmse', 'extreme_rmse', 'mae', 'median_basin_nse', 'share_basins_nse_gt0')}
    ev = lambda m, p: {'auprc': r(m['auprc'], 4), 'persistence_auprc': r(p['auprc'], 4), 'recall_at_5pct': r(m['recall_at_5pct_alert_budget'], 4),
                       'precision_at_5pct': r(m['precision_at_5pct_alert_budget'], 4), 'brier_skill': r(m['brier_skill_vs_base_rate'], 4),
                       'ece': r(m['ece'], 4), 'events': m['events']}
    return {'rows': h['rows_scored'], 'blend': pick(f['basinshift_blend']), 'persistence': pick(f['persistence']),
            'climatology': pick(f['seasonal_climatology']), 'weather_only': pick(f['weather_only_gbm']),
            'interval': {'coverage': r(i['coverage'], 4), 'median_width_cfs': r(i['median_width_cfs'], 1), 'crps_approx_cfs': r(i['crps_approx_cfs'], 1)},
            'bootstrap': {k: [r(v, 4) for v in vals] for k, vals in h['bootstrap_vs_persistence'].items()},
            'high_flow_q90': ev(e['high_flow_q90']['model'], e['high_flow_q90']['persistence_indicator']),
            'extreme_flow_q99': ev(e['extreme_flow_q99']['model'], e['extreme_flow_q99']['persistence_indicator'])}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    demo = json.loads(Path('reports/demo_holdout.json').read_text(encoding='utf-8'))
    summary = {
        'floodcast': {'benchmark': 'Reused 2025 public benchmark (inspected during development; not a fresh untouched test).',
                      'model': 'ensemble_v2 = 0.25 baseline_log + 0.75 regional_raw (gradient boosting, same-day estimate, no discharge input)',
                      'overall': demo['overall'], 'median_baseline': demo['training_station_median_baseline'],
                      'train_rows': 293057, 'test_rows': demo['overall']['rows'], 'stations_trained': 55},
        'basinshift': {}}
    for label in ('heldout', 'caravan'):
        p = EXP / f'basinshift_{label}.json'
        if p.exists():
            res = json.loads(p.read_text(encoding='utf-8'))
            summary['basinshift'][label] = {'stations': res['test_stations'], 'rows': res['test_rows'],
                                            'horizons': {h: compact_horizon(v) for h, v in res['horizons'].items()}}
    for label in ('heldout', 'caravan'):
        p = EXP / f'basinshift_stress_{label}.json'
        if p.exists():
            s = json.loads(p.read_text(encoding='utf-8'))
            summary.setdefault('stress', {})[label] = {'basins': s['basins'], 'scenarios': {
                sc: {h: {k: r(v, 4) for k, v in vals.items() if k in ('rmse', 'rmse_ratio_vs_clean', 'median_nse', 'q90_auprc', 'interval_coverage', 'fallback_share')}
                     for h, vals in hs.items()} for sc, hs in s['scenarios'].items()}}
            if 'efficiency' in s:
                summary.setdefault('efficiency', {})[label] = {k: r(v, 2) if isinstance(v, float) else v for k, v in s['efficiency'].items() if k != 'note'}
    (OUT / 'summary.json').write_text(json.dumps(summary, separators=(',', ':')), encoding='utf-8')

    # 2025 per-station series (production V2).
    pa = pd.read_csv('evaluation/predictions_vs_actual.csv', dtype={'station_id': str})
    stations = []
    by_station = demo['by_station']
    for sid, g in pa.groupby('station_id'):
        g = g.sort_values('date')
        stations.append({'id': sid, 'name': g.station_name.iloc[0], 'metrics': {k: r(v, 4) for k, v in by_station.get(sid, {}).items()},
                         'dates': g.date.tolist(), 'actual': [r(v) for v in g.discharge_cfs_actual], 'pred': [r(v) for v in g.discharge_cfs_predicted]})
    stations.sort(key=lambda s: s['name'])
    (OUT / 'stations_2025.json').write_text(json.dumps(stations, separators=(',', ':')), encoding='utf-8')

    # BASINSHIFT forecast bands on held-out stations for 2024 (model never trained on these stations).
    saved = joblib.load(EXP / 'models_heldout.joblib')
    ours, _ = clean_frame(read_input('data/large/train/train.csv', True), target=True)
    ids = sorted(ours.station_id.unique())
    held = sorted(np.random.default_rng(42).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())
    names = pd.read_csv('data/large/metadata/station_metadata.csv', dtype=str).set_index('station_id').station_name
    test_df = ours[ours.station_id.isin(held)].sort_values(['station_id', 'date']).reset_index(drop=True)
    bands = {}
    for h in HORIZONS:
        o = forecast(saved['bundle'], test_df, saved['test_ref_cut'], h)
        in24 = (test_df.date >= '2024-01-01').to_numpy()
        for sid in held:
            m = in24 & (test_df.station_id == sid).to_numpy()
            entry = bands.setdefault(sid, {'id': sid, 'name': str(names.get(sid, sid)), 'dates': test_df.date[m].tolist(),
                                           'actual': [r(v) for v in test_df.discharge_cfs[m]], 'threshold_q90': r(o['thr'].T90[m].iloc[0]),
                                           'threshold_q99': r(o['thr'].T99[m].iloc[0]), 'horizons': {}})
            entry['horizons'][str(h)] = {'point': [r(v) for v in o['point'][m]], 'lo': [r(v) for v in o['lo'][m]], 'hi': [r(v) for v in o['hi'][m]],
                                         'p90': [r(v, 3) for v in o['p90'][m]], 'p99': [r(v, 3) for v in o['p99'][m]],
                                         'persistence': [r(v) for v in o['persistence'][m]]}
    (OUT / 'forecast_bands.json').write_text(json.dumps(sorted(bands.values(), key=lambda s: s['name']), separators=(',', ':')), encoding='utf-8')
    for f in sorted(OUT.glob('*.json')):
        print(f'{f.name:22s} {f.stat().st_size / 1e3:8.0f} KB')


if __name__ == '__main__':
    main()
