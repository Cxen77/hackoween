"""Score the model against LIVE NWIC observations at every Indian gauge in the registry (new rivers).

For each gauge the model server replays 1/3/7-day forecasts over the last 30 observed days, using only data that was
available at the time, and compares them with what the portal recorded. Results go to public/reports/model/india_live_test.json.
Needs the model server running (python -m server.model_api).

Usage: python -m scripts.india_live_test
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

API = 'http://127.0.0.1:8765/api/live_forecast?india='
OUT = Path('public/reports/model/india_live_test.json')


def main() -> None:
    reg = json.loads(Path('server/india_stations.json').read_text(encoding='utf-8'))['stations']
    rows, failed = [], []
    for s in reg:
        try:
            with urllib.request.urlopen(API + s['key'], timeout=180) as r:
                d = json.loads(r.read())
            if 'error' in d:
                raise RuntimeError(d['error'])
            hz = d['hindcast']['horizons']
            if not hz:
                raise RuntimeError('too few overlapping days for a hindcast')
            rows.append({'key': s['key'], 'station': s['station'], 'river': s['river'], 'state': s['state'], 'last_obs': d['origin_date'],
                         'mean_m3s': round(s['recent_mean_m3s'], 1), 'horizons': {h: {k: round(v, 3) for k, v in x.items()} for h, x in hz.items()}})
            h1 = hz.get('1', {})
            print(f"{s['station']:22s} {str(s['river'])[:14]:14s} h1 ratio {h1.get('rmse_ratio', float('nan')):.2f}  h7 ratio {hz.get('7', {}).get('rmse_ratio', float('nan')):.2f}", flush=True)
        except Exception as e:
            failed.append({'key': s['key'], 'error': str(e)[:120]})
            print('FAILED', s['station'], str(e)[:100], flush=True)
    summary = {}
    for h in ('1', '3', '7'):
        ratios = np.array([r['horizons'][h]['rmse_ratio'] for r in rows if h in r['horizons']])
        if len(ratios):
            summary[h] = {'stations': int(len(ratios)), 'median_rmse_ratio': float(np.median(ratios)), 'share_model_better_than_persistence': float((ratios < 1).mean()),
                          'p25': float(np.quantile(ratios, 0.25)), 'p75': float(np.quantile(ratios, 0.75))}
    OUT.write_text(json.dumps({'source': 'NWIC CWC manual daily discharge (m3/sec) via nwdp.nwic.gov.in; forecasts replayed over the last 30 observed days',
                               'window_days': 30, 'summary': summary, 'stations': rows, 'failed': failed}, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
