"""Documented cleaning rules applied before any fitting or scoring (BASINSHIFT data-processing rules).

Rules (every exclusion is counted in the returned report):
  1. non-finite or negative discharge -> row dropped (a missing label is NEVER replaced by zero)
  2. duplicate (station_id, date) -> keep first
  3. missing/non-finite dynamic weather inputs (precipitation, tmax, tmin, soil moisture) -> row dropped, not filled
  4. physically impossible values: precipitation < 0 -> row dropped; soil moisture clipped to [0, 1];
     tmin > tmax -> row dropped
  5. stations with fewer than --min-days remaining rows -> station dropped
Static basin attributes (elevation, slope, forest, impervious) are NOT filled here: real gaps stay missing and are
imputed only inside the model pipeline with statistics fitted on training rows. No long-gap forward fill is done.

Usage: python -m scripts.clean_data --input data/large/train/train.csv --output data/large/train/train_clean.csv
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

DYNAMIC = ['precipitation_mm', 'temp_max_c', 'temp_min_c', 'soil_moisture']


def clean_frame(df: pd.DataFrame, target: bool = True, min_days: int = 100) -> tuple[pd.DataFrame, dict]:
    report = {'rows_in': int(len(df)), 'stations_in': int(df.station_id.nunique())}
    d = df.copy()
    n = len(d)
    if target:
        y = pd.to_numeric(d.discharge_cfs, errors='coerce')
        bad = ~np.isfinite(y) | (y < 0)
        report['dropped_bad_discharge'] = int(bad.sum())
        d = d[~bad.to_numpy()]
    dup = d.duplicated(['station_id', 'date'], keep='first')
    report['dropped_duplicates'] = int(dup.sum())
    d = d[~dup]
    for c in DYNAMIC:
        d[c] = pd.to_numeric(d[c], errors='coerce').replace([np.inf, -np.inf], np.nan)
    missing = d[DYNAMIC].isna().any(axis=1)
    report['dropped_missing_weather'] = int(missing.sum())
    d = d[~missing]
    report['clipped_soil_moisture'] = int(((d.soil_moisture < 0) | (d.soil_moisture > 1)).sum())
    d['soil_moisture'] = d.soil_moisture.clip(0, 1)
    impossible = (d.precipitation_mm < 0) | (d.temp_min_c > d.temp_max_c)
    report['dropped_impossible_weather'] = int(impossible.sum())
    d = d[~impossible]
    counts = d.groupby('station_id').size()
    short = counts[counts < min_days].index.tolist()
    report['dropped_short_stations'] = short
    d = d[~d.station_id.isin(short)]
    report.update({'rows_out': int(len(d)), 'rows_removed_total': int(n - len(d)) + int(len(df) - n),
                   'stations_out': int(d.station_id.nunique()),
                   'static_attribute_missing_rows': {c: int(d[c].isna().sum()) for c in
                                                     ['mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']
                                                     if c in d},
                   'note': 'Static attribute gaps are real and left missing; imputed only inside the model with training-fit medians.'})
    return d.reset_index(drop=True), report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--report', default=None)
    ap.add_argument('--no-target', action='store_true')
    args = ap.parse_args()
    df = pd.read_csv(args.input, dtype={'station_id': str})
    cleaned, report = clean_frame(df, target=not args.no_target)
    cleaned.to_csv(args.output, index=False)
    path = Path(args.report or Path(args.output).with_suffix('.quality.json'))
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
