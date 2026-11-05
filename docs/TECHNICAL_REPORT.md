# Technical report: FLOODCAST / BASINSHIFT forecasting system

## 1. Problem
Forecast daily river discharge (cfs) at +1, +3 and +7 days for rivers the model has never seen, with a 90% prediction interval and the probability of high flow (Q90) and extreme flow (Q99). The FLOODCAST challenge also asks for same-day daily estimates for 2025 at 53 gauges, scored on RMSE, extreme RMSE, MAE and R2.

## 2. Data
See `docs/data_provenance.md` (sources and licences) and `docs/DATA_DICTIONARY.md` (columns and units).
- 55 USGS gauges, 293,057 rows, 2010-2024 (training).
- 479 Caravan US basins, 5,594,247 rows, 1981-2014 (augmentation).
- Combined: 5,887,304 rows, 534 catchments.
- Test: 19,306 rows, 53 gauges, 2025 (public data, weather is retrospective).

## 3. Cleaning
Implemented in `scripts/clean_data.py` and `scripts/prepare_augmented.py`:
- negative or non-finite discharge removed; duplicate station/date rows removed; impossible weather removed;
- soil moisture clipped to 0 to 1;
- Caravan: 583 extreme outlier rows and 228,761 rows from zero-discharge runs longer than 90 days removed;
- gaps of up to 7 days filled forward, longer gaps use a weather-only fallback at prediction time.

## 4. Baselines
- **Persistence:** tomorrow equals today. The main benchmark.
- **Seasonal climatology:** monthly median from the reference years.
- **Weather-only boosting:** LightGBM on weather and catchment facts, no recent flow.

## 5. Features
Built in `scripts/basinshift_model.py` (`build`) from past data only:
- discharge lags (at the forecast horizon and one day earlier), 7-day and 30-day means, 7-day maximum, 7-day coefficient of variation, trend (lag minus 30-day mean);
- position relative to the Q90 and Q99 thresholds;
- weather (precipitation, max and min temperature, soil moisture) and static catchment facts.

## 6. Target and blend
- Target: `log1p(tomorrow) - log1p(today)`, the change in log flow.
- Forecast: `0.5 x today + 0.5 x (today x exp(predicted change))`, implemented as `resid` in `forecast()`. The blend keeps the forecast anchored to persistence when the learned change is wrong.

## 7. Models (per horizon)
LightGBM (gradient-boosted trees; `scripts/basinshift_model.py`, settings `P`):
- change model (regression), two quantile models at 5% and 95%, two classifiers for Q90 and Q99, and a weather-only fallback model;
- 300 trees, learning rate 0.06, min 60 rows per leaf, 80% row and column sampling;
- 63 leaves (127 in the tuned served model).

## 8. Calibration
- **Conformal interval:** the 5-95% quantile range is widened by the calibration quantile of the residuals, targeting 90% coverage.
- **Isotonic regression** maps the classifier scores to calibrated probabilities.

## 9. Routing
Drainage area >= 10,000 sq mi uses the USGS-gauge model; others use the gauges + Caravan model. Chosen from the by-size comparison (`data/experiments/basinshift_model/route_by_size.json`).

## 10. The bug we found and fixed
The 55 gauges start in 2010 but thresholds were computed from years before 2000. Their thresholds were empty and the training code dropped them without an error. The first combined model was 1.072 times persistence on the unseen gauges at +1 day, worse than simply repeating yesterday's flow. The gauge-only model on the same gauges was 0.975. The fix: a gauge without a pre-2000 record uses its own first five years, and each source gets its own train and calibration split. Lesson: training scores hid the problem; only the unseen-catchment test showed it.

## 11. Tuning
Seven settings compared on the calibration years only (`scripts/tune_aug.py`). The best was 5x weight on USGS rows and 127 leaves. The gain was small: 0.905 to 0.872 on large-river calibration catchments, and 0.736 to 0.730 on Caravan.

## 12. Results
See `reports/validation_summary.md`. In brief, RMSE ratio vs persistence at +1, +3, +7 days: 0.975 / 0.961 / 0.947 on 11 unseen gauges and 0.828 / 0.764 / 0.745 on 60 unseen Caravan basins.

## 13. Serving
- `server/model_api.py`: stdlib HTTP server; loads the two models and `model_meta.json`; `/api/health`, `/api/live_forecast`, `/api/run_test`.
- Live inputs: USGS (flow and gauge height), Open-Meteo (weather and rain forecast), GloFAS (comparison), NWIC (India).
- `scripts/predict.py`: offline batch prediction for a history CSV, with the same routing rule.

## 14. Limits
- Q99 detection is weak; interval coverage is slightly under 90% on gauges.
- Large-river sample is small (3 gauges above 10,000 sq mi in the held-out set), so the routing choice is uncertain.
- The served models are held-out versions; no all-data model was produced in this repository.
- Retrospective weather inflates skill relative to real-time forecasting with forecast weather.
- The FLOODCAST same-day estimator (scikit-learn `HistGradientBoosting`) is a separate model with its own benchmark, not the forecast system.
