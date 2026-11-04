# FLOODCAST — current handoff

Updated: 2026-11-04, Asia/Calcutta. Read this file first when continuing. Keep it current; do not create competing context logs.

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
