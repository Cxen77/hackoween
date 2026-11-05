# Data dictionary

## Training file: `data/large/train/train.csv`
293,057 rows, 12 columns, 55 USGS gauges, 2010-01-01 to 2024-12-31. One row = one gauge on one day.

| Column | Type | Units | Meaning | Range in file |
|---|---|---|---|---|
| station_id | text | USGS site number, leading zeros kept | gauge id | 55 ids |
| date | YYYY-MM-DD | local day | observation day | 2010-01-01 to 2024-12-31 |
| discharge_cfs | number | cubic feet per second | **target**: daily mean discharge (USGS 00060, statistic 00003) | 0 to 2,310,000 |
| precipitation_mm | number | mm per day | daily precipitation (Open-Meteo archive) | 0 to 311.6 |
| temp_max_c | number | degrees C | daily maximum air temperature | -30 to 48 |
| temp_min_c | number | degrees C | daily minimum air temperature | -39.7 to 32.2 |
| soil_moisture | number | m3/m3 (fraction) | volumetric soil water, layer 1, daily mean | 0 to 0.52 |
| drainage_area_sqmi | number | square miles | land area draining to the gauge | 48.9 to 1,144,500 |
| mean_elevation_ft | number | feet | mean catchment elevation | 57 to 8,646 |
| slope_pct | number | percent | mean catchment slope | 0.07 to 35.0 |
| forest_cover_pct | number | percent | share of catchment under forest | 2.1 to 79.5 |
| impervious_surface_pct | number | percent | share of catchment impervious | 0.07 to 18.6 |

## Test file: `test/test.csv`
19,306 rows, 11 columns, 53 USGS gauges, all of 2025. The same columns as training, **without** `discharge_cfs`, because that is the prediction target. The two training gauges with no 2025 rows are not in the file.

## Combined file: `data/augmented_v2/train_augmented.csv`
5,887,304 rows, 13 columns: the 12 training columns plus `source` (`original` or `caravan`). 534 stations.
- Caravan rows: streamflow (mm/day) converted to cfs using catchment area, so units match the gauges.
- `impervious_surface_pct` is empty for Caravan rows (no source value).
- Removal counts: `data/augmented_v2/data_quality_report.json`.

## FLOODCAST files: `test/predictions.csv`, `test/actuals.csv`
- `station_id,date,discharge_cfs`, one row per test row, in the same order as `test/test.csv`.
- Non-negative numbers, no duplicates, no NaN (checked by the validator).

## Forecast output (`scripts/predict.py`)
`station_id, origin_date, horizon_days, target_date, model, point_cfs, lo_cfs, hi_cfs, p_high_flow, p_extreme_flow, persistence_cfs, used_fallback`
- `point_cfs`, `lo_cfs`, `hi_cfs`: cfs. `lo_cfs` and `hi_cfs` are empty when `used_fallback` is true (the gap rule).
- `p_high_flow`, `p_extreme_flow`: probability in [0, 1] of exceeding Q90 / Q99 on the target day.

## Model metadata: `models/model_meta.json`
- `thresholds`: per gauge, `T90` and `T99` in cfs.
- `static`: per gauge catchment facts.
- `stations`: name, latitude and longitude.
