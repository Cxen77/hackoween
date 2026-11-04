"""Add vetted USGS stations (reports/expansion_candidates.json) to a NEW dataset folder, resumably.

The FLOODCAST brief allows adding stations from the same sources. This script:
  1. copies the existing raw response cache from data/large/raw so cached stations never call APIs again;
  2. runs the standard downloader for existing + candidate stations into --output (default data/large_plus);
  3. fetches StreamStats / GAGES-II static basin attributes for all stations.
Open-Meteo has a DAILY quota. If it is exhausted the affected stations are logged as skipped and the cache keeps
every completed response, so simply rerun this command after the quota resets. The quota is never bypassed.

Usage: python -m scripts.expand_stations
Then retrain/compare:
  python solution.py --improved --regional --train data/large_plus/train.csv --test data/large_plus/test.csv \
      --metadata data/large_plus/station_metadata.csv --experiment data/experiments/plus_v1 \
      --output data/experiments/plus_v1/predictions.csv --metrics data/experiments/plus_v1/run_metrics.json
"""
from __future__ import annotations

import argparse
import json
import shutil
from argparse import Namespace
from pathlib import Path

from scripts import download_data, download_catchments


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default='data/large')
    ap.add_argument('--output', default='data/large_plus')
    ap.add_argument('--candidates', default='reports/expansion_candidates.json')
    ap.add_argument('--start', default='2010-01-01')
    ap.add_argument('--end', default='2025-12-31')
    ap.add_argument('--test-start', default='2025-01-01')
    args = ap.parse_args()

    out, src = Path(args.output), Path(args.source)
    (out / 'raw').mkdir(parents=True, exist_ok=True)
    for f in (src / 'raw').iterdir():  # reuse cached responses; copy only what is missing
        target = out / 'raw' / f.name
        if not target.exists():
            shutil.copy2(f, target)

    new_ids = [c['id'] for c in json.loads(Path(args.candidates).read_text(encoding='utf-8'))]
    merged = list(dict.fromkeys(list(download_data.LARGE_SITE_IDS) + new_ids))
    download_data.LARGE_SITE_IDS = merged  # discover_stations() reads this module global
    print(f'{len(download_data.LARGE_SITE_IDS) - len(new_ids)} existing + {len(new_ids)} candidate stations', flush=True)

    download_data.main(Namespace(large=True, start=args.start, end=args.end, test_start=args.test_start, output=str(out)))
    download_catchments.main(Namespace(data=str(out)))
    print('EXPANSION DOWNLOAD COMPLETE. Check provenance.json for skipped stations; rerun after quota reset if any.', flush=True)


if __name__ == '__main__':
    main()
