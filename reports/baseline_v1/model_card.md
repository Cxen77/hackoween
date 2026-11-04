# FLOODCAST model card

## Identity and intended use

- Model: `hist_log`; selected and trained during this project session, not imported as an external pretrained model.
- Implementation: `solution.py`, scikit-learn HistGradientBoosting / ExtraTrees candidates, fixed seed 42.
- Intended use: retrospective daily river-discharge regression experiments and producing the exact competition CSV from supplied train/test features.
- Not intended for emergency warnings, evacuation decisions, calibrated inundation forecasts, or claims of reliable peak prediction at every unseen basin.
- Official event data was not supplied. Root `predictions.csv` covers the public experiment only.

## Actual data

Downloaded 55 stations, 2010-01-01 through 2025-12-31; 293,057 training records and 19,306 held-out public records. Training dates: 2010-01-01–2024-12-31; public holdout: 2025-01-01–2025-12-31.

Target: actual **USGS daily mean discharge in cfs**, parameter 00060, statistic 00003. This is not an instantaneous daily maximum. The participant brief mixes a peak-daily target description with daily-mean source examples; confirm the official target using event training data.

Weather: Open-Meteo historical reanalysis at actual NWIS gauge coordinates: daily precipitation, min/max temperature, and mean hourly 0–7 cm soil moisture. These are retrospective features, not weather known before the target day. Fixed historical climate model versions were not pinned; cached raw responses are retained to reproduce this run.

Catchments: actual published USGS StreamStats Gage Statistics basin characteristics, supplemented with static USGS GAGES-II watershed descriptors where StreamStats is missing. GAGES-II contributes basin mean elevation (metres converted to feet), slope percent, NLCD06 forest cover and imperviousness, and drainage area (km² converted to square miles); no flow-summary files are used. NWIS drainage area remains available as a further fallback. Fields with unknown, incompatible, or ambiguous units remain missing. Source records, variable codes, original units, converted values, and citations are in `reports/catchment_provenance.json`.

- `drainage_area_sqmi`: 48/55 stations have a mapped static value from StreamStats or GAGES-II.
- `mean_elevation_ft`: 34/55 stations have a mapped static value from StreamStats or GAGES-II.
- `slope_pct`: 34/55 stations have a mapped static value from StreamStats or GAGES-II.
- `forest_cover_pct`: 34/55 stations have a mapped static value from StreamStats or GAGES-II.
- `impervious_surface_pct`: 34/55 stations have a mapped static value from StreamStats or GAGES-II.

## Features and models

Features: `precipitation_mm`, `temp_max_c`, `temp_min_c`, `soil_moisture`, `drainage_area_sqmi`, `mean_elevation_ft`, `slope_pct`, `forest_cover_pct`, `impervious_surface_pct`, `season_sin`, `season_cos`, `temperature_range`, `temperature_mean`, `rain_soil_interaction`, `rain_drainage_interaction`, `rain_squared`, `log_drainage_area`, `freezing_precipitation`, `rain_previous_3d`, `rain_previous_7d`, `rain_previous_14d`, `rain_previous_30d`.

Candidates: raw-target gradient boosting, log-target gradient boosting, raw-target ExtraTrees, drainage-normalized gradient boosting, and drainage-normalized ExtraTrees. Drainage-normalized models learn cfs per square mile and multiply predictions by the known drainage area. Missing/nonpositive drainage uses a median calculated on fitting rows only. Other numeric missing values use training-only median imputation with missingness indicators. Predictions are clipped at zero.

The pipeline does not use station identity as a predictor, any discharge lag or target encoding, StreamStats discharge statistics/quantiles, actual test labels, or data from another team's model. Station IDs are used only to group prior weather and to construct validation splits. Weather windows are closed on the right at the preceding instant (`closed='left'`); current/future rainfall is excluded from antecedent totals.

## Validation and results

Validation cutoff: **2022-01-01**. Temporal fit uses earlier dates; geographic fit additionally excludes entire held-out stations. Geographic validation includes only later dates from those stations. Held-out station IDs: 01578310, 01638500, 02084000, 03353000, 05114000, 05586100, 07032000, 07289000, 09380000, 11425500, 12113000.

Model selection uses the mean of the two validation split scores: 40% overall RMSE ratio, 30% extreme RMSE ratio, 20% MAE ratio, 10% (1-R²) ratio, each relative to the fitting-set median baseline. This is a local selection criterion, **not** the organizers' leaderboard normalization. The final public holdout is evaluated only after selection and refitting on all training rows.

| Evaluation | Rows | RMSE (cfs) | Extreme RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: | ---: |
| Training fit (not validation) | 293,057 | 66,601.14 | 151,402.25 | 19,099.37 | 0.8478 |
| Later-date validation | 58,645 | 56,184.44 | 60,395.60 | 18,705.64 | 0.8315 |
| Unseen-station + later-date validation | 12,051 | 79,670.91 | 136,635.25 | 32,592.03 | 0.8797 |
| Separate 2025 public holdout | 19,306 | 52,695.26 | 113,268.22 | 16,063.87 | 0.8909 |
| Holdout training-station median baseline | 19,306 | 85,499.67 | 180,500.17 | 25,871.75 | 0.7129 |

Extreme events are the actual top 10% of discharge within each evaluated station, including ties at the 90th percentile. Lower RMSE/MAE is better. Negative R² indicates performance worse than predicting that evaluation group's mean; these failures are retained, not hidden. The earlier five-station experiment used a different period/features and is archived separately; its scores are not directly comparable to this larger run.

### Public holdout by station

| Station | Rows | RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: |
| 01463500 | 365 | 7,546.83 | 4,014.22 | 0.2914 |
| 01470500 | 365 | 516.54 | 261.05 | 0.2769 |
| 01491000 | 365 | 76.94 | 47.68 | 0.1492 |
| 01570500 | 365 | 23,114.69 | 13,033.93 | 0.3204 |
| 01578310 | 365 | 26,778.85 | 16,389.77 | 0.2398 |
| 01638500 | 365 | 8,773.84 | 3,335.96 | 0.4087 |
| 01646500 | 365 | 9,346.70 | 4,486.65 | 0.4320 |
| 02035000 | 365 | 6,384.29 | 2,507.75 | 0.4892 |
| 02037500 | 365 | 7,318.27 | 2,817.37 | 0.4230 |
| 02084000 | 365 | 1,681.64 | 921.99 | 0.3256 |
| 02087500 | 365 | 956.63 | 494.59 | 0.2342 |
| 02138500 | 365 | 111.14 | 36.72 | 0.5291 |
| 02197000 | 365 | 2,698.77 | 1,989.96 | 0.0821 |
| 02231000 | 365 | 396.90 | 205.51 | 0.2138 |
| 02323500 | 326 | 1,768.08 | 1,370.13 | 0.6337 |
| 02428400 | 365 | 21,537.92 | 13,873.95 | 0.4180 |
| 02479000 | 365 | 5,403.02 | 3,146.03 | 0.5051 |
| 03086000 | 365 | 15,152.08 | 10,121.83 | 0.6332 |
| 03303280 | 365 | 89,375.38 | 60,602.80 | 0.6135 |
| 03339000 | 365 | 527.19 | 249.40 | 0.7277 |
| 03353000 | 365 | 1,425.14 | 590.07 | 0.7247 |
| 03451500 | 365 | 789.34 | 551.05 | 0.3213 |
| 04024000 | 365 | 950.11 | 540.35 | 0.4129 |
| 04193500 | 365 | 4,663.28 | 2,098.10 | 0.6971 |
| 04213500 | 365 | 656.77 | 301.52 | 0.3604 |
| 05054000 | 365 | 1,086.19 | 749.97 | -0.1686 |
| 05114000 | 365 | 74.35 | 48.70 | 0.5382 |
| 05464500 | 365 | 5,816.94 | 3,650.03 | 0.1017 |
| 05586100 | 365 | 8,506.31 | 6,679.99 | -0.0930 |
| 06813500 | 365 | 16,304.11 | 14,474.06 | -1.4605 |
| 06934500 | 365 | 30,270.09 | 24,284.02 | 0.1350 |
| 07010000 | 365 | 75,173.79 | 62,012.06 | 0.1772 |
| 07022000 | 365 | 101,401.89 | 84,646.61 | -0.0928 |
| 07032000 | 365 | 175,821.58 | 128,804.30 | 0.6915 |
| 07289000 | 365 | 229,768.95 | 170,160.77 | 0.6225 |
| 07374000 | 365 | 184,031.18 | 145,565.11 | 0.6419 |
| 08067000 | 365 | 10,805.78 | 6,466.04 | 0.3048 |
| 08158000 | 365 | 436.03 | 280.06 | -0.0635 |
| 08170500 | 365 | 73.88 | 63.40 | -90.1940 |
| 08313000 | 365 | 661.81 | 507.91 | -2.6962 |
| 09380000 | 365 | 2,283.26 | 2,019.94 | -1.2508 |
| 09402500 | 365 | 3,528.16 | 2,803.24 | -4.7050 |
| 10109000 | 365 | 50.44 | 37.07 | 0.8234 |
| 10311000 | 365 | 212.21 | 122.04 | 0.4871 |
| 11251000 | 365 | 246.50 | 199.62 | -0.1296 |
| 11370500 | 365 | 8,597.00 | 4,312.02 | -0.0909 |
| 11425500 | 365 | 10,808.71 | 7,786.63 | 0.5157 |
| 12020000 | 365 | 481.86 | 152.34 | 0.7167 |
| 12113000 | 365 | 1,184.66 | 538.20 | 0.6304 |
| 12353000 | 365 | 2,155.60 | 1,550.01 | 0.5033 |
| 12422500 | 365 | 3,759.40 | 2,136.55 | 0.4833 |
| 14105700 | 365 | 34,125.54 | 26,236.50 | 0.2554 |
| 14211720 | 365 | 15,716.80 | 9,539.70 | 0.7575 |

## Known limitations

1. Local weather can poorly represent rainfall across a large catchment. No basin-average rainfall, routed upstream flow, snowpack evolution, or reservoir operations are modeled.
2. Historic weather is reanalysis, so reported accuracy does not establish operational forecast skill. An operational deployment needs forecast-vintage inputs and forecast-error evaluation.
3. Basin coverage is incomplete. Land-cover snapshots and published attributes may postdate early training records and may differ from current conditions; they are treated as allowed static descriptors, not time-correct reconstructions.
4. Station holdout is not a basin-disjoint spatial holdout: upstream/downstream gauges can share a river system. Geography claims should remain limited.
5. Raw public data can include provisional measurements. Negative/missing target sentinel values are excluded; raw quality qualifiers are retained in the cached USGS responses but not fully filtered for every data-quality category.
6. Extreme floods are rare; observed negative per-station R² values and peak errors show the limits of the model. More rows alone do not guarantee accuracy.
7. Station-local Open-Meteo days use civil time; USGS daily reporting can use fixed standard time, creating DST boundary mismatches.
8. The dashboard's GloFAS forecast is an external model, independent of this regression. The 3D connected-bathtub scenario is also independent of discharge predictions; converting discharge to flood depth requires a local rating curve and hydraulic modeling.

## Reproduction and submission checks

```powershell
python -m pip install -r requirements.txt
python scripts/prepare_large.py
python scripts/validate_submission.py --test data/large/test.csv --predictions predictions.csv
```

Official event run:

```powershell
python solution.py --train data/event/train.csv --test data/event/test.csv --output predictions.csv --metrics reports/event_metrics.json
python scripts/validate_submission.py --test data/event/test.csv --predictions predictions.csv
```

The generator preserves leading-zero station IDs, enforces strict future test dates, rejects target-bearing test inputs, and checks exact UTF-8 output columns/order, row/key coverage, finite nonnegative values, and the reopened file. Predictions are produced by running code and must not be edited manually. Only the organizers can calculate official hidden-test and leaderboard scores.
