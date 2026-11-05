# Test results

Recorded on 2026-11-05 on Windows 11, Python 3.12.10, Node 24.17.0, at commit `2ccc2a2` on `main`, before the commit that adds these files.

## Commands and results

| Suite | Command | Result |
|---|---|---|
| JavaScript unit and data tests (42) | `npm test` | 42 pass, 0 fail, 0 skipped |
| Python test suite (29) | `python -m unittest discover -s tests` | 29 run, OK |
| Model artifacts, prediction smoke, API integration (7, included above) | `python -m unittest tests.test_model_artifacts tests.test_prediction_smoke tests.test_api_integration` | 7 run, OK |
| Production build | `npm run build` | built successfully (no errors) |
| FLOODCAST scorer | `python test/score_check.py` | RMSE 46,543, extreme RMSE 111,777, MAE 14,003, R2 0.9149 |
| Model server health | `GET /api/health` on 127.0.0.1:8765 | ok, horizons [1, 3, 7] |

## Environment
- Windows 11 Home, 10.0.26300.
- Python 3.12.10, NumPy 2.5.2, pandas 3.0.5, scikit-learn 1.9.0, LightGBM 4.7.0, joblib 1.5.3 (locally).
- Node 24.17.0, Vite production build.
- The model server was running on 127.0.0.1:8765 during the Python run, so the server health test ran rather than being skipped.

## Warnings seen (not failures)
- Loading the saved scikit-learn models warns about a minor version difference (saved with 1.9.1, loaded with 1.9.0 locally). Predictions are unaffected.
- joblib warns that setting a NumPy array shape is deprecated in NumPy 2.5. It does not change results.
- The Python test run prints these warnings; no test fails because of them.

## Not run
- `python -m scripts.evaluate` was run once and produced the reports in this folder (see `reports/evaluate_run.log`); it is not part of the routine test run because it takes several minutes.
- `python -m scripts.train_augmented_v2` was not re-run for this record; the served models were produced by earlier runs listed in `docs/MODEL_ARTIFACT_INVENTORY.md`.
- The live Caravan test (`/api/run_test`) is disabled on the hosted site and was not run there.
- The hosted Render service was checked for health only; the live forecast endpoint returned an upstream rate-limit error once during this check.
