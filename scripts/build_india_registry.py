"""Build server/india_stations.json: Indian river gauges from the NWIC portal that have CURRENT daily discharge.

Source: NWIC National Water Data Portal (https://nwdp.nwic.gov.in), dataset "River Discharge (Manual - Daily), Central Water
Commission (CWC)". Each state has a 2001-2025 table and a 2026-2030 table (the live feed). Units are labelled m3/sec.
A station is kept when its 2026 record is current (last value within 14 days of the newest record in the portal), dense
(>= 60 daily values in the last 75 days) and a real river (mean flow >= 20 m3/s). Reference flow thresholds (Q90, Q99)
come from the station's own 2001-2025 history and are stored in cfs for the model.

Usage: python -m scripts.build_india_registry
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

B = 'https://nwdp.nwic.gov.in/api/3/action/'
CFS = 35.3146667
OUT = Path('server/india_stations.json')


def get(action: str, **params):
    url = B + action + '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'FLOODCAST-hackathon/1.0'}), timeout=180) as r:
        return json.loads(r.read())['result']


def all_rows(rid: str, **extra):
    rows, offset = [], 0
    while True:
        res = get('datastore_search', resource_id=rid, limit=32000, offset=offset, **extra)
        rows += res['records']
        offset += len(res['records'])
        if not res['records'] or offset >= res['total']:
            return rows


def frame(rows: list[dict]) -> pd.DataFrame:
    d = pd.DataFrame(rows)
    col = next(c for c in d.columns if re.search('discharge', c, re.I))
    tim = next(c for c in d.columns if re.search('time|date', c, re.I))
    out = pd.DataFrame({'station': d['Station'], 'river': d.get('River'), 'state': d.get('State'),
                        'lat': pd.to_numeric(d['Latitude'], errors='coerce'), 'lon': pd.to_numeric(d['Longitude'], errors='coerce'),
                        'time': pd.to_datetime(d[tim], format='%d-%m-%Y %H:%M', errors='coerce'),
                        'm3s': pd.to_numeric(d[col], errors='coerce')})
    return out.dropna(subset=['time', 'm3s'])


def main() -> None:
    pkg = get('package_search', q='title:"River Discharge (Manual - Daily), Central Water Commission"', rows=5)['results'][0]
    live_res = [r for r in pkg['resources'] if '2026' in r['name'] and r.get('datastore_active')]
    hist_res = {re.sub(r'.*CWC[ ,]*', '', r['name']).split('(')[0].strip().rstrip(',').lower(): r for r in pkg['resources'] if '2001' in r['name']}
    print(len(live_res), 'live 2026 tables;', len(hist_res), 'history tables', flush=True)

    def load(r):
        try:
            return r, frame(all_rows(r['id']))
        except Exception as e:
            return r, pd.DataFrame()
    with ThreadPoolExecutor(6) as ex:
        loaded = list(ex.map(load, live_res))
    live = pd.concat([f.assign(table=r['name']) for r, f in loaded if len(f)], ignore_index=True)
    newest = live.time.max()
    print('live rows', len(live), '| newest record in portal', newest, flush=True)

    keep = []
    for (st, riv, state), g in live.groupby(['station', 'river', 'state']):
        g = g.assign(day=g.time.dt.floor('D')).groupby('day').m3s.mean()
        recent = g[g.index >= newest.floor('D') - pd.Timedelta(days=74)]
        if g.index.max() >= newest.floor('D') - pd.Timedelta(days=14) and len(recent) >= 60 and recent.mean() >= 20:
            row = live[(live.station == st) & (live.river == riv)].iloc[0]
            keep.append({'station': st, 'river': riv, 'state': state, 'lat': float(row.lat), 'lon': float(row.lon), 'last_date': g.index.max().strftime('%Y-%m-%d'),
                         'recent_mean_m3s': float(recent.mean()), 'days_last_75': int(len(recent)), 'table': row.table, 'resource_id': next(r['id'] for r in live_res if r['name'] == row.table)})
    keep.sort(key=lambda x: -x['recent_mean_m3s'])
    print(len(keep), 'candidate current stations', flush=True)

    out = []
    for k in keep:
        state_key = k['state'].lower()
        hr = next((r for key, r in hist_res.items() if key == state_key or state_key in key), None)
        if hr is None:
            continue
        try:
            rows = all_rows(hr['id'], filters=json.dumps({'Station': k['station']}))
            h = frame(rows) if rows else pd.DataFrame()
        except Exception:
            continue
        if h.empty:
            continue
        d = h.assign(day=h.time.dt.floor('D')).groupby('day').m3s.mean()
        if len(d) < 1500:
            continue
        k.update({'history_days': int(len(d)), 'history_span': [d.index.min().strftime('%Y-%m-%d'), d.index.max().strftime('%Y-%m-%d')],
                  'threshold_q90_cfs': float(np.quantile(d, 0.9) * CFS), 'threshold_q99_cfs': float(np.quantile(d, 0.99) * CFS),
                  'key': re.sub(r'[^a-z0-9]+', '-', f"{k['station']}-{k['river']}-{k['state']}".lower()).strip('-')})
        out.append(k)
        print(f"  {k['station']:22s} {str(k['river'])[:18]:18s} {k['state'][:16]:16s} mean {k['recent_mean_m3s']:9.0f} m3/s | history {k['history_days']} days | last {k['last_date']}", flush=True)
        if len(out) >= 40:
            break
    OUT.write_text(json.dumps({'source': 'NWIC National Water Data Portal, CWC manual daily discharge (m3/sec)', 'built': str(pd.Timestamp.today().date()), 'stations': out}, indent=1), encoding='utf-8')
    print('wrote', OUT, len(out), 'stations')


if __name__ == '__main__':
    main()
