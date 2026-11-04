"""Write data/experiments/basinshift_model/model_meta.json: everything the model server needs from the training data.

Per training gauge: Q90/Q99 flow thresholds, static basin attributes, name and coordinates, plus the row count and cleaning
report. With this file next to models_caravan.joblib the server runs WITHOUT the dataset (data/large is then optional).

Usage: python -m scripts.export_model_meta
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from solution import read_input
from scripts.clean_data import clean_frame

OUT = Path('data/experiments/basinshift_model/model_meta.json')
STATIC = ['drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct', 'impervious_surface_pct']


def num(v):
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else float(v)


def main() -> None:
    ours, quality = clean_frame(read_input('data/large/train/train.csv', True), target=True)
    meta = pd.read_csv('data/large/metadata/station_metadata.csv', dtype={'station_id': str}).set_index('station_id')
    thr = ours.groupby('station_id').discharge_cfs.quantile([0.9, 0.99]).unstack()
    static = ours.sort_values('date').groupby('station_id')[STATIC].last()
    out = {
        'note': 'Derived from the cleaned training data (2010-2024, 55 USGS gauges). Lets the model server run without the dataset.',
        'train_rows': int(len(ours)), 'quality': {k: v for k, v in quality.items() if k != 'note'},
        'thresholds': {sid: {'T90': num(thr.loc[sid].iloc[0]), 'T99': num(thr.loc[sid].iloc[1])} for sid in thr.index},
        'static': {sid: {c: num(static.loc[sid, c]) for c in STATIC} for sid in static.index},
        'stations': {sid: {'station_name': str(meta.loc[sid, 'station_name']), 'latitude': float(meta.loc[sid, 'latitude']),
                           'longitude': float(meta.loc[sid, 'longitude'])} for sid in thr.index},
    }
    OUT.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(f'wrote {OUT} ({OUT.stat().st_size / 1e3:.1f} KB) for {len(out["thresholds"])} gauges')


if __name__ == '__main__':
    main()
