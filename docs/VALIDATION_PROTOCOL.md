# Validation protocol

How the reported numbers were produced, so anyone can repeat them. Every number in `reports/` comes from `scripts/evaluate.py` or the saved runs listed below.

## Data used
- **Training rows:** the 55 USGS gauges in `data/large/train/train.csv` (293,057 daily rows, 2010-01-01 to 2024-12-31), plus 479 Caravan basins (5,594,247 rows, 1981-2014).
- **Combined table:** `data/augmented_v2/train_augmented.csv`, 5,887,304 rows, 534 catchments. Built by `scripts/prepare_augmented.py`. It is not in git (759 MB; GitHub's limit is 100 MB). Rebuild it locally.

## Held-out catchments (never used for training or tuning)

| Test | Who | Years scored | Rows | How chosen |
|---|---|---|---|---|
| Unseen USGS gauges | 11 of 55 gauges | 2022-2024 | 12,051 | `numpy.random.default_rng(42)`, listed in `models/holdout_ids.json` |
| Unseen Caravan basins | 60 of 479 basins | 2010-2014 | 97,590 | `numpy.random.default_rng(7)`, listed in `models/holdout_ids.json` |

Whole catchments are held out, so these tests measure transfer to new rivers, not later dates at known rivers.

## Time split used to train the served models
- **Original gauges:** train before 2022, calibrate 2022-2023.
- **Caravan basins:** train before 2012, calibrate 2012-2014.
- The served models are the held-out versions: the 11 gauges and 60 basins above were removed before training. An all-data model was not produced (see `docs/MODEL_ARTIFACT_INVENTORY.md`).

## Thresholds (Q90 and Q99)
- Each catchment's high-flow level (Q90) and extreme level (Q99) come from its own reference period.
- Gauges with no record before 2000 use their own first five years of record. Without this rule the 55 gauges, which start in 2010, had no thresholds and were silently dropped from training. See `docs/TECHNICAL_REPORT.md`.

## Routing
Drainage area of at least 10,000 sq mi uses `models_large.joblib`; smaller catchments use `models_daily.joblib`.
The cutoff was chosen from the by-size comparison in `data/experiments/basinshift_model/route_by_size.json`, which uses the same held-out catchments that are reported. The large-river numbers are therefore slightly optimistic: the cutoff was not chosen on a separate validation set, because we did not have one with enough catchments.

## Metrics
- **RMSE** and **MAE** in cfs; **extreme RMSE** on the top 10% of flows per catchment.
- **RMSE ratio** = model RMSE / persistence RMSE. Below 1.00 beats repeating yesterday's flow.
- **Median NSE** (Nash-Sutcliffe efficiency) across catchments, model vs persistence.
- **90% interval coverage**: share of observations inside the conformal interval (target 90%).
- **AUPRC** for Q90 and Q99 exceedance, with persistence's indicator as the comparison.
- **Bootstrap**: 300 resamples of catchments for the ratio's 95% interval (`scripts/basinshift_model.py`).

## Tuning
Seven LightGBM settings were compared on the **calibration** years only (`scripts/tune_aug.py`). The held-out catchments were not used for tuning. The chosen setting (5x weight on USGS rows, 127 leaves) was then retrained and scored on the held-out set.

## What is not covered
- The organisers' hidden test labels were not available, so no score on them is reported.
- The 2025 test set in `test/` is public USGS data, not the organisers' hidden test.
- Uncertainty is reported as the bootstrap interval and the interval coverage only.
