# Model card: FLOODCAST / BASINSHIFT river discharge forecaster

## Model details
- **Name:** FLOODCAST routed forecaster (BASINSHIFT-style system).
- **Type:** gradient-boosted trees (LightGBM) per forecast horizon, with a persistence blend, conformal intervals and isotonic-calibrated flood probabilities.
- **Version:** repository commit on `main` at the time of submission (see `reports/TEST_RESULTS.md`).
- **Owner:** Team Straw_Hats.
- **Licence:** the code is for the hackathon submission. The data licences are listed in `docs/data_provenance.md`; Caravan is CC BY 4.0.

## Intended use
- Research benchmark for daily river discharge forecasts at +1, +3 and +7 days, with 90% intervals and probabilities of high flow (Q90) and extreme flow (Q99).
- Comparing forecasting approaches on held-out catchments.

## Out-of-scope use
- **Not a certified flood warning.** Do not use it for evacuation or emergency decisions. The website and this card both say so.
- Not validated for rivers with strong dam regulation, for tidal or coastal gauges, or for catchments unlike the 534 in training.

## Training data
- 55 USGS gauges (2010-2024) and 479 Caravan US basins (1981-2014). Combined 5.9 million daily rows, 534 catchments.
- Inputs: precipitation, temperature, soil moisture (retrospective reanalysis) and catchment facts.
- Full details: `docs/DATA_DICTIONARY.md`, `docs/data_provenance.md`.

## Evaluation data
- **Unseen USGS gauges:** 11 gauges, 2022-2024, held out completely.
- **Unseen Caravan basins:** 60 basins, 2010-2014, held out completely.
- The organisers' hidden test labels were not available.
- Full protocol: `docs/VALIDATION_PROTOCOL.md`.

## Metrics (unseen catchments; RMSE ratio vs persistence, below 1 wins)

| Test | +1 day | +3 days | +7 days |
|---|---|---|---|
| 11 unseen USGS gauges | 0.975 | 0.961 | 0.947 |
| 60 unseen Caravan basins | 0.828 | 0.764 | 0.745 |

90% interval coverage: 87-90% across tests and horizons (target 90%).

## Factors and performance variation
- **Drainage area:** big rivers (>= 10,000 sq mi) gain little over persistence (ratio 0.87-1.00 at +1 day with the big-gauge model); small catchments gain more.
- **Horizon:** gains over persistence grow with horizon on the gauges (NSE 0.94 vs 0.93 at +1 day, 0.63 vs 0.18 at +7 days).
- **Per catchment:** 9 of 11 gauges beat persistence at +1 day; all 60 Caravan basins beat it at every horizon.
- Full breakdown: `reports/metrics_by_basin.csv`, `reports/metrics_by_horizon.csv`.

## Limitations
- Extreme (Q99) flood detection is weak; AUPRC is 0.41 at +1 day on gauges and falls with horizon.
- Interval coverage is slightly below 90% on gauges.
- Only 3 held-out gauges are above 10,000 sq mi, so the routing choice rests on very few large rivers.
- The served models are held-out versions; no all-data model is shipped.
- Training weather is retrospective reanalysis. Real-time forecasts with forecast weather will be less accurate.
- Some Caravan and India rivers are dam-regulated, which the model does not know about.

## Ethical and misuse considerations
- Forecasts can give false confidence. Show the interval and the caveats wherever a number is shown.
- Do not use the flood map or alert zones as an official warning.

## Caveats and recommendations
- Re-run `scripts/evaluate.py` after any change, and report the new numbers.
- Retrain on all data (`scripts/train_augmented_v2.py --mode final --tuned`) before any operational use, and re-validate.
