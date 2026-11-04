# Public FLOODCAST dataset

This is downloaded real public data, NOT the official event test set.

| Folder | Contents | Role |
| --- | --- | --- |
| `raw/` | Cached USGS, weather, StreamStats and GAGES-II source responses | Reproducible acquisition |
| `train/train.csv` | 293,057 historical rows with discharge targets | Model fitting and internal validation |
| `test/test.csv` | 19,306 later rows without discharge | Features supplied for predictions |
| `evaluation/actuals.csv` | Actual public test discharge, kept separate | Evaluation ONLY, never input to training |
| `predictions/predictions.csv` | Code-generated output for every test row | Finite nonnegative discharge predictions |
| `evaluation/comparison.csv` | Actual vs predicted discharge and signed/absolute errors | Inspect predictions row by row |
| `evaluation/metrics.json` | Overall RMSE, extreme RMSE, MAE, R² | Frozen-model holdout evaluation |
| `metadata/` | Station locations, basin attributes, source provenance/citations | Explain origin and feature coverage |

Targets are USGS daily mean discharge in cfs. Dates, units and missing features are documented in metadata. Top-level CSVs are retained as acquisition-stage compatibility files; the organized folders are the inspection copies. Raw responses can contain flow summaries, but the training code reads only allowlisted weather and static descriptors.

To reproduce predictions using these separated folders:

```powershell
python solution.py --train data/large/train/train.csv --test data/large/test/test.csv --output data/large/predictions/predictions.csv --metrics reports/inspection_metrics.json
python scripts/validate_submission.py --test data/large/test/test.csv --predictions data/large/predictions/predictions.csv
```

Training reads train and test features only. The comparison/evaluation code is the only code that reads actual public holdout answers. Data and local trained artifacts are ignored by Git; download scripts and reports are tracked.
