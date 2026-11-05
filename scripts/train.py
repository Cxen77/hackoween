"""Train the BASINSHIFT-style forecaster (LightGBM per horizon, +1/+3/+7 days) from the combined training table.

This wraps the training code in scripts/train_augmented_v2.py so there is one documented entry point.

Modes
  holdout  leave out the 11 USGS gauges and 60 Caravan basins in models/holdout_ids.json, then train. This is the
           version that is served and that the reported numbers come from. About 14 minutes on a 12-thread CPU.
  final    train on every gauge and basin (no held-out removal). About 14 minutes. NOT served by default; use it to
           produce an all-data model, then re-run scripts/evaluate.py before reporting anything from it.

Prerequisite: the combined table, built with
    python -m scripts.prepare_augmented --out data/augmented_v2
Outputs: data/experiments/basinshift_model/models_aug_<mode>[_tuned].joblib

Usage
    python -m scripts.train --mode holdout --tuned
    python -m scripts.train --mode final --tuned
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from scripts import train_augmented_v2 as v2

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--mode', choices=['holdout', 'final'], required=True)
    ap.add_argument('--tuned', action='store_true', help='use the tuned settings (5x weight on USGS rows, 127 leaves)')
    args = ap.parse_args()
    if not (ROOT / v2.CSV).exists():
        sys.exit(f'missing {v2.CSV}: build it first with python -m scripts.prepare_augmented --out data/augmented_v2')
    sys.argv = ['train_augmented_v2', '--mode', args.mode] + (['--tuned'] if args.tuned else [])
    v2.main()


if __name__ == '__main__':
    main()
