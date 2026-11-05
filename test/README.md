# Test data

Ready-made files for testing the model and the checks on the **Discharge ML Model** page. Open that page, go to **Score your CSV** (FLOODCAST files) or **Judge tests → Output contract** (BASINSHIFT files), and choose the files below.
They are also checked automatically by `npm test` (`tests/test_data_files.test.mjs`), so they stay correct.

## FLOODCAST: daily discharge file (this folder)

The 2025 benchmark: 53 US gauges, 19,306 daily rows. Same-day estimates from the earlier FLOODCAST model.

| File | Use it as | What it is |
|---|---|---|
| `test.csv` | test.csv (optional) | the official test input: `station_id,date` plus the weather and catchment columns, one row per prediction needed |
| `predictions.csv` | predictions.csv | `station_id,date,discharge_cfs`, the model's estimates |
| `actuals.csv` | actuals (optional) | `station_id,date,discharge_cfs`, what was observed |
| `small/` | the same three files for 3 stations (1,095 rows) | quick check |

Expected result for the **full** files: valid submission format, 19,306 rows. RMSE **46,543**, extreme RMSE **111,777**, MAE **14,003**, R² **0.9149**.
Expected for `small/`: valid, 1,095 rows. RMSE 4,242, MAE 1,535, R² 0.598.

### Files that must be rejected (`bad_examples/`)
Use each as predictions.csv with `small/test.csv`:

| File | Why it must fail |
|---|---|
| `wrong_columns.csv` | columns are not exactly `station_id,date,discharge_cfs` |
| `negative_and_duplicate.csv` | one negative value and one duplicate station/date |
| `missing_10_rows.csv` | 10 test rows have no prediction |
| `nan_value.csv` | one value is `NaN` |

## BASINSHIFT: forecast record format (`basinshift/`)

One record = a forecast at +1, +3 and +7 days with probabilities and a 90% interval. Paste a file's text into **Judge tests → Output contract → Check**.

| File | Expected |
|---|---|
| `valid_record.json` | valid (a live forecast for Potomac at Little Falls) |
| `valid_records_array.json` | valid (two records) |
| `bad_probability_above_1.json` | rejected: a probability is 1.4 |
| `bad_interval_order.json` | rejected: a lower bound is above its upper bound |
| `bad_unexpected_horizon.json` | rejected: horizons are 1, 3, 5 instead of 1, 3, 7 |
| `bad_negative_discharge.json` | rejected: a predicted discharge is negative |

## Models on other data
- **Random unseen US basins:** Judge tests → "Run it yourself" → Run test. It uses Caravan basins left out of training (needs the model server running).
- **Live India gauges:** Judge tests → "New rivers · India". The numbers come from `public/reports/model/india_live_test.json`; refresh them with `python -m scripts.india_live_test` while the model server is running.
- **Unseen held-out gauges and Caravan basins:** `python -m scripts.eval_routed` (needs `data/augmented_v2/train_augmented.csv`, built by `python -m scripts.prepare_augmented --out data/augmented_v2`).
