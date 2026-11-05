# Validation summary

Generated from `reports/baseline_comparison.csv`, `reports/metrics_by_horizon.csv`, `reports/ablations.csv` and `reports/metrics_by_basin.csv`, produced by `python -m scripts.evaluate`. Protocol: `docs/VALIDATION_PROTOCOL.md`.

## Setup
- **Model served:** routed forecaster. Drainage area >= 10,000 sq mi uses the USGS-gauge model; smaller catchments use the gauges + Caravan model (tuned). Both are held-out versions, trained without the test catchments.
- **Test 1 (unseen USGS gauges):** 11 gauges, 2022-2024, 12,051 scored days, per horizon.
- **Test 2 (unseen Caravan basins):** 60 basins, 2010-2014, 97,590 scored days, per horizon.
- **Baselines:** persistence (tomorrow = today), seasonal climatology (monthly median from earlier years), weather-only boosting (no recent flow).

## Main result: routed model vs persistence (RMSE ratio, below 1.00 wins)

| Test | +1 day | +3 days | +7 days |
|---|---|---|---|
| 11 unseen USGS gauges | 0.975 | 0.961 | 0.947 |
| 60 unseen Caravan basins | 0.828 | 0.764 | 0.745 |

Median NSE, model vs persistence:

| Test | +1 day | +3 days | +7 days |
|---|---|---|---|
| 11 unseen USGS gauges | 0.938 vs 0.927 | 0.697 vs 0.563 | 0.625 vs 0.178 |
| 60 unseen Caravan basins | 0.709 vs 0.531 | 0.411 vs -0.076 | 0.260 vs -0.410 |

90% interval coverage (target 90%): 88.5%, 88.2%, 87.4% on the gauges; 89.6%, 89.4%, 89.2% on Caravan basins.

High-flow (Q90) AUPRC, model vs persistence: 0.953 vs 0.759 at +1 day on gauges; 0.929 vs 0.623 on Caravan basins. Extreme (Q99) AUPRC is weak: 0.408 at +1 day on gauges, 0.547 on Caravan basins, and it falls with horizon (see `metrics_by_horizon.csv`).

## Baselines at +1 day (full table: `baseline_comparison.csv`)
- **Gauges:** routed 10,391 cfs RMSE, persistence 10,659, seasonal climatology 97,987, weather-only 81,669.
- **Caravan:** routed 357 cfs RMSE, persistence 432, seasonal climatology 600, weather-only 523.

## Ablations (`ablations.csv`, same rows and splits)
- **Routing:** on the gauges, the routed model equals the gauge-only model at every horizon, because the large gauges dominate. On Caravan, the routed model equals the mixed-only model, because every Caravan basin is below the 10,000 sq mi cutoff.
- **Mixed model alone** is worse than the gauge model on the gauges at +1 day (ratio 1.020 vs 0.975), which is why the cutoff routes large rivers to the gauge model.
- **Static catchment attributes** (saved run on the earlier 55-gauge model, `public/reports/model/judge_tests.json`, H1): without them, 1-day RMSE is 0.4% higher, 3-day is 0.8% lower and 7-day is 0.05% higher on the 11 gauges. This is a single split, so treat it as indicative only.
- **Tuning** (`data/experiments/basinshift_model/tune_aug.json`): the chosen setting improves the big-river ratio from 0.905 to 0.872 on the calibration years, and Caravan from 0.736 to 0.730.

## By catchment (`metrics_by_basin.csv`)

| Test | Horizon | Catchments | Median RMSE ratio | Share beating persistence |
|---|---|---|---|---|
| Unseen gauges | +1 day | 11 | 0.917 | 82% (9 of 11) |
| Unseen gauges | +3 days | 11 | 0.850 | 100% |
| Unseen gauges | +7 days | 11 | 0.798 | 100% |
| Unseen Caravan | +1 day | 60 | 0.848 | 100% |
| Unseen Caravan | +3 days | 60 | 0.780 | 100% |
| Unseen Caravan | +7 days | 60 | 0.766 | 100% |

## Limits and honest caveats
- **Small large-river sample:** only 3 gauges are above 10,000 sq mi in the held-out set. The routing choice rests on very few catchments.
- **Interval coverage** is slightly below 90% on the gauges.
- **Extreme events** are rare; Q99 detection is weak and must not be presented as reliable.
- **Weather** is retrospective reanalysis, so real-time skill will be lower.
- **No hidden test:** the organisers' hidden labels were not available; these are held-out tests we constructed.
- **Statistical uncertainty** (bootstrap over catchments, 95% interval for the RMSE ratio, `data/experiments/basinshift_model/basinshift_routed.json`):
  - Unseen gauges: +1 day [0.869, 1.003] (crosses 1.00, so the gain is not statistically certain); +3 day [0.810, 0.983]; +7 day [0.747, 0.961].
  - Unseen Caravan basins: +1 day [0.804, 0.843]; +3 day [0.739, 0.782]; +7 day [0.716, 0.770]. All below 1.00.
