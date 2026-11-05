"""Train the augmented BASINSHIFT model on original + Caravan data, horizons +1, +3, +7.

Uses the cleaned combined dataset from scripts/prepare_augmented.py.
Same recipe: 0.5 persistence + 0.5 LightGBM residual, conformal 90% interval,
isotonic-calibrated Q90/Q99 exceedance classifiers.

The original stations use reference cut 2023-01-01 (test period 2023-2024).
Caravan stations use reference cut 2010-01-01 (data from 1981-2020).
We unify by using 2010-01-01 as the reference cut: rows < 2010 set thresholds,
rows 2010-2019 are main training, 2020+ calibration.

Usage: python -m scripts.train_augmented
"""
from __future__ import annotations

import time
from pathlib import Path

import joblib
import pandas as pd

import scripts.basinshift_model as bm

AUGMENTED_CSV = Path('data/augmented/train_augmented.csv')
OUT = Path('data/experiments/basinshift_model/models_augmented.joblib')


def main() -> None:
    bm.HORIZONS[:] = [1, 3, 7]
    bm.QUANTILES[:] = [0.05, 0.95]

    print(f'Loading augmented dataset from {AUGMENTED_CSV}...', flush=True)
    df = pd.read_csv(AUGMENTED_CSV, dtype={'station_id': str})
    print(f'  {len(df):,} rows, {df.station_id.nunique()} stations', flush=True)

    # Sort by station and date for history features
    df = df.sort_values(['station_id', 'date']).reset_index(drop=True)

    # Reference/calibration cuts:
    #   Caravan data: 1981-01-01 to 2014-12-31
    #   Original data: 2010-01-01 to 2024-12-31
    #   - Thresholds from reference period < 2000 (Caravan gets 19 years of reference)
    #   - Train on rows < 2012 (main bulk of both sources)
    #   - Calibrate on 2012-2015 (both sources present: Caravan 2012-2014, Original 2012-2014)
    fit_ref_cut = '2000-01-01'   # thresholds from rows < this date
    cal_start   = '2012-01-01'   # calibration period starts here
    fit_end     = '2015-01-01'   # training ends here (exclusive)

    t = time.time()
    print(f'Training horizons {bm.HORIZONS} with ref_cut={fit_ref_cut}, cal={cal_start}-{fit_end}', flush=True)
    print(f'  Train rows (< {cal_start}): {(df.date < cal_start).sum():,}', flush=True)
    print(f'  Cal rows ({cal_start} to {fit_end}): {((df.date >= cal_start) & (df.date < fit_end)).sum():,}', flush=True)

    bundle = bm.fit_bundle(df, fit_ref_cut, cal_start, fit_end)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        'bundle': bundle,
        'fit_ref_cut': fit_ref_cut,
        'test_ref_cut': '2010-01-01',
        'training_info': {
            'total_rows': int(len(df)),
            'total_stations': int(df.station_id.nunique()),
            'horizons': bm.HORIZONS[:],
            'quantiles': bm.QUANTILES[:],
            'augmented': True,
            'sources': {'original': int((df.source == 'original').sum()),
                        'caravan': int((df.source == 'caravan').sum())},
        }
    }, OUT, compress=3)
    elapsed = (time.time() - t) / 60
    size_mb = OUT.stat().st_size / 1e6
    print(f'Saved {OUT} ({size_mb:.1f} MB) in {elapsed:.1f} min', flush=True)


if __name__ == '__main__':
    main()

