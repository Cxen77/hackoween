# FLOODCAST model card

## Identity and intended use

- Model: `ensemble_v2`; selected and trained during this project session, not imported as an external pretrained model.
- Implementation: `solution.py` `--improved --regional` and `scripts/improve_model.py`, scikit-learn, fixed seed 42.
- Selected components: [{"kind": "baseline_log", "weight": 0.25}, {"kind": "regional_raw", "weight": 0.75}].
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

Features: `precipitation_mm`, `temp_max_c`, `temp_min_c`, `soil_moisture`, `drainage_area_sqmi`, `mean_elevation_ft`, `slope_pct`, `forest_cover_pct`, `impervious_surface_pct`, `season_sin`, `season_cos`, `temperature_range`, `temperature_mean`, `rain_soil_interaction`, `rain_drainage_interaction`, `rain_squared`, `log_drainage_area`, `freezing_precipitation`, `rain_previous_3d`, `rain_previous_7d`, `rain_previous_14d`, `rain_previous_30d`, `regional_rain`, `regional_soil`, `regional_temperature`, `regional_station_count`, `regional_rain_previous_3d`, `regional_rain_previous_7d`, `regional_rain_previous_14d`, `regional_rain_previous_30d`, `regional_rain_previous_60d`, `regional_rain_previous_90d`, `regional_soil_previous_14d`, `huc2_02`, `huc2_03`, `huc2_04`, `huc2_05`, `huc2_06`, `huc2_07`, `huc2_08`, `huc2_09`, `huc2_10`, `huc2_12`, `huc2_13`, `huc2_14`, `huc2_15`, `huc2_16`, `huc2_17`, `huc2_18`.

Candidates: Original raw/log baselines; enriched raw/log, peak-weighted, drainage-normalized and Poisson gradient boosting; and validation-selected convex ensembles. Additional experiments remove coordinate predictors and add weather-only hydrologic-region proxies. Peak sample weights use fitting labels only. Drainage-normalized models learn cfs per square mile and multiply predictions by the known drainage area. Missing/nonpositive drainage uses a median calculated on fitting rows only. Other numeric missing values use training-only median imputation with missingness indicators. Predictions are clipped at zero. Regional rainfall features, when used, are averages of available weather points in a hydrologic region (with upstream-region pooling for the Lower Mississippi); these are approximate proxies, NOT area-weighted basin rainfall.

The pipeline does not use station identity as a predictor, any discharge lag or target encoding, StreamStats discharge statistics/quantiles, actual test labels, or data from another team's model. Station IDs are used only to group prior weather and to construct validation splits. Weather windows are closed on the right at the preceding instant (`closed='left'`); current/future rainfall is excluded from antecedent totals.

## Validation and results

Validation cutoff: **2022-01-01**. Temporal fit uses earlier dates; geographic fit additionally excludes entire held-out stations. Geographic validation includes only later dates from those stations. Held-out station IDs: 01578310, 01638500, 02084000, 03353000, 05114000, 05586100, 07032000, 07289000, 09380000, 11425500, 12113000.

Candidates and fixed-grid two-model ensembles selected using training-period temporal/geographic validation only. Gate requires lower overall AND extreme RMSE in BOTH splits. 2025 labels are not read. The 2025 public benchmark was previously inspected for diagnostics; it is not a newly untouched independent test. No benchmark target is read by training or ensemble selection. This is a local selection criterion, **not** the organizers' leaderboard normalization.

| Evaluation | Rows | RMSE (cfs) | Extreme RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: | ---: |
| Training fit (not validation) | 293,057 | 35,802.67 | 71,227.04 | 12,837.63 | 0.9560 |
| Later-date validation | 58,645 | 47,231.75 | 53,138.15 | 16,815.95 | 0.8809 |
| Unseen-station + later-date validation | 12,051 | 72,109.45 | 115,119.10 | 27,945.71 | 0.9015 |
| 2025 reused public benchmark | 19,306 | 46,542.88 | 111,776.95 | 14,002.94 | 0.9149 |
| Holdout training-station median baseline | 19,306 | 85,499.67 | 180,500.17 | 25,871.75 | 0.7129 |

Extreme events are the actual top 10% of discharge within each evaluated station, including ties at the 90th percentile. Lower RMSE/MAE is better. Negative R² indicates performance worse than predicting that evaluation group's mean; these failures are retained, not hidden. The earlier five-station experiment used a different period/features and is archived separately; its scores are not directly comparable to this larger run.

### Public holdout by station

| Station | Rows | RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: |
| 01463500 | 365 | 7,283.48 | 3,698.50 | 0.3400 |
| 01470500 | 365 | 561.22 | 394.02 | 0.1464 |
| 01491000 | 365 | 794.73 | 511.69 | -89.7825 |
| 01570500 | 365 | 20,311.77 | 12,779.38 | 0.4752 |
| 01578310 | 365 | 24,013.73 | 15,550.46 | 0.3887 |
| 01638500 | 365 | 8,905.51 | 3,766.36 | 0.3908 |
| 01646500 | 365 | 9,599.52 | 5,252.29 | 0.4009 |
| 02035000 | 365 | 6,688.53 | 2,843.56 | 0.4394 |
| 02037500 | 365 | 7,217.79 | 3,140.92 | 0.4387 |
| 02084000 | 365 | 1,630.39 | 1,081.55 | 0.3660 |
| 02087500 | 365 | 1,018.73 | 727.71 | 0.1316 |
| 02138500 | 365 | 675.14 | 337.43 | -16.3783 |
| 02197000 | 365 | 2,993.56 | 2,284.81 | -0.1293 |
| 02231000 | 365 | 891.88 | 697.79 | -2.9700 |
| 02323500 | 326 | 2,739.75 | 2,124.52 | 0.1204 |
| 02428400 | 365 | 20,318.47 | 12,928.82 | 0.4821 |
| 02479000 | 365 | 5,556.78 | 3,665.25 | 0.4766 |
| 03086000 | 365 | 13,793.74 | 10,770.75 | 0.6960 |
| 03303280 | 365 | 81,751.22 | 54,240.31 | 0.6766 |
| 03339000 | 365 | 898.06 | 663.77 | 0.2099 |
| 03353000 | 365 | 1,514.12 | 831.20 | 0.6893 |
| 03451500 | 365 | 1,178.82 | 984.28 | -0.5137 |
| 04024000 | 365 | 1,040.15 | 693.55 | 0.2963 |
| 04193500 | 365 | 5,584.56 | 2,894.02 | 0.5656 |
| 04213500 | 365 | 773.80 | 418.93 | 0.1122 |
| 05054000 | 365 | 1,678.33 | 1,194.95 | -1.7901 |
| 05114000 | 365 | 2,147.23 | 1,495.23 | -384.2043 |
| 05464500 | 365 | 5,442.67 | 3,680.24 | 0.2136 |
| 05586100 | 365 | 10,041.50 | 8,829.32 | -0.5231 |
| 06813500 | 365 | 21,121.17 | 18,716.44 | -3.1292 |
| 06934500 | 365 | 27,611.98 | 24,285.12 | 0.2802 |
| 07010000 | 365 | 65,974.30 | 53,983.93 | 0.3662 |
| 07022000 | 365 | 66,144.26 | 53,778.19 | 0.5350 |
| 07032000 | 365 | 180,196.78 | 110,660.36 | 0.6759 |
| 07289000 | 365 | 189,385.67 | 129,327.25 | 0.7436 |
| 07374000 | 365 | 159,285.45 | 115,530.96 | 0.7317 |
| 08067000 | 365 | 10,642.47 | 6,890.62 | 0.3256 |
| 08158000 | 365 | 2,838.42 | 1,798.49 | -44.0671 |
| 08170500 | 365 | 642.58 | 262.62 | -6897.4038 |
| 08313000 | 365 | 2,097.32 | 1,536.00 | -36.1204 |
| 09380000 | 365 | 1,978.51 | 1,751.07 | -0.6901 |
| 09402500 | 365 | 7,914.83 | 3,745.54 | -27.7108 |
| 10109000 | 365 | 171.32 | 127.83 | -1.0374 |
| 10311000 | 365 | 641.50 | 416.49 | -3.6873 |
| 11251000 | 365 | 1,038.35 | 894.60 | -19.0448 |
| 11370500 | 365 | 8,317.37 | 5,327.82 | -0.0211 |
| 11425500 | 365 | 10,289.93 | 7,087.15 | 0.5611 |
| 12020000 | 365 | 1,288.73 | 932.89 | -1.0264 |
| 12113000 | 365 | 1,381.07 | 1,018.79 | 0.4977 |
| 12353000 | 365 | 3,475.37 | 2,802.43 | -0.2910 |
| 12422500 | 365 | 3,828.36 | 2,847.09 | 0.4642 |
| 14105700 | 365 | 39,416.45 | 30,210.92 | 0.0067 |
| 14211720 | 365 | 12,472.13 | 8,472.34 | 0.8473 |

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
python solution.py --improved --regional --metadata data/event/station_metadata.csv --train data/event/train.csv --test data/event/test.csv --output predictions.csv --metrics reports/event_metrics.json
python scripts/validate_submission.py --test data/event/test.csv --predictions predictions.csv
```

The generator preserves leading-zero station IDs, enforces strict future test dates, rejects target-bearing test inputs, and checks exact UTF-8 output columns/order, row/key coverage, finite nonnegative values, and the reopened file. Predictions are produced by running code and must not be edited manually. Only the organizers can calculate official hidden-test and leaderboard scores.
