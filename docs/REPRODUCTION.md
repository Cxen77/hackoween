# Reproduction

Commands run from the repository root. Python 3.11 or newer; Node 20 or newer for the website.

## 1. Install
```bash
pip install -r requirements.txt               # serving, prediction, tests
pip install -r requirements-evaluation.txt    # adds matplotlib and psutil for reports and stress tests
npm ci                                        # website
```

## 2. Check the shipped models
```bash
python -m scripts.write_manifest              # rewrites models/manifest.json with checksums
python -m unittest tests.test_model_artifacts
```

## 3. Predict (offline)
```bash
python -m scripts.predict --input test/example_history.csv --output test/example_forecasts.csv
```
The example history is four stations from 2024 (last observed day 2024-12-24) with weather to 2024-12-31. Expected: 12 rows, horizons 1, 3, 7.

## 4. Evaluate (regenerates `reports/`)
Needs the combined training table, which is built locally:
```bash
python -m scripts.prepare_augmented --out data/augmented_v2     # about 80 seconds
python -m scripts.evaluate                                      # several minutes; writes reports/*.csv and reports/figures/*.png
```
Expected headline values (from the run recorded in `reports/validation_summary.md`):
- 11 unseen gauges, RMSE ratio at +1/+3/+7: 0.975 / 0.961 / 0.947.
- 60 unseen Caravan basins: 0.828 / 0.764 / 0.745.

## 5. Score the FLOODCAST files
```bash
python test/score_check.py
```
Expected: RMSE 46,543 | extreme RMSE 111,777 | MAE 14,003 | R2 0.9149.

## 6. Test
```bash
python -m unittest discover -s tests          # 29 Python tests
npm test                                      # 42 JavaScript tests
npm run build                                 # production build
```
The server test (`test_running_server_reports_the_shipped_models`) runs only if the model server is up; otherwise it is skipped.

## 7. Run the system
```bash
python -m server.model_api                    # model API on 127.0.0.1:8765
npm run dev                                   # website on localhost:5173 (proxies /api)
```

## 8. Rebuild the models (optional, long)
```bash
python -m scripts.train_augmented_v2 --mode holdout --tuned   # held-out version, about 15 minutes
python -m scripts.train_augmented_v2 --mode final --tuned     # all-data version, about 15 minutes; not served by default
```

## Data that is not in git
- `data/augmented_v2/train_augmented.csv` (759 MB): rebuild with step 4.
- Caravan raw data (`data/external/caravan/`): download from the Caravan project (CC BY 4.0). Needed only for the live Caravan test and step 4.
- `.env.local` with the Geoapify key: create from `.env.example`.

## Known environment issues
- LightGBM may need a C++ runtime on Windows.
- LibreOffice is not required for any of the above; it is only used to render slides.
