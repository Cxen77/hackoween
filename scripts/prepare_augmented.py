"""Prepare a clean, augmented training dataset: original 55 USGS gauges + Caravan US basins.

Steps:
  1. Load original training rows from data/large/train/train.csv
  2. Load all 482 Caravan US basins, converting to FLOODCAST schema
  3. Remove any Caravan basins whose gauge ID overlaps with the 55 training stations
  4. Apply clean_frame() to each source independently (documented cleaning rules)
  5. Run additional Caravan-specific QA (negative streamflow, extreme outliers, gaps)
  6. Concatenate and save a combined CSV + quality report

The output dataset has columns:
  station_id, date, discharge_cfs, precipitation_mm, temp_max_c, temp_min_c,
  soil_moisture, drainage_area_sqmi, mean_elevation_ft, slope_pct,
  forest_cover_pct, impervious_surface_pct, source

Usage: python -m scripts.prepare_augmented [--out data/augmented]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from solution import read_input
from scripts.clean_data import clean_frame
from scripts.external_caravan_eval import load_basins


def caravan_qa(df: pd.DataFrame, min_years: int = 5) -> tuple[pd.DataFrame, dict]:
    """Extra Caravan-specific cleaning beyond clean_frame.

    - Remove basins with < min_years of data (too sparse for training)
    - Flag/remove extreme discharge outliers (>99.99th percentile across all basins,
      which are often data errors in Caravan)
    - Remove rows where streamflow == 0 for >90 consecutive days (likely regulation artefact)
    - Report stats
    """
    report = {'rows_in': int(len(df)), 'basins_in': int(df.station_id.nunique())}

    # Remove basins with too few rows
    min_days = min_years * 365
    counts = df.groupby('station_id').size()
    short = counts[counts < min_days].index.tolist()
    report['basins_removed_short'] = len(short)
    report['basins_removed_short_ids'] = short[:20]  # sample
    df = df[~df.station_id.isin(short)].copy()

    # Flag extreme discharge outliers (likely data errors)
    q9999 = df.discharge_cfs.quantile(0.9999)
    extreme = df.discharge_cfs > q9999
    report['extreme_discharge_threshold_cfs'] = float(q9999)
    report['extreme_discharge_rows_removed'] = int(extreme.sum())
    df = df[~extreme]

    # Flag long zero-discharge runs (>90 consecutive days) — these basins are probably
    # regulated or have data gaps. Remove the zero-run rows, not the whole basin.
    zero_runs_removed = 0
    keep = pd.Series(True, index=df.index)
    for sid, g in df.groupby('station_id'):
        is_zero = (g.discharge_cfs == 0).to_numpy()
        if not is_zero.any():
            continue
        # count consecutive zeros
        run = 0
        runs = np.zeros(len(is_zero), dtype=int)
        for i in range(len(is_zero)):
            if is_zero[i]:
                run += 1
            else:
                run = 0
            runs[i] = run
        # mark rows in runs longer than 90 days
        max_run = 90
        in_long = np.zeros(len(is_zero), dtype=bool)
        for i in range(len(is_zero) - 1, -1, -1):
            if runs[i] >= max_run:
                in_long[i] = True
            elif runs[i] > 0 and i + 1 < len(is_zero) and in_long[i + 1]:
                in_long[i] = True
        n = int(in_long.sum())
        if n > 0:
            keep.iloc[keep.index.get_indexer(g.index[in_long])] = False
            zero_runs_removed += n

    report['long_zero_run_rows_removed'] = zero_runs_removed
    df = df[keep]

    # Clip soil moisture to [0, 1] (ERA5-Land volumetric can slightly exceed 1)
    sm_clipped = ((df.soil_moisture < 0) | (df.soil_moisture > 1)).sum()
    report['soil_moisture_clipped'] = int(sm_clipped)
    df['soil_moisture'] = df.soil_moisture.clip(0, 1)

    report['rows_out'] = int(len(df))
    report['basins_out'] = int(df.station_id.nunique())
    report['date_range'] = [str(df.date.min()), str(df.date.max())]

    return df.reset_index(drop=True), report


def summarize_dataset(df: pd.DataFrame, label: str) -> dict:
    """Summary stats for a dataset."""
    return {
        'label': label,
        'rows': int(len(df)),
        'stations': int(df.station_id.nunique()),
        'date_range': [str(df.date.min()), str(df.date.max())],
        'discharge_cfs': {
            'mean': float(df.discharge_cfs.mean()),
            'median': float(df.discharge_cfs.median()),
            'max': float(df.discharge_cfs.max()),
            'min': float(df.discharge_cfs.min()),
            'std': float(df.discharge_cfs.std()),
        },
        'missing_attrs': {c: int(df[c].isna().sum()) for c in
                         ['mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']
                         if c in df.columns},
        'precipitation_mm_mean': float(df.precipitation_mm.mean()),
        'soil_moisture_mean': float(df.soil_moisture.mean()),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description='Prepare clean augmented training dataset')
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--caravan', default='data/external/caravan/Caravan')
    ap.add_argument('--out', default='data/augmented')
    ap.add_argument('--min-caravan-years', type=int, default=5,
                    help='Min years of data for a Caravan basin to be included')
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    # ── 1. Load & clean original training data ──────────────────────
    print('=' * 60)
    print('STEP 1: Loading original training data...')
    ours_raw = read_input(args.train, True)
    print(f'  Raw: {len(ours_raw):,} rows, {ours_raw.station_id.nunique()} stations')
    ours, ours_report = clean_frame(ours_raw, target=True)
    ours['source'] = 'original'
    print(f'  Cleaned: {len(ours):,} rows, {ours.station_id.nunique()} stations')
    print(f'  Dropped: {ours_report["rows_in"] - ours_report["rows_out"]:,} rows')

    train_ids = set(ours.station_id.unique())

    # ── 2. Load Caravan data ────────────────────────────────────────
    print('=' * 60)
    print('STEP 2: Loading Caravan US basins...')
    caravan_raw = load_basins(Path(args.caravan), exclude=train_ids)
    print(f'  Raw (excl overlap): {len(caravan_raw):,} rows, {caravan_raw.station_id.nunique()} basins')

    # ── 3. Clean Caravan with standard cleaning ─────────────────────
    print('STEP 3: Standard cleaning (clean_frame)...')
    caravan_clean, caravan_std_report = clean_frame(caravan_raw, target=True, min_days=100)
    print(f'  After clean_frame: {len(caravan_clean):,} rows, {caravan_clean.station_id.nunique()} basins')
    print(f'  Dropped: {caravan_std_report["rows_in"] - caravan_std_report["rows_out"]:,} rows')

    # ── 4. Caravan-specific QA ──────────────────────────────────────
    print('STEP 4: Caravan-specific QA...')
    caravan, caravan_qa_report = caravan_qa(caravan_clean, min_years=args.min_caravan_years)
    caravan['source'] = 'caravan'
    print(f'  After QA: {len(caravan):,} rows, {caravan.station_id.nunique()} basins')
    print(f'  Short basins removed: {caravan_qa_report["basins_removed_short"]}')
    print(f'  Extreme outlier rows removed: {caravan_qa_report["extreme_discharge_rows_removed"]}')
    print(f'  Long zero-run rows removed: {caravan_qa_report["long_zero_run_rows_removed"]}')

    # ── 5. Combine ──────────────────────────────────────────────────
    print('=' * 60)
    print('STEP 5: Combining datasets...')
    # Ensure column alignment
    common_cols = ['station_id', 'date', 'discharge_cfs', 'precipitation_mm',
                   'temp_max_c', 'temp_min_c', 'soil_moisture', 'drainage_area_sqmi',
                   'mean_elevation_ft', 'slope_pct', 'forest_cover_pct',
                   'impervious_surface_pct', 'source']
    for c in common_cols:
        if c not in ours.columns:
            ours[c] = np.nan
        if c not in caravan.columns:
            caravan[c] = np.nan

    combined = pd.concat([ours[common_cols], caravan[common_cols]], ignore_index=True)
    combined = combined.sort_values(['station_id', 'date']).reset_index(drop=True)

    print(f'  Combined: {len(combined):,} rows, {combined.station_id.nunique()} stations')
    print(f'    Original: {len(ours):,} rows ({ours.station_id.nunique()} stations)')
    print(f'    Caravan:  {len(caravan):,} rows ({caravan.station_id.nunique()} basins)')

    # ── 6. Save ─────────────────────────────────────────────────────
    print('=' * 60)
    print('STEP 6: Saving...')
    combined.to_csv(out / 'train_augmented.csv', index=False)
    print(f'  Saved {out / "train_augmented.csv"} ({(out / "train_augmented.csv").stat().st_size / 1e6:.1f} MB)')

    # Quality report
    quality = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'original': {
            'cleaning': ours_report,
            'summary': summarize_dataset(ours, 'original'),
        },
        'caravan': {
            'standard_cleaning': caravan_std_report,
            'qa_cleaning': caravan_qa_report,
            'summary': summarize_dataset(caravan, 'caravan'),
        },
        'combined': summarize_dataset(combined, 'combined'),
        'overlap_stations_excluded': sorted(train_ids),
    }
    (out / 'data_quality_report.json').write_text(
        json.dumps(quality, indent=2, default=str), encoding='utf-8')
    print(f'  Quality report: {out / "data_quality_report.json"}')

    elapsed = time.time() - t0
    print('=' * 60)
    print(f'DONE in {elapsed:.0f}s')
    print(f'  Total rows: {len(combined):,}')
    print(f'  Total stations: {combined.station_id.nunique()}')
    print(f'  Original fraction: {len(ours)/len(combined)*100:.1f}%')
    print(f'  Caravan fraction: {len(caravan)/len(combined)*100:.1f}%')


if __name__ == '__main__':
    main()

