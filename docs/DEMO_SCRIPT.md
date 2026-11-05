# Demo script

Practical run order, with what to expect at each step. Times are approximate. Before the demo: open the health link once to wake the Render service (about 10 seconds on the free plan).

## 1. Open the site (0:00)
- Go to `https://floodcast-hackoween.vercel.app`.
- Expect: the River Explorer map with the river list and the 3D terrain.

## 2. Show a live river (0:30)
- Pick **Colorado River at Austin** (USGS 08158000) in the list.
- Expect: the River conditions card shows the measured discharge and gauge height. The simulation starts at the live level.
- Move the slider to show the flood spreading across connected low ground.

## 3. Show the forecast (1:30)
- Open the **Forecast** card. Use the +1 / +3 / +7 day pills.
- Expect: a forecast with a 90% band, and rain bars for the forecast period.
- Say: the forecast is the routed model; large rivers use the big-gauge model.

## 4. Draw an alert zone (2:00)
- Click **+ Draw Alert Zone**, click three or more corners on the map, then **Finish Zone**.
- Set a water-height threshold; raise the water level past it.
- Expect: the zone alerts only when the flood overlaps it and passes the threshold.
- Note: this flow was browser-tested for drawing corners; check it once before the demo.

## 5. Show the Discharge ML Model page (3:00)
- Open **Discharge ML Model**. Results tab: the RMSE ratios against persistence for unseen gauges and unseen Caravan basins.
- Say: these are held-out tests; the organisers' hidden labels were not available to us.

## 6. Score a submission (3:45)
- Open **Score your CSV**. Load `test/predictions.csv`, `test/test.csv` and `test/actuals.csv`.
- Expect: "Valid submission format, 19,306 rows", then RMSE 46,543, extreme RMSE 111,777, MAE 14,003, R2 0.9149.
- Load `test/bad_examples/wrong_columns.csv` as predictions: expect a clear rejection with the reason.

## 7. Show a live new river (4:30)
- Open the **New rivers · India** table on the Judge tests tab.
- Expect: 40 Indian gauges, median ratio 0.92 / 0.78 / 0.75 against persistence. Say: these gauges were never in training.

## 8. Close with the limits (5:00)
- Say: Q99 extreme detection is weak; big-river gains are small; interval coverage is slightly under 90% on gauges; not a certified warning.

## Offline alternative (no internet)
- Run `python -m scripts.predict --input test/example_history.csv --output forecasts.csv` to show the forecasts from the command line.
- Run `python test/score_check.py` to show the scores without the website.
