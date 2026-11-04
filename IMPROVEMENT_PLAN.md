# Improve FLOODCAST prediction quality

This plan follows the uploaded participant brief and the measured errors of the frozen public-data model. It contains **proposed experiments, not claimed accuracy gains**. Current model: `hist_log`; 2025 public test R² 0.890945, RMSE 52,695.26 cfs, extreme RMSE 113,268.22 cfs, MAE 16,063.87 cfs.

## What the brief rewards

The participant statement (pages 1–3, 5–7) asks for numerical discharge prediction that generalizes to unseen stations. Final weights: overall RMSE 40%, per-station top-10% discharge RMSE 30%, MAE 20%, R² 10%. It initially ranks teams by overall RMSE. A high aggregate R² alone does not demonstrate good peak prediction. There is no classification “accuracy percentage” for this regression.

The brief says “peak daily discharge” but its USGS example explicitly names `00060_Mean`. Our public data uses statistic 00003 (daily mean). **Confirm the official event target before changing target definitions or claiming a valid official submission.** The actual event train/test CSVs are still absent.

## Measured causes and likely explanations

### 1. Errors are concentrated in a few large rivers

| Gauge | River/location | Share of total test squared error | Mean prediction bias on top-10% flow days |
| --- | --- | ---: | ---: |
| 07289000 | Mississippi, Vicksburg | 35.95% | -35.46% |
| 07374000 | Mississippi, Baton Rouge | 23.06% | -32.58% |
| 07032000 | Mississippi, Memphis | 21.05% | -29.98% |

Together these three account for **80.05%** of total squared error. All three have missing basin elevation, slope and forest-cover inputs. Across training rows, each of these physical features is missing in **36.59%** of records. Median imputation keeps training valid but does not recover the missing physical information.

The model has seen larger flows in training than these stations' 2025 maximum flows, so this is **not simply an unseen target-range problem**. For example, Vicksburg's training maximum is 2,310,000 cfs; its 2025 maximum is 1,610,000 cfs.

### 2. Important peaks are smoothed or missed

Potomac station01646500 on 2025-05-15: actual 136,000 cfs; prediction 36,182.53 cfs. The selected model minimizes squared error on `log1p(discharge)`. This treats relative differences more evenly and can favor ordinary-flow behavior at the expense of large raw-cfs peaks. This is a likely contributor, not a demonstrated sole cause.

Validation evidence supports testing a different loss/blend: raw-target gradient boosting had temporal extreme RMSE47,147 cfs versus60,396 for the selected log model, and unseen-station extreme RMSE102,403 versus136,635. However, its overall temporal RMSE was worse (68,412 versus56,184). **Blend and validate; do not automatically replace the model with raw-target training.**

### 3. Gauge-point rainfall is an incomplete description of large basins

Our weather is a single coordinate at each gauge. It does not measure rainfall across the upstream Mississippi catchment or route water arriving from its tributaries. It is therefore plausible that a large flood is weakly related to the local rainfall input. More years of the same point weather alone will not fix that missing information.

### 4. Aggregate metrics hide weak stations

11 of53 evaluated stations have negative R². Overall cfs metrics are dominated by very large rivers. Keep per-station and extreme-event results visible; do not present R²0.8909 as “89% accuracy.”

## Prioritized experiments

### A. Immediate work using already downloaded data

1. **Raw/log ensemble:** retain out-of-fold predictions from both models for each temporal/geographic validation split. Select blend weight using those validation predictions, balancing overall and extreme RMSE. Freeze the weight before evaluating the public test. Never fit it to `evaluation/predictions_vs_actual.csv`.
2. **Peak-weighted raw-target model:** calculate each fitting station's 90th-percentile target from fitting rows only. Compare modest training sample weights for those peak rows against unweighted fitting. The validation/test target may be used to calculate metrics, never to calculate training weights or input features.
3. **Richer weather memory:** test 45/60/90-day rainfall windows, 3/7/14-day mean soil moisture, temperature/soil changes, and temperature-derived freezing/melt proxies. Use closed-left time windows. Handle station/date gaps explicitly. These features can be generated from cached weather without further API calls.
4. **Geographic and physical interactions:** use permitted metadata latitude/longitude (if available consistently at train/test), basin area × wetness, and area/slope/land-cover interactions. Keep station IDs out of the predictive features so unknown stations remain supported.
5. **Compare stronger tree configurations:** test more leaf capacity/regularization and optionally LightGBM/XGBoost/CatBoost on the same folds. Do not assume a new library is better; accept it only on recorded validation evidence.

### B. Data improvements before further scale expansion

1. Recover actual mean basin elevation, slope and land cover for missing **large basins**, especially the three Mississippi sites above. Use actual basin geometry and authoritative zonal summaries if published station characteristics are unavailable. Do not substitute gauge altitude for mean basin elevation, or channel slope for basin slope.
2. Add basin-average/upstream weather with a consistent source and documented area weighting. This may require public basin forcings or gridded weather. Use forecast-vintage inputs for any future operational-skill claim; retrospective reanalysis scores alone are not forecast skill.
3. Add more **independent basins** with complete physical attributes, rather than mainly additional upstream/downstream gauges on the same rivers. Add flood-event coverage and report which held-out basins are regulated.
4. Check USGS quality flags, unusual values, seasonal/regulated behavior and daily reporting boundaries. Preserve genuine floods; do not remove high-flow rows merely because their errors are large.

Open-Meteo's daily quota was reached for one final station on this run. Resume cached acquisition after the provider reset; do not bypass limits. All immediate experiments above can use the already downloaded312,363 rows.

## Evaluation protocol and acceptance

- Keep the current model, CSV and scores as a frozen baseline.
- Use training-period rolling temporal splits and complete-station/basin holdouts for experiments. Tune only inside the training/validation period.
- Record overall RMSE, top-10% per-station RMSE, MAE, R², per-station scores, runtime, missingness and selected parameters for every candidate.
- Prefer an experiment that reduces both overall and extreme RMSE across the temporal and geographic splits; explain tradeoffs if one improves at the other's expense.
- The2025 public test has now been inspected to diagnose failure modes. It is a useful benchmark, but **must not be described as an untouched final test for subsequent choices informed by these diagnostics**. Use a newly reserved period/station group for a fresh final assessment when practical. The actual organizer's hidden test remains untouched.
- Preserve exact `station_id,date,discharge_cfs`, every test row and its order, leading-zero station IDs, UTF-8 and finite nonnegative outputs. Generate predictions by running code; never edit CSV values manually.
- Do not add actual future/test discharge, full-record StreamStats flow summaries, target-derived quantiles as features, or one-hot station identity that breaks unseen-station behavior.

## Evidence and reproducibility

- `evaluation/error_diagnostics.csv`: per-station squared-error contributions and peak bias.
- `evaluation/predictions_vs_actual.csv`: all frozen public test predictions and errors.
- `reports/metrics.json`: all candidate validation results.
- `reports/demo_holdout.json`: final baseline public test scores.
- `model_card.md`: features, dataset limitations and all station scores.
- Uploaded source: `C:/Users/Dev/Downloads/FLOODCAST_Participant_PS_Updated.pdf`.

## Completed implementation and measured result

V2 is trained and promoted:25% baseline log-target boosting +75% regional-weather raw-target boosting. Model/ensemble selection used training-period validation only; both overall and extreme RMSE improved in BOTH splits.

On the reused2025 benchmark: RMSE52,695.26→46,542.88 (11.68% lower), MAE16,063.87→14,002.94 (12.83% lower), extreme RMSE113,268.22→111,776.95 (1.32% lower), R²0.890945→0.914924.

Generic longer-weather/coordinate models did not pass the validation gate. Regional weather-point proxies produced the improvement. A finer continuous ensemble search and a flow-dependent blend search did not improve all required validation metrics, so neither replaced the selected ensemble. Evidence is in `reports/improvement_v2.json` and `reports/experiments/`.

Tradeoff:20/53 test stations now have negativeR² (baseline11/53). Aggregate gains do not imply every river improved. Baseline artifacts are retained in `reports/baseline_v1/` and `evaluation/baseline_v1/`. The historical diagnosis above refers to `evaluation/baseline_v1/error_diagnostics.csv`; current errors are in `evaluation/error_diagnostics.csv`.

Next improvements need better large-basin attributes and basin/upstream meteorology.2025 has been inspected and remains labeled a reused benchmark, not a new independent test.
