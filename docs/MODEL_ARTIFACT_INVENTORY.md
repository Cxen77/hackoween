# Model artifact inventory

All artifacts are in `models/`, with checksums in `models/manifest.json` (written by `python -m scripts.write_manifest`).

| File | Size | Purpose | Trained on | Horizons | Ref. cut | SHA-256 (first 12) |
|---|---|---|---|---|---|---|
| `models_daily.joblib` | 28 MB | forecast for catchments under 10,000 sq mi | 55 USGS gauges + Caravan basins, tuned; held-out version (11 gauges and 60 basins removed) | 1, 3, 7 | 2000-01-01 | see manifest |
| `models_large.joblib` | 46 MB | forecast for catchments of 10,000 sq mi or more | 55 USGS gauges; held-out version (11 gauges removed) | 1, 3, 7 | 2022-01-01 | see manifest |
| `model_meta.json` | <1 MB | per-gauge Q90/Q99 thresholds, catchment facts, names | 55 training gauges | n/a | n/a | see manifest |
| `holdout_ids.json` | <1 MB | the held-out gauges and basins | n/a | n/a | n/a | see manifest |

## Which model serves what
- The server and `scripts/predict.py` route by drainage area: >= 10,000 sq mi to `models_large.joblib`, others to `models_daily.joblib`.
- The reference cut is the year before which thresholds are learned. Inference always passes thresholds explicitly, so the cut does not change served values.

## Not produced in this repository
- **All-data models:** a model trained on every gauge and basin with no held-out removal was not produced. The held-out versions are what is served, so the public numbers are honest but use slightly less data. A retrain is `python -m scripts.train_augmented_v2 --mode final --tuned` (about 13 minutes, needs `data/augmented_v2`).
- **FLOODCAST same-day estimator:** not a file in `models/`; its scikit-learn model is produced by `solution.py` and its benchmark is in `reports/metrics.json`.

## Versions
- LightGBM 4.7.0, scikit-learn 1.9.0 (saved with 1.9.1; the loader warns about a minor version difference, predictions are unaffected).
- NumPy 2.5.2 and pandas 3.0.5 locally. joblib is 1.5.3 locally but `requirements-render.txt` pins 1.6.0 for serving; both load the files.
