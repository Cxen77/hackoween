"""Train the production forecasting model for EVERY day from +1 to +7 and save data/experiments/basinshift_model/models_daily.joblib.

Same recipe as scripts/basinshift_model.py (0.5 persistence + 0.5 boosted-tree change model, conformal 90% interval,
isotonic-calibrated Q90/Q99 exceedance classifiers), fitted on all 55 USGS gauges, but only the heads the live server uses:
the point model, the 5% and 95% quantiles and the two classifiers. (The 25/50/75% heads exist only for the CRPS estimate in the
benchmark.) Horizons +2, +4, +5 and +6 are new; check them with
    python -m scripts.basinshift_model --experiment heldout --horizons 1 2 3 4 5 6 7 --tag _daily

Usage: python -m scripts.train_daily_model
"""
from __future__ import annotations

import time
from pathlib import Path

import joblib

import scripts.basinshift_model as bm
from solution import read_input
from scripts.clean_data import clean_frame

OUT = Path('data/experiments/basinshift_model/models_daily.joblib')


def main() -> None:
    bm.HORIZONS[:] = [1, 2, 3, 4, 5, 6, 7]
    bm.QUANTILES[:] = [0.05, 0.95]
    ours, _ = clean_frame(read_input('data/large/train/train.csv', True), target=True)
    fit_df = ours.sort_values(['station_id', 'date']).reset_index(drop=True)
    t = time.time()
    print(f'training horizons {bm.HORIZONS} on {len(fit_df):,} rows / {fit_df.station_id.nunique()} stations', flush=True)
    bundle = bm.fit_bundle(fit_df, '2023-01-01', '2023-01-01', '2025-01-01')
    joblib.dump({'bundle': bundle, 'fit_ref_cut': '2023-01-01', 'test_ref_cut': '2000-01-01'}, OUT, compress=3)
    print(f'saved {OUT} ({OUT.stat().st_size / 1e6:.1f} MB) in {(time.time() - t) / 60:.1f} min', flush=True)


if __name__ == '__main__':
    main()
