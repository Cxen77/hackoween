# FLOODCAST — current handoff

Updated: 2026-11-05, Asia/Calcutta. Read this file first when continuing. Keep it current; do not create competing context logs.

## ACTIVE — Render + Vercel deployment

User explicitly authorized pulling latest GitHub source, deploying backend on Render/frontend on Vercel, and setting the supplied Geoapify map key. Original C:/Users/Dev/Desktop/hackoween has an uncommitted ModelForecastCard.tsx edit; preserved untouched. Clean deployment checkout C:/Users/Dev/Desktop/hackoween-deploy, branch deploy/render-vercel, based on latest42ddaf2. Do not overwrite the original local edit or use blanket git add.

Render service created on FREE plan (0.1CPU/512MB), Singapore, project floodcast/Production: service ID srv-dbm08l59fdbs73bebqq0, public origin https://floodcast-api-ok9n.onrender.com. First deployment dep-dbm08lt9fdbs73bebtdg started from a27ea97; check dashboard/logs and /api/health before claiming healthy. Build pip install -r requirements-render.txt; start python -m server.model_api; health /api/health. PYTHON_VERSION3.11.11, OMP_NUM_THREADS/OPENBLAS_NUM_THREADS/MKL_NUM_THREADS/NUMEXPR_NUM_THREADS all1. Server honors Render PORT and binds0.0.0.0; fixed three Python3.11 f-string quote errors. Serving deps pinned numpy2.4.6/pandas3.1.0/scipy1.17.1/scikit-learn1.9.0/joblib1.6.0/lightgbm4.7.0. Model loaded locally at227MB RAM and /api/health returned55stations; real Potomac live forecast returned3horizons using models_large.joblib and origin2026-11-03.42 JS tests and production build passed before hosting config.

Vercel signed-in account/team cxen77s-projects Hobby. Import form open in IAB tab4; project name floodcast-hackoween, Vite preset, repo Cxen77/hackoween main. VITE_GEOAPIFY_API_KEY entered from original ignored .env.local into sensitive Production+Preview variable; accordion collapsed to avoid exposing value. Do not print the key. Deployment not started yet: push vercel.json first, then Deploy. vercel.json proxies /api/* to the verified Render origin, then SPA fallback. Render dashboard is IAB tab3. GitHub tab5. No platform tokens harvested; all platform actions via signed-in UI.

Optional Caravan raw data is absent from clean production checkout: health advertises capability and random-basin rerun endpoint returns503 with a clear notice; UI disables this optional action. All saved results, file checks and live forecasts remain available. This is intentional, not a claim that raw independent tests were rerun on Render.

## CURRENT — ROUTED FORECASTER, TEST FILES, UI FIXES (2026-11-05, later)

- **Training bug fixed.** The 55 USGS gauges start in 2010, so thresholds from "before 2000" were empty and those gauges dropped out of the augmented run (it was ~2x worse than persistence on big rivers). `basinshift_model.thresholds` now falls back to a station's own first 5 years; each source gets its own train/calibration split (`scripts/train_augmented_v2.py`, modes `holdout` and `final`, flag `--tuned` = 5x weight on USGS rows + 127 leaves from `scripts/tune_aug.py`).
- **Routing by catchment size** (`server/model_api.py`: `pick_bundle`, `routed_forecast`, `LARGE_SQMI = 10000`): rivers >= 10,000 sq mi use `models_large.joblib` (USGS-gauge model); smaller ones use `models_daily.joblib` (gauges + 479 Caravan basins, tuned). Chosen from `scripts/route_by_size.py` (best model per size band on held-out catchments). New-river forecasts (India, lat/lon) have no area, so they use the mixed model.
- **Both served models are the HOLD-OUT versions**: trained without the 11 gauges (seed 42) and 60 Caravan basins (seed 7) listed in `holdout_ids.json`. That keeps every number on the Model page and the live Caravan test honest. An all-data retrain is `python -m scripts.train_augmented_v2 --mode final --tuned` (needs `python -m scripts.prepare_augmented --out data/augmented_v2`, ~13 min each).
- **Results (unseen catchments, RMSE / persistence, +1/+3/+7)**: 11 US gauges 0.975 / 0.961 / 0.947; 60 Caravan basins 0.828 / 0.764 / 0.745; 90% intervals cover 87-90%. Scored by `python -m scripts.eval_routed`; page data by `python -m scripts.export_model_page_data`.
- **Test files**: `test/` holds a ready FLOODCAST set (`test.csv`, `predictions.csv`, `actuals.csv`; expect RMSE 46,543, MAE 14,003, R2 0.9149), `small/`, `bad_examples/` (must be rejected) and `basinshift/` records. `tests/test_data_files.test.mjs` checks them in `npm test`. See `test/README.md`.
- **UI**: river channel always drawn as shallow water (terrain.ts/river-flood.mjs `channelWaterMesh`); slider range grows for very large rivers; one "Back to live level" control; draw-alert zone has corner markers and a bottom bar; Test a station defaults to the 1/3/7-day forecast over the last 90 days; hydrograph shows only +1/+3/+7 and hides GloFAS when its cell is not on the gauged river; several orange notes removed on request; map credits collapsed behind the (i) button.
- **Not done**: Test A (same gauges, later dates) and H1 were not re-run for the latest model; Q99 detection is weak; boundary-alert flow was only browser-tested for drawing three corners.
- **After pulling**: restart the model server (`npm run dev:all` does it). If the dev page shows old styles, restart the Vite server and hard-refresh.

## CURRENT — AUGMENTED DATASET & 1-3-7 MODEL DEPLOYED (2026-11-05)

- **Augmented Dataset**: Combined original 55 USGS gauges (293,057 rows) with 479 Caravan US CAMELS basins (5,594,247 rows).
  - Total: **5,887,304 rows**, **534 stations**.
  - Documented QA & Cleaning (scripts/prepare_augmented.py):
    - Removed 583 extreme discharge outliers (>99.99th percentile across catchments)
    - Removed 228,761 long zero-discharge run rows (>90 consecutive days)
    - Clipped ERA5 soil moisture to [0, 1]
    - Excluded overlapping stations
    - Quality report saved: data/augmented/data_quality_report.json
- **Model Training**: Trained 1/3/7-day multi-horizon BASINSHIFT model (scripts/train_augmented.py):
  - 5,174,429 training rows (< 2012)
  - 516,853 calibration rows (2012-2014, both sources present)
  - Horizons: **[1, 3, 7]** days (kept exactly to 1-3-7 as requested)
  - Heads: Point (0.5 persistence + 0.5 residual LightGBM), 5%/95% quantiles with conformal 90% calibration, and Q90/Q99 isotonic classifiers.
  - Runtime: 11.4 min; output size: 13.0 MB.
- **Deployment**:
  - Saved to data/experiments/basinshift_model/models_augmented.joblib and promoted to models_daily.joblib.
  - Model API (server/model_api.py) restarted with the augmented model.
  - Endpoints verified live:
    - GET /api/health: reporting models_daily.joblib, horizons [1, 3, 7].
    - GET /api/live_forecast?station=01646500: 1/3/7-day forecasts with conformal bands active.
    - GET /api/run_test?dataset=caravan&n=3: Live test passes across 1/3/7 days with model beating persistence (e.g. h1 RMSE 124.2 vs 147.3).
  - Test suites: 31/31 unit tests pass (
pm test); Vite production build passes.

## CURRENT — water simulation repair, 2026-11-05

User requested fixing unrealistic flood/water-level behavior. Work isolated in C:/Users/Dev/Desktop/hackoween-water-fix (branch fix/water-simulation, preview5180) after another editor rebased/stashed the shared C:/Users/Dev/Desktop/hackoween folder during this turn. Initial recovered implementation was also integrated by that editor in origin/main commit63d76e7; final refinements must be merged with latest origin/main, preserving newer forecast-chart changes. Do not reset the shared working folder or overwrite concurrent work.

New core: src/river-flood.mjs (actual mapped-channel rasterization, local robust reference surfaces, nearest-channel extension, terrain-saddle minimax connectivity, continuous clipped shoreline mesh), src/riverGeometry.ts (OSM water polygons/lines from existing Geoapify vector tiles; keyless OpenFreeMap fallback; four requests at once, tile caching), src/WaterSurface.ts (elevated WebGL water, terrain depth testing, ripple/depth shading, GL-state/resource cleanup). Terrain uses193×193 bilinear DEM samples with proper pixel-center alignment, preserves floodplain ridges, default12km window plus6/20km options. Only suitable low river samples seed water; high bank/bridge pixels do not inject water across barriers. A labeled point-source fallback is explicit if geometry fails.

Fixed pause jumping to final target, resume resetting to zero, and slider/animation races. Displayed stage drives map, stats and alerts consistently; zero reset clears the scenario. Replay14seconds is illustrative, not physical arrival time. Reduced-motion preferences respected. Area excludes mapped river cells and boundary truncation is flagged. Sticky bounded-height map keeps the selected river visible while controls/forecast panel scroll; controls precede forecast details. Relief reduced to1.5× on both terrain and water; all reported depths are actual metres.

Removed unsafe live-sync assumption that absolute gauge height (or generic discharge rule) equals rise above the terrain reference. Gauge observations remain visible; forecast-card map presets explicitly say assumed/exploratory. This is still a quasi-static stage visualization, NOT a calibrated hydraulic solver or emergency product. No numerical flood-depth accuracy is claimed. Future physical modeling needs surveyed channel/bathymetry, local gauge datum/rating calibration, defenses and time-dependent shallow-water routing.

Validation:31 JS tests pass (including nine channel/slope/barrier/shoreline/missing-data/bridge/island/GeoJSON adapter tests); TypeScript/Vite build passes. Browser5180 successfully loaded actual Austin OSM geometry, rendered rising water, paused and stayed at+0.8m instead of jumping to+3m, and reset to0area/0depth. Geometry source and resolution visible in UI. Final fix rebased over origin/main456d9e5, retaining forecast day pills/chart/rain changes. Removed automatic follow-live from map stage because absolute gauge datum height is not an increment above DEM water surface; live observations and forecast selections remain. Further current verification/commit status follows git log. No ML retraining or dataset changes in this turn. Do not commit .env.local or data/river_tilejson.json (temporary local tile metadata can contain the map key); latter explicitly ignored and excluded locally.

## NEW CONTEXT (2026-11-04): context/ folder + BASINSHIFT spec

Reference docs now live in `context/` (see context/README.md). It holds BASINSHIFT_Full_Challenge_Documentation.pdf and a text extract. BASINSHIFT differs from FLOODCAST: it allows past-discharge history as input, wants multi-horizon forecasts plus exceedance probabilities and intervals, and scores macro-averaged unseen-catchment performance. Why accuracy is low (diagnosis): 3 Mississippi gauges = 80% of squared error, point weather not basin weather, missing basin attributes, log-target smoothing of peaks. If the target is BASINSHIFT, lagged-discharge features + quantile/probability heads are the first things to add. Which competition applies is not yet confirmed with the user. FLOODCAST_Participant_PS_Updated.pdf also saved to context/ (+ .txt): it names USGS waterservices, Open-Meteo archive and StreamStats APIs, all already implemented in scripts/download_data.py and scripts/download_catchments.py. Waiting for the user's data/ folder before any retraining.

Workspace moved to D:/hackoween'/hackoween-1. data/ (gitignored) is ABSENT here; user is copying it from C:/Users/Dev/Desktop/hackoween. LightGBM/CatBoost not installed in Python 3.12 here (pip install -r requirements-advanced.txt). No retraining done yet this session.


## BASINSHIFT 1-day-ahead experiment (2026-11-04, validation only, no test labels)

Script: scripts/basinshift_forecast.py. Results: data/experiments/basinshift_v1/basinshift_metrics.json.
- Weather/attributes only is about 7x worse than persistence at 1 day (RMSE 57,351 vs 7,628 on later dates).
- Adding discharge lags to the regression did not beat persistence on either split.
- Change-from-yesterday (residual) model: beats persistence on later dates of seen stations (RMSE 7,078 vs 7,629; extreme 13,014 vs 14,681; R2 0.99733 vs 0.99689), but is worse on unseen stations (RMSE 11,131 vs 10,659; extreme 17,449 vs 17,037). Mixed result, NOT promoted.
- 50/50 blend of persistence and residual model (fixed weight, chosen before seeing results): beats persistence on ALL four metrics on BOTH splits. Seen stations RMSE 7,125 vs 7,629; unseen RMSE 10,437 vs 10,659; extreme unseen 16,233 vs 17,037. Single seed, validation only; needs repeat with other seeds before any promotion.
- Applies to BASINSHIFT-style 1-day forecasts only. FLOODCAST 2025 test forbids discharge inputs, so the FLOODCAST champion (V2) is unchanged.

## BASINSHIFT multi-horizon result (2026-11-04, 3 seeds x 2 splits x horizons 1/3/7, validation only)

Script: scripts/basinshift_horizon.py. Summary: data/experiments/basinshift_horizon/basinshift_horizon_summary.json.
- Blend (50/50 persistence + residual) beats persistence on RMSE in all 18 seed x split x horizon cells (3/3 seeds per cell).
- Unseen-station best RMSE: blend at h1 (7,432) and h3 (17,781); residual at h7 (29,903 vs blend 30,189).
- Unseen-station best extreme RMSE: blend at all horizons (h1 13,671; h3 33,555; h7 57,397).
- Seen-station best RMSE: residual alone at all horizons.
- Weather-only is roughly 7x worse than persistence at every horizon; discharge history is the main signal.
- Chosen approach for BASINSHIFT-style forecasts: blend_50. Not applicable to FLOODCAST 2025 (no discharge inputs). FLOODCAST V2 champion unchanged.
- Caveat: gains over persistence are modest (about 1-7%); no exceedance-probability or calibration model yet.

## Recalibration and hyperparameter sweeps (2026-11-04) - REJECTED, V2 unchanged

- scripts/calibrate_peaks.py: isotonic recalibration learned from cached validation predictions of non-held-out stations, tested on held-out stations. Full: extreme RMSE 150,397 vs 115,119 (worse). Shrink 0.25/0.5: overall RMSE and MAE improve (70,126 / 25,888 at 0.5) but extreme RMSE worsens (122,383 / 130,819). Gate failed.
- scripts/tune_regional.py: 7 HistGB hyperparameter variants of regional_raw in the V2 blend, both validation splits. NONE passed the overall+extreme RMSE gate in both splits; differences were about 1% (noise level; the control re-fit differed from the cached reference by 0.3%). Best-looking: l2_120 lowered unseen extreme to 110,567 but raised temporal RMSE/extreme slightly.
- Conclusion: FLOODCAST V2 is at a plateau for tuning-level changes. Remaining levers need new information: basin-wide upstream weather, same-source extra stations (scripts/expand_stations.py after Open-Meteo quota reset), complete large-basin attributes.

## 2026-11-05 CHANGES (daily model, slider, live level, layout, basemap)

- DAILY MODEL: the live server now loads data/experiments/basinshift_model/models_daily.joblib (29 MB, committed): horizons +1..+7 (heads: point, 5%/95% quantile + conformal 90% interval, Q90/Q99 classifiers), trained by `python -m scripts.train_daily_model` (~5 min). Falls back to models_caravan.joblib (+1/+3/+7). Held-out validation of every day (`python -m scripts.basinshift_model --experiment heldout --horizons 1 2 3 4 5 6 7 --tag _daily`): model beats persistence at all 7 days (RMSE ratio 0.947-0.975, median NSE 0.94 at +1 to 0.63 at +7 vs 0.93 to 0.18 persistence; 90% coverage 87-89%). Judge tab card "Every forecast day" shows it. Hydrograph card now plots the 7 real model points (no interpolation).
- HYDROGRAPH CARD (src/components/HydrographOutlookCard.tsx): the old "ML Prediction" and "10-Yr Baseline" lines were GloFAS x sine/cosine wobble (fake). Now: GloFAS, FloodCast model (real, with 90% band), latest observed flow held flat. No model data -> GloFAS only.
- SLIDER SENSITIVITY: the simulation slider (rise above reference river surface) is now on a square-root scale (position 0-1000 -> rise), so the first metre has ~1/3 of the track. Terrain note: rivers with a lake/impoundment at the reference surface (e.g. Colorado at Austin) still jump to ~3 km2 on the first centimetres; that is the flood model + DEM, not the slider.
- LIVE LEVEL: simulation opens at the river's live rise = how far above its own 30-day median level it is (server fields live_rise_m, live_rise_basis; forecast buttons use rise_point_m on the same basis). Stays at 0 on a normal/low day. Follows live data until the slider is moved; "Use live level" restores it. (The other side's redesign had removed the earlier Sync button/follow logic; this replaces it.)
- LAYOUT BUG (windows < 768 px): the desktop sidebar was not hidden (unlayered .floodcast-sidebar-body {display:flex} beat Tailwind `hidden`), squeezing the map to 64 px and off screen. Fixed in src/layout-fix.css.
- BASEMAP: CARTO's keyless dark tiles now return an "API KEY REQUIRED" placeholder; switched to Esri World Dark Gray (keyless).
- OLD MAP LOOK RESTORED (2026-11-05): terrain relief 3.2x (was 1.5), camera tilt 65 deg (was 55), hillshade strength 1.0 (was 0.35), flat dark base (#262626) with the Esri tiles only faintly (opacity 0.28). Constants RELIEF / PITCH_3D at the top of src/App.tsx. Layout arrangement (map left, flood card right, conditions + hydrograph below) already matched the older version; the removed reach-selector/flow-badge controls belong to the older flood engine and were not brought back.
- STALE MODEL GUARD (2026-11-05): `npm run dev:all` used to reuse ANY server already on port 8765, so an old server kept serving the old model after a git pull. It now compares the running server's model with the newest file (models_daily.joblib) and restarts it if older. Every live forecast carries `model` and `model_horizons`; the forecast card shows "Model: models_daily.joblib - forecasts +1 to +7 days". If you see models_caravan / +1 to +7 only on a setup, that server is stale: stop it and restart.
- Server restart needed after pulling: `npm run dev:all` or `python -m server.model_api`.

## SET UP ON A NEW MACHINE (read this first when pulling)

Only what is needed to run and test is required. The site and model server need ONLY: code, the production model data/experiments/basinshift_model/models_caravan.joblib, its small sidecar model_meta.json (per-gauge thresholds, basin attributes, coordinates; regenerate with `python -m scripts.export_model_meta`), public/reports/model/*.json (page data) and the generated station lists. The DATASET (data/large) is NOT needed to run the site or server; it stays in the repo from earlier commits and is only needed to retrain or rerun experiments. NOT in Git (re-creatable): data/external (Caravan), data/large_plus (extra-station experiment), models_heldout.joblib, experiment logs/result JSONs under data/experiments/basinshift_*, nwic_*.json scratch files.

```powershell
git clone https://github.com/Cxen77/hackoween.git ; cd hackoween
pip install -r requirements.txt -r requirements-advanced.txt     # Python 3.12 tested
npm install
# easiest: one command starts the model server (port 8765) AND the website
npm run dev:all
# or in two terminals: (1) python -m server.model_api   (2) npm run dev
# If the site says "Model server is not running", the server did not start: run `python -m server.model_api` and read its error
# (usually a missing package: pip install -r requirements.txt -r requirements-advanced.txt), and run it from the repo root.
```
Optional, only to re-run experiments: `python -m scripts.basinshift_model --experiment heldout` (retrains the held-out model), `python -m scripts.download_caravan` (US Caravan subset, ~480 MB download into data/external, needs internet) and `python -m scripts.build_plus_dataset` (extra stations). Rebuild page data after new evaluations with `python -m scripts.export_model_page_data` (and `scripts/basinshift_judge_tests.py`, `scripts/india_live_test.py` with the server running).
The server works with no dataset present (verified in a folder containing only code, the model and model_meta.json). Without the model server the site still runs: forecast panels show a "start the server" message and the Judge tests tab uses saved results.

## WHAT WAS ADDED 2026-11-04 (BASINSHIFT system + site integration)

- Models: scripts/basinshift_model.py (1/3/7-day forecast = 0.5 persistence + 0.5 residual LightGBM, 5 quantile heads + conformal 90% interval, Q90/Q99 exceedance classifiers with isotonic calibration). scripts/clean_data.py documented cleaning. scripts/basinshift_stress.py stress/efficiency. scripts/basinshift_judge_tests.py Test A + attribute ablation.
- Results: held-out gauges and Caravan (478 small US basins) beat persistence at 1/3/7 days; intervals under-cover (80-88% vs 90%); attributes barely help (H1); stress: big rivers degrade up to 2.6x at 1 day under noise, small basins ~1.0x.
- Model server: server/model_api.py (stdlib). Endpoints: /api/live_forecast?station=<USGS id> (US, live USGS + Open-Meteo, stage rating from the gauge's own readings), ?india=<key> (Indian gauge with live NWIC feed; model-vs-observed 30-day replay), ?lat&lon&name (GloFAS-based new river, unused by the UI), /api/run_test (live Caravan test).
- Site: nav "Discharge ML Model" page (src/components/ModelPage.tsx: Results, Judge tests, Test a station, Score your CSV, Robustness). Simulation panel gets ML forecast card (src/components/ModelForecastCard.tsx); Simulate buttons set the water-rise slider. Monitored basins = 55 US gauges in the training data (src/datasetStations.ts, generated) + 40 Indian gauges with a live NWIC feed (src/indiaStations.ts, generated by scripts/export_india_stations.py from server/india_stations.json built by scripts/build_india_registry.py). The old Ganga/Brahmaputra/Yamuna entries were removed (no NWIC live feed).
- NWIC portal (https://nwdp.nwic.gov.in, CKAN): discharge tables are labelled m3/sec. CWC manual-daily dataset has per-state 2026-2030 tables that are the live feed (data to 2026-11-03). Karnataka daily 1972-2025, state telemetry feeds, etc. exist but are mostly canals/drains or stale. scripts/nwic_api.py is a generic client.
- India live test (40 gauges never in training; 30-day replay vs NWIC): median RMSE ratio model/persistence 0.89 (1d), 0.79 (3d), 0.76 (7d); model better at 37/40, 38/40, 38/40 gauges. Worst: dam-regulated Cauvery gauges (Kodumudi, Musiri) and Krishna at Kurundwad. Short end-of-monsoon window, so indicative only. Results: public/reports/model/india_live_test.json.
- Judge test status vs the BASINSHIFT PDF: Test A/B/C done, output contract validator + exporter done, H1/H2/H3 done, H4 (robust training) and H5 (hybrid) NOT done, sequence-model baseline not done.
- FLOODCAST submission model (V2) is unchanged; BASINSHIFT work does not affect predictions.csv. Rejected this session: peak recalibration, hyperparameter sweeps, station-history features, +36 stations with NASA POWER weather (see sections below).

## Discharge ML Model page (2026-11-04)

The nav-bar button "Discharge ML Model" now opens a full page (src/components/ModelPage.tsx, model-page.css) instead of the old pop-up with stale V1 numbers. The explorer is hidden (not unmounted) so the map state survives. App.tsx edit is 3 lines (import, `{modelOpen && <ModelPage />}`, `hidden={modelOpen}` on .workspace, and the old modal now opens only for Sources).
Tabs: Results (production FLOODCAST benchmark + BASINSHIFT held-out/Caravan tables by horizon), Test a station (actual vs forecast with 90% band, Q90/Q99 thresholds, alert test, 2025 production series), Score your CSV (in-browser validate + score; reproduces the Python numbers exactly on the 19,306-row sample), Robustness (stress table + efficiency).
Data: public/reports/model/*.json, regenerate with `python -m scripts.export_model_page_data` after any new evaluation. Scoring logic: src/modelMetrics.mjs, tested in tests/modelMetrics.test.mjs (fixture computed in Python). 20 JS tests pass; build passes.
Caveat: the Caravan stress run was not done (button disabled in the UI). Caravan result: beats persistence at 1/3/7 days; at 7 days median per-basin NSE (0.081) is slightly below weather-only (0.092); 90% intervals cover 80-84%.

## Extra-station experiment with NASA POWER weather (2026-11-04) - REJECTED, V2 unchanged

Open-Meteo quota was exhausted, so 36 vetted extra USGS stations used NASA POWER weather (scripts/build_plus_dataset.py), quantile-mapped to the Open-Meteo scale using original-station training rows only (corr after mapping: precip 0.81, tmax 0.98, tmin 0.98, soil 0.71). Dataset data/large_plus (local, ignored): 91 stations, 490,274 train rows.
Controlled test (scripts/plus_experiment.py), same V2 recipe, scored on the ORIGINAL stations' reused 2025 rows:
- control (55 stations): RMSE 45,942, extreme 108,975, MAE 13,870, R2 0.9171
- plus (91 stations):    RMSE 47,509, extreme 118,524, MAE 13,181, R2 0.9114  -> overall and extreme RMSE WORSE; not promoted.
- plus model on the 36 new stations' never-inspected 2025 rows: RMSE 14,205, extreme 33,873, R2 0.863 (no V2 comparison exists).
Likely cause: mixed weather sources (soil moisture only 0.71 correlated) and new large basins lacking elevation/slope/forest. If Open-Meteo quota resets, scripts/expand_stations.py gives a same-source version worth one more try.

## Station expansion prepared (2026-11-04) - blocked by Open-Meteo daily quota

Open-Meteo returned 'Daily API request limit exceeded' today, so new weather could not be downloaded. Quota was NOT bypassed.
Prepared and vetted: reports/expansion_candidates.json = 36 additional USGS stations with full 2010-2025 daily discharge and known drainage area (Missouri, Ohio, Upper Mississippi, Platte, Snake, Wabash, Allegheny, Columbia-region, Gulf and Atlantic rivers). scripts/expand_stations.py copies the cache from data/large and downloads only new stations into data/large_plus (resumable; rerun after quota reset), then fetches StreamStats/GAGES-II attributes.
Next (after quota reset): python -m scripts.expand_stations ; then retrain with the command in that script's docstring ; compare against V2 on the ORIGINAL 53 stations (validation first, then reused 2025 benchmark) and promote only if overall AND extreme RMSE improve. Expect gains to be uncertain; document either way.

## Station-climatology experiment (2026-11-04) - REJECTED, V2 unchanged

Scripts: scripts/climatology_experiment.py, scripts/climatology_final.py. Results under data/experiments/climatology_v1, climatology_v2, climatology_final (local).
Idea: per-station train-only log-discharge statistics (mean, q10, q90, max, month mean), leave-one-year-out for fit rows, station masking so unseen stations still work.
- Validation, seen stations (mask 0.25): blend RMSE 44,715 vs V2 47,232; MAE 15,254 vs 16,816; extreme 53,119 vs 53,138; R2 0.893 vs 0.881. Unseen stations: RMSE 127,610 vs 72,109 (fails badly).
- Control with same LightGBM learner and NO station stats (mask 0.5 run): clim features did not help in either split.
- Router (seen station -> climatology blend, unseen -> V2) on the reused 2025 benchmark: RMSE 48,142 vs 46,543 (3.4% worse), extreme 114,965 vs 111,777 (2.9% worse), MAE 13,615 vs 14,003 (2.8% better), R2 0.9090 vs 0.9149. Fails the overall+extreme RMSE gate. Not promoted. Root predictions.csv untouched.
- Lesson: third validation/benchmark mismatch. Further FLOODCAST gains need basin-wide weather, not more station-level tricks.

## Event readiness check (2026-11-04)

Dry run of solution.py --improved --regional on files in the organizers exact schema (4 public stations, no impervious column, 6-column metadata, train through 2022, test 2023): completed, validator PASS (1,460 rows). Held-out RMSE 51,848 cfs vs 82,720 median baseline (small 4-station set). README event section now uses this command. Team details filled in README (Straw_Hats; Harsh Srivastav 1BY25CB020, Arman Jha 1BY25CS057, Sumit Santosh Bulbule 1TD25CS307, Dev Chandra Prasad Yadav 1BY25CS085). User confirmed the organizers gave ONLY the briefs, no event CSVs, so the public-data predictions.csv is the submission. Remaining: presentation speaker notes still say team name pending; target definition (peak vs daily mean) unconfirmed.

## LATEST CHECKPOINT — MODEL IMPROVEMENT COMPLETE

LATEST WEAKNESS/IMPROVEMENT AUDIT COMPLETE: trained ten new candidates (seven LightGBM/CatBoost, three separate upstream-region weather models) on the existing293057 training rows. Installed LightGBM4.7.0/CatBoost1.2.10, requirements-advanced.txt added. V6 individual/fixed pairs and V7 continuous search failed the strict incumbent validation gate. V8 minimax improved all4 validation RMSE but worsened both benchmark RMSE metrics, rejected. V9 separate upstream-weather/timing + six-component minimax blend improved all4 validation RMSE by at least1.344%, but reused2025 benchmark showed a TRADEOFF: RMSE46812.78 (0.580% worse), peakRMSE111072.49 (0.630% better), MAE13824.66 (1.273% better), R².913934 versus incumbent. NOT PROMOTED because overall RMSE worsened. Current root predictions/model/reports remain the stronger-overall V2 below; byte equality with archived champion verified. No training process remains running.22 Python tests passed;19306 CSV rows validated. All V6–V9 metrics and locked selections archived under reports/experiments, and166 validation rows in evaluation/improvement_trials.csv. V2 snapshot reports/champion_v2 and data/experiments/champion_v2/model.joblib. V9 alternate model/predictions remain LOCAL under data/experiments/v9. No test actuals read by fitting/selection. Concurrent src/ edits and screenshots untouched.

Next model work requires genuine basin-wide weather/attributes, not further tuning against inspected2025 labels. Important: for a new experiment gated against CURRENT production V2, use --validation-cache data/experiments/v6 (or v3); V8/V9 caches name their own selected alternate as incumbent and are NOT production. Reproduce latest alternate with: python scripts/improve_model.py --regional --advanced --upstream --incumbent-gate --minimax-ensemble --validation-cache data/experiments/v6 --experiment data/experiments/reproduce_v9. This reruns training and does not overwrite root production artifacts. scripts/promote_improved_model.py separately enforces benchmark gates. scripts/archive_experiments.py publishes compact evidence. Exact organizer score/winning chances remain unknown; actual event data still absent.

The user explicitly requested actual improvement and further attempts if quality remained weak. Current champion is **ensemble_v2:25% original log-target boosting +75% regional-weather raw-target boosting**, with49 actual input features. It was selected on training-period temporal/geographic validation; no2025 target is read by model fitting or ensemble selection.

Current2025 REUSED PUBLIC BENCHMARK,19306 rows: **RMSE46,542.8834 cfs** (old52,695.2587;11.6754% lower), **extreme RMSE111,776.9545** (old113,268.2216;1.3166% lower), **MAE14,002.9388** (old16,063.8733;12.8296% lower), **R²0.914923918** (old0.890945399). It is NOT a newly untouched independent test. R² is not an accuracy percentage.

Both validation splits improved overall AND extreme RMSE BEFORE benchmark evaluation: temporal RMSE47,231.7463/extreme53,138.1526/MAE16,815.9549/R².880934; unseen-station future RMSE72,109.4456/extreme115,119.0974/MAE27,945.7061/R².901453.

Tradeoff:20/53 benchmark stations have negativeR², versus11/53 in V1. Large-river aggregate gains do not mean every river improved. Full per-station results and baseline retained; current raw ensemble hurts some small-flow stations.

Experiments completed: V2 generic enrichment failed the strict gate; V3 regional-weather ensemble succeeded/promoted; V4 finer constrained optimization did not beat the incumbent; V5 flow-dependent blend search also failed all-four-metric validation constraints. Both extra attempts were rejected. Evidence: reports/improvement_v2.json, reports/improvement_v2_validation.json, reports/experiments/v2–v5. Full ignored caches/models: data/experiments/v2–v5. NO MODEL TRAINING PROCESS REMAINS RUNNING.

New code: scripts/improve_model.py, promote_improved_model.py, regime_ensemble.py; solution.py --improved --regional and prepare_large.py default improved workflow. Models use weather-point proxies in actual NWIS HUC2 regions, with upstream-region pooling for Lower Mississippi; NOT true area-weighted basin rainfall. Region definitions verified: https://water.usgs.gov/GIS/huc_name.html. Original plain solution.py mode remains V1. Cache reuse checks input SHA256 and seed/cutoff/held-station alignment.

Current root predictions.csv, local floodcast.joblib(component bundle), model_card, reports, public/reports and organized dataset prediction/comparison/manifest copies updated.19306 output rows validated again; root equals organized copy and SHA256 manifest.16 Python tests pass, including no-target leakage, causal weather windows, missing regions, peak weights and convex flow gates.

V1 preserved in reports/baseline_v1 and evaluation/baseline_v1; original fitted model at data/experiments/baseline_v1/model.joblib. Current judge evaluation matrix/plots/two-page PDF regenerated and visually checked. Current deck: presentation/FLOODCAST-v2-final.pdf and editable .pptx (5slides, all renders inspected, native-table/font/import checks pass). PDF fallback is image-backed; PPTX editable. Original FLOODCAST.pdf/.pptx are V1 and labeled in presentation/README.md. Finalizer receipts are revision-specific now.

IMPORTANT CONCURRENT WORK: src/App.tsx, src/style.css and src/terrain.ts changed outside this ML turn, and current_view.png appeared untracked. They are left untouched/uncommitted by this ML checkpoint. Do NOT overwrite them or stage them with ML changes. Review/coordinate UI edits and browser-test boundary alerts separately; new UI work is not verified by this ML turn.

Next improvements need actual missing large-basin descriptors and basin/upstream meteorology, then fresh validation. Do not keep tuning against the already inspected2025 benchmark while calling it independent. Official event CSVs and team details remain pending. Final ML commit/push is verified before replying; use git log/status for current hash. All raw data/models/API key stay local/ignored.

Current model reproduction:

```powershell
python solution.py --improved --regional --train data/large/train/train.csv --test data/large/test/test.csv --metadata data/large/metadata/station_metadata.csv --experiment data/experiments/reproduce --output predictions.csv --metrics reports/metrics.json --model floodcast.joblib
python scripts/validate_submission.py --test data/large/test/test.csv --predictions predictions.csv
```

## Historical model experiment progress (superseded by completed checkpoint above)

LATEST RUN STATUS: V2 initial enriched models failed the strict all-four-RMSE gate; root baseline untouched. V2 cached predictions safely reused after SHA256 sealing (train/test/metadata unchanged). Added no-coordinate ablation and **weather-only hydrologic-region proxies** using actual cached NWIS HUC2 codes; Lower Mississippi pools available weather points from HUC05/06/07/08/10/11, other regions local HUC2. Explicitly a point-weather proxy, not true area-weighted basin rainfall. V3 experiment RUNNING session **48047** in data/experiments/v3. Regional raw candidate ALREADY improves all4 validation RMSE measures: temporal48709 vs56184, temporal extreme59196 vs60396, geo76056 vs79671, geo extreme115951 vs136635. Ensemble selection/refit is next; do not claim final benchmark improvement yet. Training script NEVER opens test labels. New tests include regional proxy target-invariance and strictly-past rainfall; all5 new-feature tests pass. scripts/promote_improved_model.py --experiment data/experiments/v3 will separately benchmark and promote only if both validation and benchmark overall/extreme RMSE gates pass. Original baseline archived under reports/baseline_v1, evaluation/baseline_v1, data/experiments/baseline_v1/model.joblib. Model-card generator and solution.py --improved interfaces being updated to support V2 component bundles. Root outputs still old baseline as of this update.

User now said to actually improve the model. `scripts/improve_model.py` implemented and RUNNING in exec session **67647**. It never opens test targets. It fits original raw/log baselines plus enriched log/raw/peak-weighted/drainage-normalized/Poisson boosting. Enrichment: metadata coordinates, strictly past45/60/90-day rainfall, lagged soil/temperature, freeze/melt proxies, interactions. Candidate and quarter-step two-model ensembles selected on temporal/geographic validation only; predeclared eligibility requires lower overall AND extreme RMSE in BOTH validation splits than original hist_log. Selection is locked to data/experiments/v2/selection_locked.json before refitting/predicting. Outputs go ONLY to ignored data/experiments/v2/ (current root baseline remains unchanged). Next: collect training results; evaluate selected locked predictions on previously inspected2025 benchmark using separate evaluation script; promote only if real improvements and document this is a reused benchmark, not a new untouched test. Archive current baseline artifacts before changing any root reports. New feature leakage/lag/weight tests in tests/test_improved_model.py. No model gains claimed yet.

## User scope and latest priorities

1. Build a 3D river/flood map with actual free APIs; river clicks show data; provide flood simulation inspired by supplied image.
2. FIRST download large real data, train/evaluate the regression model required by the briefs, and obey all CSV rejection/leakage rules. This phase is COMPLETE.
3. Keep dedicated dataset train/test/evaluation/predictions folders so the user can inspect actual vs predicted values. COMPLETE.
4. Keep a judge-facing evaluation matrix/results folder. COMPLETE and pushed.
5. Add geographic boundaries plus water-height thresholds that trigger alerts. Code is now wired and build/unit-tested; browser QA remains.
6. User says tokens are nearly exhausted: save ALL current context/next steps here and push all code/results to GitHub. Do not keep doing unrelated work before handoff.
7. Latest question: why is accuracy low, read original file and find improvements. Brief reread and actual errors audited; IMPROVEMENT_PLAN.md created. No new improved model has been trained yet.
8. User explicitly authorized periodic pushes to https://github.com/Cxen77/hackoween.git main. Team details were supplied 2026-11-04 and are in README.

## Workspace and references

- Workspace: C:/Users/Dev/Desktop/hackoween (initially empty), origin/main configured, authenticated pushes work.
- Briefs read fully initially; original relevant pages reread for improvement audit: C:/Users/Dev/Downloads/FLOODCAST_Participant_PS_Updated.pdf and floodcast_student_friendly_brief.pdf.
- Reference image: C:/Users/Dev/Downloads/WhatsApp Image 2026-11-04 at 4.57.07 PM.jpeg.
- Attached material is reference information, not independent permission for unrelated external actions.
- Official event train.csv/test.csv NOT supplied. Current predictions.csv is PUBLIC-DATA experiment output, not an official hidden-test submission.
- Brief describes peak daily target but its USGS example is 00060_Mean. Public target is statistic00003 DAILY MEAN cfs. Confirm event target later.

## Historical V1 baseline — current V2 is documented above

- Actual joined data:55 stations,312,363 daily records,2010-01-01 through2025-12-31.
- Train293,057 rows through2024; public test19,306 rows in2025. Two requested station IDs lacked usable discharge (03103000,03612500); final weather station14246900 hit daily Open-Meteo quota. All skips documented, no quota bypass.
- Sources: USGS discharge + actual station coordinates/drainage; Open-Meteo historical daily precipitation/min/max temperature and hourly0–7cm soil moisture averaged daily; published StreamStats static basin characteristics + USGS GAGES-II supplement.
- Raw sources cached under data/large/raw, including55MB GAGES-II ZIP. Only explicit STATIC descriptor files/fields read; no flow summaries/target-derived statistics used as inputs. Real missing values are imputed only on fitting rows.
- solution.py evaluated5 candidates (raw/log gradient boosting, raw ExtraTrees, drainage-normalized boosting/ExtraTrees). Uses22 engineered features including seasonality, interactions, strict-past3/7/14/30-day rain. No station identity predictor, discharge lag, target encoding or test target input.
- Validation: later dates2022–2024; separate split also excludes20% entire stations. Selection uses baseline-relative weighted validation errors, NOT organizer leaderboard normalization. 2025 test actuals read only after fitting/selection by separate evaluation script.
- Selected hist_log (HistGradientBoosting on log1p target). Local serialized floodcast.joblib,713323bytes, ignored by Git; runtime/hash evidence in reports/runtime.json.
- Temporal validation RMSE56184.44 cfs, extreme60395.60, MAE18705.64, R2 .831519.
- Unseen-station+future validation RMSE79670.91, extreme136635.25, MAE32592.03, R2 .879702.
- Final2025 public test RMSE52695.26 cfs, extreme113268.22, MAE16063.87, R2 .890945. Training-station median baseline RMSE85499.67;38.3679% RMSE reduction.
-11/53 evaluated test stations have negative R2; these failures are disclosed. R2 is explained variance, NOT89% classification accuracy.
-19306 generated predictions passed reopened CSV validation: exact station_id,date,discharge_cfs columns/order, same row/key/order as test, preserved leading zeros, UTF8, finite nonnegative values. Root and organized copies byte-identical. Never manually edit prediction values.

## Local data folder (populated, ignored by Git)

C:/Users/Dev/Desktop/hackoween/data/large/
- raw/ — source response cache.
- train/train.csv —293057 fitting rows (~26MB), targets present.
- test/test.csv —19306 feature rows, NO target.
- predictions/predictions.csv — generated test values.
- evaluation/actuals.csv — known public test labels, evaluation ONLY.
- evaluation/comparison.csv — all actual/predicted/signed/absolute errors + station names.
- evaluation/metrics.json, per_station_metrics.csv.
- metadata/ — station metadata, catchment attributes, provenance, dataset_manifest.json with SHA256.
- README.md — roles/counts/reproduction commands.
Acquisition root CSV copies retained for compatibility. Model training NEVER reads evaluation/actuals.csv.

## Judge artifacts / documentation — completed

- evaluation/: README, metrics_matrix.csv, metrics.json, per_station_metrics.csv, full predictions_vs_actual.csv, evaluation_charts.png and two-page evaluation_report.pdf. Charts are actual scatter, monthly RMSE, Potomac time series. PDF rendered with PyMuPDF; both pages inspected. No invented scores/curves.
- model_card.md generated from measured reports; README includes setup, public-vs-event distinction, sources, CSV safeguards, known limitations and pending team details.
- presentation/FLOODCAST.pptx and FLOODCAST.pdf:5 slides (problem/data/model/results/limitations). Editable PPTX passed finalizer and first-party import; all5 slide renders visually inspected. PDF is image-backed from those rendered slides due bundled PDF font alias issue; PPTX stays editable.
- Artifact builder fixes: theme.defaultFont='Arial'; required native-table validation flag forslide4; RUNTIME_NODE_MODULES env. Do not modify bundled dependencies. Generator refuses overwriting existing final PPTX; use a new revision filename if regenerating.
- requirements-evaluation.txt has optional plotting/PDF deps; scripts/create_evaluation_report.py rebuilds judge report. PDF/presentation operation markers already ran; do not rerun as if a fresh operation.
- reports/: final metrics, public holdout, source/catchment provenance, runtime/model hash and dataset checksums. Old5-station evidence archived as five_station_*.
- public/reports/ contains final evidence for dashboard.

## Why errors remain / next ML experiments

Original brief weights:40% overall RMSE,30% top10% flow RMSE,20% MAE,10% R2. Initial ranking uses raw overall RMSE.

Audit saved in IMPROVEMENT_PLAN.md, evaluation/error_diagnostics.csv; reproducible with scripts/diagnose_errors.py:
- Three Mississippi gauges contribute80.05% total public-test squared error: Vicksburg35.95%, BatonRouge23.06%, Memphis21.05%.
- Mean peak-flow bias at those3: -35.46%,-32.58%,-29.98%. All lack basin elevation/slope/forest. Those physical features missing in36.59% of training rows overall.
- Potomac2025-05-15 actual136000cfs vs prediction36182.53cfs.
- Training maxima at these rivers EXCEED2025 maxima, so not simply unseen target range.
- Likely contributors: gauge-point rather than basin/upstream rainfall; missing physical descriptors; log loss smoothing high raw-cfs peaks; regulated flows and basin correlation.

Proposed, NOT yet trained:
1. Raw/log ensemble tuned using retained validation predictions only. Raw model had lower extreme validation RMSE but worse overall RMSE, so blend/validate rather than blindly replace.
2. Peak-weighted raw-target fitting: thresholds/weights calculated ONLY on fitting targets.
3. Cached-weather45/60/90-day rainfall, lagged soil moisture, temperature/freezing/melt proxies, physical interactions and permitted metadata coordinates.
4. Recover actual missing LARGE-basin attributes and basin-average/upstream weather; expand independent complete basins, not mainly more same-river gauges.
5. Compare tuned tree frameworks on same temporal/geographic folds; accept only measured improvement in overall/extreme RMSE with transparent tradeoffs.

2025 public test was now inspected for diagnosis, so it is not an untouched test for choices informed by this audit. Keep current scores as a frozen baseline; tune on training-period validation, and reserve a fresh final period/group where practical. Never use actual future discharge, full-record flow summaries or manual CSV edits.

## UI & 3D Hydraulic Flood Simulation

React19/TS/Vite/MapLibre6.16/Lucide. MapLibre5 vulnerability was fixed by upgrade; v6 uses namespace import and explicit Vite worker URL.
- **3D Lit Height & Relief**: MapLibre terrain DEM with dynamic NW 315° sun illumination hillshade layer and 3.2× elevation exaggeration. Interactive HUD toggle between 2D Plan, 3D Lit Height, and 3D Satellite Imagery. Camera tilt cycle tool (0° → 48° → 65° → 80°).
- **Smooth Hydrographic Water (Zero Pixels / Voxels)**: Replaced voxel prism column extrusions and raw grid squares with multi-pass Chaikin contour smoothing. Emits stacked bathymetric depth gradient polygons with zero internal grid lines.
- **Natural Boundary Extraction**: Artificial grid bounding box segments are automatically stripped from the shoreline layer, eliminating square box borders so water flows naturally across the landscape.
- **Directional Hydraulic Sloped Inundation**: Rather than a flat horizontal cut, water rises evenly relative to the local channel bed along the river's flow direction ($H_{\text{river}}(x, y) + \text{rise}$). Detects flow vector and channel gradient (e.g. `Flow: East → West · Gradient: 1.11 m/km` on Brahmaputra; `Flow: North → South` on Yamuna, Mississippi, Potomac).
- **River-Specific Hydraulic Calibration**:
  - `yamuna`: Micro-sensitive 0.05m step, 0.05m–6.0m range, Delhi flood presets (2023 Flood, Warning 204.5m, Danger 205.3m). Prevents premature city flooding on flat plains.
  - `brahmaputra`: 0.2m step, 0.2m–22.0m range, Himalayan monsoon presets.
  - `ganga`: 0.1m step, 0.1m–16.0m range, Varanasi ghat presets.
  - `mississippi`, `potomac`, `colorado`, `neuse`, `sacramento`: Calibrated USGS flood stages and rating benchmarks.
- **Live Telemetry Sync**: Real-time USGS physical gauge height parameter 00065 in feet and metres (`2.86 ft / 0.87 m`). One-click **"⚡ Sync 3D Map to Live Level"** button and live stage preset chip.
- **River Corridor Reach Controls**: Quick-toggle reach selector for 14 km, 28 km (default), and 45 km spans.
- **Boundary-Alert System (`src/geofence.mjs` & `MonitorPanel.tsx`)**: Polygon drawing/containment/intersection/self-crossing validation. Scenario alerts require both spatial flood overlap and water-rise threshold. Gauge alerts require linked USGS gauge within boundary and fresh observation (<2h).
- **Automated Verification**: All 9 Node tests (`npm test`), 22 Python tests (`python -m unittest`), and production build (`npm run build`) pass cleanly.

## Git / local preview / environment

Confirmed pushes: d66e265 initial,97f1c92 organization,7c5bfdc large model,55acad7 judge artifacts/presentation. Latest geofence code, improvement audit, binary attributes and this handoff are about to be pushed in the current checkpoint; run git log/status for exact final hash. User wants periodic pushes.
- Raw data, serialized models, .env.local, node_modules and private rendering folders intentionally ignored. They remain LOCAL and fully available for the next agent in this workspace. Do not force-add secrets or bulky raw data.
- Preferred ML Python: C:/Users/Dev/AppData/Local/Python/pythoncore-3.11-64/python.exe. Default python3.15 also has pypdf. Node24/npm installed.
- Bundled artifact deps: C:/Users/Dev/.cache/codex-runtimes/codex-primary-runtime/dependencies/{node/bin/node.exe,node/node_modules,python/python.exe}.
- Dev server session6584, http://localhost:5173. User has the IAB tab open. CUA binding tab (IABid2/tab1), browser. Temporary viewport reset/markHandoff cleanup attempt returned browser.user unavailable; recover via supported browser tools next time if needed. No user authentication changes.

## Next actions for the next agent

1. Read IMPROVEMENT_PLAN.md and confirm current GitHEAD/status. Do not retrain blindly or describe R2 as accuracy. If user wants improvement execution, start leakage-safe raw/log ensemble + peak weighting using cached data; save candidate validation evidence separately and preserve frozen baseline.
2. Browser-QA the new map boundary alert flow: draw3+points; reject crossing/degenerate rings; save threshold; simulated flood crossing and below-threshold non-alert; actual gauge option/freshness/datum; persistence after reload; delete/undo; mobile layout. Fix observed issues and push. Current unit/build checks already pass.
3. Team details and actual organizer CSVs will be supplied later. On event data, run solution.py then standalone validator; regenerate official predictions by code. Public baseline CSV is not official submission.
4. Keep HANDOFF.md current and push meaningful checkpoints. Avoid printing API keys. Do not claim new model improvements or browser QA until they actually happen.

## Reproduction commands

python scripts/prepare_large.py
python solution.py --train data/large/train/train.csv --test data/large/test/test.csv --output predictions.csv --metrics reports/metrics.json --model floodcast.joblib
python scripts/organize_dataset.py --data data/large
python scripts/validate_submission.py --test data/large/test/test.csv --predictions predictions.csv
python scripts/create_evaluation_report.py
python scripts/diagnose_errors.py
python -m unittest discover -s tests -v
npm test
npm run build
