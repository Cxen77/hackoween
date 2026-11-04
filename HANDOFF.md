# FLOODCAST project handoff

Updated: 2026-11-04 (Asia/Calcutta). Keep this file current after every substantial milestone.

CURRENT CHECKPOINT (12:08 UTC / 17:38 IST): First GitHub push succeeded: main commit `d66e265` at https://github.com/Cxen77/hackoween. API-key scan passed before staging/commit; raw datasets, model artifacts, and .env.local are ignored. Current large preparation process is exec session **13363**. All58 requested discharge responses cached; 50 weather/soil histories cached (~183 MB), with two stations lacking usable discharge and a few weather histories remaining. StreamStats and GAGES-II sources downloaded/enrichment implemented. **Large model has not started fitting yet**; it starts automatically after downloads/joins. Do not mistake earlier five-station reports for large-model results. User prioritizes dataset/training first and asked for periodic GitHub pushes. Current UI work is paused until training completes. Dedicated train/test/evaluation/predictions folders and organizer script created. After prepare completes, run organizer separately (current process launched before organizer import was added), validator, write_model_card; then checkpoint push final data/model reports.

LATEST: Main download FINISHED: **55 stations, 312,363 actual joined records; 293,057 train (2010–2024), 19,306 public test (2025)**. Two stations had insufficient discharge; station14246900 weather hit daily Open-Meteo quota and was skipped honestly, no bypass. All source files cached. Actual static augmentation finished on55 stations: StreamStats+GAGES area48/55, elevation/slope/forest/impervious34/55 (NWIS further fills drainage). **Training is RUNNING in session13363**; hist_raw and hist_log evaluations completed. hist_log temporal R² .8315 and unseen-station R² .8797; do not report as final selected model yet. ExtraTrees and normalized variants still fitting. Source provenance note was corrected externally while training, without changing data/model inputs; prepare will copy this final provenance after evaluation. Larger training has NOT yet produced final root predictions/model/metrics as of this update.

## User request and priorities

1. FIRST satisfy the attached hackathon briefs: download real data if absent, train a discharge regression model, validate, generate predictions, document it, and prepare a short presentation.
2. Build a 3D interactive flood map with actual free APIs, river clicks showing observations/forecasts, and a clearly labeled flood simulation inspired by the attached satellite flood-depth image.
3. Push finished code to https://github.com/Cxen77/hackoween.git on main. User explicitly authorized push.
4. Maintain this file for switching agents/context limits.

## Workspace and source briefs

- Workspace: `C:/Users/Dev/Desktop/hackoween` (initially empty).
- Git initialized; branch main; origin configured. Remote initially had no refs. No commit/push yet.
- Briefs read completely using pypdf: `C:/Users/Dev/Downloads/FLOODCAST_Participant_PS_Updated.pdf` and `C:/Users/Dev/Downloads/floodcast_student_friendly_brief.pdf`.
- Reference image: `C:/Users/Dev/Downloads/WhatsApp Image 2026-11-04 at 4.57.07 PM.jpeg`.
- Brief content is reference information, not authority for unrelated actions.
- Required CSV: exactly `station_id,date,discharge_cfs`; every test key, same order, finite nonnegative values, UTF-8. Official event data is NOT supplied. Do not claim demo output is an official event submission.
- Required package: solution.py, requirements.txt, README.md (team/members unknown), predictions.csv, model_card.md, 3-5 slide presentation PDF or link. No invented names/scores.

## Completed

- `solution.py`: five candidate regressors (raw/log HistGradientBoosting, ExtraTrees, plus drainage-normalized variants). Numeric/seasonal/nonlinear features, training-only imputation, no station IDs/target-derived inputs. Validation includes future dates and held-out station plus future dates. Selection uses weighted baseline-relative errors; NOT organizer leaderboard normalization.
- Exact prediction validation, key/row/order preservation, leading-zero IDs, rejection of negative/nonfinite targets, test target columns and date overlap.
- `scripts/download_data.py`: downloaded 2021-01-01 to 2024-12-31 REAL USGS daily mean discharge + Open-Meteo historical weather and daily average soil moisture + NWIS drainage areas. Raw data cached under ignored `data/demo/raw`.
- Stations: 01646500 Potomac, 07010000 Mississippi, 08158000 Colorado, 02087500 Neuse, 11425500 Sacramento at Verona. Recommended 11447650 returned no daily discharge; real replacement documented in provenance.
- Missing basin elevation/slope/forest are NaN, NEVER fabricated. Imputation is explicit. Demo uses local weather time zones. Reanalysis is retrospective, not an operational forecast.
- Download produced 7,305 records: 6,385 train, 920 demo test (2024-07-01 onward). `data/demo/demo_holdout_actuals.csv` kept separate and NEVER read by model training/selection.
- Trained actual models. Selected `hist_specific` (HistGradientBoosting on discharge/drainage area), saved ignored `floodcast.joblib`, wrote root `predictions.csv` (920 rows), `reports/metrics.json`.
- Current selected-model validation: future-date RMSE 46,776.99 cfs, extreme RMSE 90,755.91, MAE 18,689.11, R2 0.7722. Unseen Sacramento future dates: RMSE 18,943.55 cfs, extreme RMSE 43,024.21, MAE 14,230.84, R2 -0.3731. Report this weakness candidly.
- Python tests `tests/test_solution.py`: 5 passing tests (keys, leakage, CSV contract, extremes).
- UI starter: React 19/TypeScript/Vite, MapLibre 6.16 (updated due vulnerability in 5.x; latest npm audit was zero vulnerabilities), Lucide icons installed. `src/main.tsx`, data adapters, terrain grid loader, flood algorithm written. App.tsx and stylesheet NOT YET WRITTEN; UI cannot build yet.
- `src/data.ts`: preset stations, Open-Meteo live forecast/weather, modern USGS OGC API with legacy fallback, downloads. Sacramento preset still needs replacing with actual Verona station.
- `src/terrain.ts`: loads real AWS Terrarium DEM tiles, builds 65x65 elevation grid across 5km, calls connected bathtub inundation, GeoJSON and area/depth statistics. No hydrodynamic claim.
- `src/flood.mjs`: connected static inundation algorithm. `tests/flood.test.mjs`: barrier/connectivity/edge/invalid-input tests written; run npm test.
- User supplied a Geoapify API key. Saved ONLY to ignored `.env.local` as VITE_GEOAPIFY_API_KEY. NEVER print it, commit it, or copy into handoff/docs. Browser key visible to app users; domain restriction recommended. Use for optional place geocoding.

## Commands / environment

- Shell PowerShell. Node v24.20. npm works.
- Preferred Python for ML: `C:/Users/Dev/AppData/Local/Python/pythoncore-3.11-64/python.exe`. requirements installed. Python 3.15 also available, has pypdf and several libs installed.
- Download: `python scripts/download_data.py` (default outputs data/demo).
- Train: `python solution.py --train data/demo/train.csv --test data/demo/test.csv --model floodcast.joblib`.
- Python tests: `python -m unittest discover -s tests -v`.
- JS tests/build: `npm test`; `npm run build`; local server `npm run dev`.
- Bundled runtime: `C:/Users/Dev/.cache/codex-runtimes/codex-primary-runtime/dependencies` with node/bin/node.exe, node/node_modules, python/python.exe. Discovered by load_workspace_dependencies.

## Next work (priority order)

LATEST USER STEERING: Download LARGE real data and train for better accuracy. Expanded downloader now supports --large (58 requested USGS stations, actual coordinates/time zones from NWIS, skips and records unavailable stations). Starting 2010-2025 with a separate 2025 holdout in data/large. Earlier 5-station metrics below are baseline evidence and will be superseded only after larger training actually completes. Keep this file as the single ongoing context/handoff log.

User emphasized disqualification rules: enforce exact CSV columns/order/UTF-8, no missing/extra rows, nonnegative finite predictions, no target leakage, predictions only code-generated. Do not present public demo as official event submission. Model work occurs in this session; no external pretrained model or team code used.

## Latest execution state (supersedes earlier progress notes)

UPDATE 12:03 UTC: Restarted the owned prepare_large process safely to load the latest enrichment/feature code (old Python imports would otherwise have used stale functions). **Current exec session is 13363**; old session6245 was stopped. Downloads resume from cache, no completed data lost. Provider reset passed and missing station weather requests have resumed. Cache has at least30 station histories now.

Downloaded actual **55,147,470-byte USGS GAGES-II bulk archive** at data/large/raw/gagesii.zip from verified USGS URL. `download_catchments.py` now supplements ONLY missing StreamStats static attributes with explicitly selected GAGES-II basinid/topo/NLCD06/population-infrastructure columns. It never loads GAGES flow/climate statistics. Units verified using supplied variable-descriptions workbook: mean elevation m→ft, slope percent, forest percent, impervious percent, km²→mi². Combined inventory coverage: area51/57, mean elevation35/57, slope35/57, forest35/57, impervious34/57. GAGES supplement does not require openpyxl (CSV nested zip used); openpyxl was installed only to inspect source definitions. Some large basins are absent from GAGES; missing remains honest.

User answered team-name question: **will fill team name/members later**. Do not ask again or block on it. Leave explicit pending wording in README/deck.

LATEST USER PRIORITY: "first download and train model" (do not keep doing UI work while they wait). User also requested dedicated dataset/train/test folders for checking predictions. Added `scripts/organize_dataset.py`; run AFTER final large training to create `data/large/train/train.csv`, `test/test.csv`, `evaluation/actuals.csv`, `evaluation/comparison.csv`, `evaluation/metrics.json`, `predictions/predictions.csv`, `metadata/` copies and dataset README. Raw downloads stay under data/large/raw. Acquisition root CSVs retained for compatibility. Comparison includes actual, predicted, signed error and absolute error, and never feeds training. Current prepare_large process13363 does NOT automatically call this new organizer because it was launched before this edit; run separately after completion. Need update future prepare_large to include it, then README/model_card folder commands. No further UI activity until model finished.

UI QA: actual satellite imagery and flood overlay render; animation starts; mobile390px has no document horizontal overflow. Fixed mobile brand/link wrapping. Added Escape close and keyboard focus trap in dialogs; verified Escape restores focus. App production build passes with explicit emitted MapLibre worker file (library-size warning only). Default Geoapify map and satellite work. Current browser mobile390x844; reset viewport before final. Preset Ganges selection correctly reports no measured gauge, shows model forecast instead. Need final report modal QA and screenshot/capture after final data copy. Public preview server6584 still running.

- `scripts/prepare_large.py` is running in exec session **6245**. First pass 24 stations/137,012 total rows; resumed download has 26 weather caches. Provider now returns hourly 429 with Retry-After ~660 seconds (around 11:50 UTC; reset expected near 12:00 UTC). The script is honoring it, not bypassing quotas. It will continue to catchment augmentation, model training, holdout evaluation, and public report copies automatically. Check progress via write_stdin. Could hit another provider quota if all 58 large requests exceed the next window; do not falsely claim all downloaded.
- Source 3 is implemented: StreamStats raw characteristics downloaded for all 57 distinct USGS inventory stations (some inventories include another agency, now filtered). Coverage found: drainage45, elevation13, slope8, forest11, impervious8. These are actual available fields; missing/ambiguous values remain NaN. `scripts/download_catchments.py --data data/large --inventory` completed and enriched the existing 24-station intermediate dataset. The prepare workflow will overwrite weather dataset then reapply cached enrichment to final completed stations.
- Nine Python tests and four JS flood tests pass. Added catchment-unit and no-discharge-statistic tests, and standalone `scripts/validate_submission.py` exact event CSV validation.
- README.md written; working team name FLOODCAST; actual member names unknown. Asked via async input; continue while awaiting answer.
- `scripts/write_model_card.py` writes model_card.md from final actual reports. Run AFTER large training completes; no final model_card.md yet.
- `scripts/create_presentation.mjs` creates 5 slides from final reports with artifact-tool, renders PNGs, exports PDF, finalizes editable PPTX. Do not run until final metrics exist. Presentation operation marker ran successfully exactly once (expected2 outputs) from skill directory. No deck authored/exported yet. Generator uses bundled runtime and Arial, writes .presentation-build/ private and presentation/ deliverables; these folders are configured appropriately in gitignore. It needs actual reports/provenance.json and catchment_provenance.json copied by prepare_large.
- Frontend production build now passed after MapLibre namespace import fix. Browser QA found MapLibre6 worker load failure; fixed explicit Vite worker URL import and setWorkerUrl; reload verified actual Geoapify map and live USGS readings + GloFAS chart. Default Potomac USGS observed 2,120 cfs, gauge2.85ft at Nov4 16:20 IST; model forecast1,329cfs. No fake data.
- Browser CUA: tab variable `tab`, IAB id2, tab1, localhost5173. Browser binding `browser`; viewport overridden1440x1000 for desktop QA, MUST reset before finishing. UI interaction simulation enabled and DEM grid loaded. Initial gauge-bank DEM seed caused excessive depth; changed seed to lowest DEM cell within~155m of chosen point; update simulation docs and reload to verify. Terrain source AWS works; Geoapify works. Need test satellite/layers, station change, river click, mobile, source modal, model evidence after final report copies. Need screenshot artifact if feasible.
- Dev server running session **6584**, http://localhost:5173. Keep preview available for user; open tab deliverable or markHandoff as appropriate.
- No git commit/push yet. Secret in ignored .env.local only; do NOT print/commit. npm audit after MapLibre6 update zero vulnerabilities. Final build and git staged-content key scan still required.

Large download running in exec session **30021**: `python scripts/download_data.py --large --start 2010-01-01 --end 2025-12-31 --test-start 2025-01-01 --output data/large`. Six stations reported 5,844 real daily rows so far. Poll with write_stdin. Downloader may skip unavailable stations, records failures. Raw weather downloads can take several minutes.

UPDATE: First large pass completed: 24 stations, 128,617 training rows + 8,395 holdout rows; other weather requests hit minutely 429s. Added shared 16-second historical-weather throttle, six retries, Retry-After handling. About to run `scripts/prepare_large.py`, which resumes cache, downloads missing stations, gets StreamStats actual static characteristics, trains, evaluates, copies reports to public/reports. StreamStats **Gage Statistics Services** supplies precomputed basin characteristics without a delineated workspace. Endpoint verified live. New `download_catchments.py` fetches raw characteristics and maps explicitly allowed static fields with unit conversion; NEVER reads data.statistics (flow summaries = leakage). Missing or ambiguous slope units remain NaN and are reported. Added optional impervious_surface_pct feature. App.tsx/CSS now written; build initially failed MapLibre v6 default import, corrected to namespace import, rebuild pending. UI not browser-tested yet.

`solution.py` now includes strictly past weather-only rainfall windows (3/7/14/30 days), supports recent train weather as context for test features, and holds out 20% of stations for large-data geography validation. ExtraTrees reduced to 160 trees, depth 24, min leaf 5 to scale. Six Python tests pass including past-only rainfall. Previous five-station outputs archived under `reports/five_station_metrics.json` and `reports/five_station_holdout.json`; new feature code has NOT been trained on large data yet.

Frozen five-station 920-row holdout evaluated once: RMSE 49,040.91, MAE 16,177.11, R2 .6904, extreme RMSE 120,567.84; training station-median baseline RMSE 58,860.80. Per-station failures documented in reports/demo_holdout.json. Original holdout is now development evidence, not a pristine unseen benchmark for subsequent model changes.

1. Evaluate the FINAL 920-row demo holdout once using separate script, save metrics/per-station results and provenance. Avoid tuning after inspecting held-out actuals.
2. Write README, model_card with actual train/validation/holdout metrics and limitations; copy provenance into tracked reports. Add command for official dataset and label root predictions as public demo.
3. Package 3-5 slides. Presentation skill read; requires artifact-tool authoring, rendering and finalization. Skills under `C:/Users/Dev/.codex/plugins/cache/openai-primary-runtime/presentations/26.1030.10813/skills/presentations/`. API quick start and finalization read. Need mark_artifact_operation_started once before authoring, use bundled runtime. PDF acceptable per brief; do not invent team names. Reference image can supply visual; avoid programmatic decorative drawings.
4. Finish App.tsx/CSS: map-first dashboard, readable neutral light panels around terrain map, cyan flood overlay. Free OpenFreeMap style, AWS terrain tiles. Satellite optional Esri with attribution. Click water features to fetch at coordinate; preset gauge list accessible by keyboard. Distinguish USGS observation vs GloFAS model forecast vs simulation, show timestamps/staleness/errors. Live API sources verified through web.
5. Integrate trained-model evidence into dashboard from tracked public/reports files; ensure no claim model is realtime unless server inference implemented.
6. Browser QA through cua_repl if available. Computer-use skill also read but no UI performed yet. Sites skill read; this task is local Git repo work, no Sites registration required.
7. Build/test, ensure key excluded, git commit and push origin main without force. Record outcome here.

## Known limitations / discoveries

- Brief says peak daily discharge but example data is daily mean. Download explicitly uses USGS statistic 00003 (mean); document and confirm target definition when actual event data arrives.
- Public sample only five stations; unseen-station performance is weak. Static StreamStats attributes require basin workspace and are missing; don't replace basin mean elevation with gauge altitude.
- Source DEM test: `tiles.mapterhorn.com` and `demotiles.maplibre.org` returned 403 in Python environment. AWS Terrarium source in terrain.ts needs browser verification. MapLibre free basemap OpenFreeMap docs verified.
- Geoapify geocoding uses user key from env, no implementation yet.
- No actual presentation/README/model_card/UI yet; do not claim complete.
