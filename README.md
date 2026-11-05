# FLOODCAST

Predict river discharge from weather and catchment characteristics, then explore observations, model forecasts, and flood scenarios on an interactive 3D map.

## Production hosting

Live app: [floodcast-hackoween.vercel.app](https://floodcast-hackoween.vercel.app). API health: [Render health](https://floodcast-api-ok9n.onrender.com/api/health). Anonymous deployment checks are saved in `reports/deployment.json`; repeat them with `python scripts/check_hosted_site.py --frontend https://floodcast-hackoween.vercel.app --station 01646500`.

- Render runs the Python model API at `https://floodcast-api-ok9n.onrender.com`. Build with `pip install -r requirements-render.txt`, start with `python -m server.model_api`, and health-check `/api/health`. `PORT` selects the public bind address automatically. `.python-version` and the pinned serving dependencies reproduce the serialized model runtime without installing training/report packages. `render.yaml` records the free-plan configuration; numerical-library thread counts are limited to1.
- Vercel builds the Vite frontend with `npm ci` and `npm run build`, publishing `dist/`. `vercel.json` forwards `/api/*` to Render on the same browser origin and keeps SPA routes working. Production project: `floodcast-hackoween`.
- Set `VITE_GEOAPIFY_API_KEY` in Vercel's Production and Preview environment settings before building. The browser map uses this key; no actual key belongs in Git. Restrict its allowed domains in Geoapify as appropriate.
- The served model and `model_meta.json` are committed, so live forecasts do not need the full training dataset. The optional raw Caravan dataset is excluded; the UI reports when random-basin reruns are unavailable, while saved benchmark reports, uploaded-file checks and live river forecasts remain available.
- Render's free service can sleep when idle; the first model request may take longer while it starts. The map and static reports are served separately by Vercel.

**Team name:** Straw_Hats  
**Members:**
- Harsh Srivastav (1BY25CB020)
- Arman Jha (1BY25CS057)
- Sumit Santosh Bulbule (1TD25CS307)
- Dev Chandra Prasad Yadav (1BY25CS085)

## Approach

The regression pipeline joins actual USGS daily discharge, Open-Meteo historical weather and soil moisture, and published USGS StreamStats basin characteristics. It compares gradient boosting and ExtraTrees models on raw, log, and drainage-normalized discharge using temporal and unseen-station validation. Features include seasonal terms, rainfall interactions, and strictly preceding 3/7/14/30-day weather windows; discharge targets never enter the input features. The selected model generates a validated, non-negative numerical prediction for every test station/date. The map independently displays latest USGS observations, Open-Meteo/GloFAS river forecasts, and an explicitly labeled elevation-based flood scenario.

## Important submission distinction

The organizers supplied only the briefs; no `train.csv` or `test.csv` were provided (confirmed by the team). The root **`predictions.csv` is therefore generated from the public-data experiment** (USGS, Open-Meteo and StreamStats, 55 stations, 2025 test period) using the same code and the same file schema as the brief, not from a hidden organizer test set. If organizer files are released later, rerun the command in "Generate the official event submission" on them. Do not describe the public-data CSV as scored on the organizers' hidden rows.

The public target is **USGS daily mean discharge, parameter 00060 / statistic 00003, in cfs**. The brief uses both “peak daily discharge” and daily-mean source examples; confirm the organizers' actual target definition. The supplied training script learns the target from their CSV without substituting public labels.

## Improved model results

V2 blends 25% log-target boosting with 75% raw-target boosting using regional weather proxies. On the previously inspected 2025 public benchmark:

| Metric | Original V1 | Improved V2 |
| --- | ---: | ---: |
| RMSE (cfs) | 52,695 | 46,543 |
| Extreme RMSE (cfs) | 113,268 | 111,777 |
| MAE (cfs) | 16,064 | 14,003 |
| R² | 0.8909 | 0.9149 |

Overall RMSE improved 11.7%; extreme RMSE improved 1.3%. This is a reused benchmark, not a newly untouched test. Performance is uneven: 20/53 stations have negative R², compared with 11/53 in V1. Original model artifacts are preserved in `reports/baseline_v1/` and `evaluation/baseline_v1/`.

Reproduce the selected model from the existing dataset:

```powershell
python solution.py --improved --regional --train data/large/train/train.csv --test data/large/test/test.csv --metadata data/large/metadata/station_metadata.csv --experiment data/experiments/reproduce --output predictions.csv --metrics reports/metrics.json --model floodcast.joblib
python scripts/validate_submission.py --test data/large/test/test.csv --predictions predictions.csv
```

The improved workflow uses averages of available weather points in [USGS hydrologic regions](https://water.usgs.gov/GIS/huc_name.html), with upstream-region pooling for the Lower Mississippi. These are approximate weather proxies, not area-weighted basin precipitation. No test target is used in model fitting or ensemble selection. `python scripts/prepare_large.py` now runs the improved workflow by default; plain `python solution.py` without `--improved` remains the V1 reproduction mode.

## Run the website

Requires Node.js 22.12+ or 24+.

```powershell
npm ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
# Add your Geoapify browser API key to .env.local if desired.
npm run dev
```

Open http://localhost:5173. The configured local environment already contains the supplied Geoapify key; **do not overwrite an existing `.env.local`**. Environment files are ignored by Git. Geoapify browser keys are visible in requests; restrict the key to your deployment domains. Without a key, the map uses CARTO tiles and preset stations, with Alt-click location selection.

Use the river list or click a water feature to inspect a location. On satellite/raster basemaps, use Alt-click because raster tiles do not contain queryable river features. Enable **Flood scenario**, change the water rise, and animate the connected inundation. The seven-day chart shows an external GloFAS forecast, not this project's trained model. The Prediction model view displays recorded training/validation evidence.

```powershell
npm test
npm run build
npm run preview
```

## Download a large dataset and train

Requires Python 3.11+ (3.11 recommended).

```powershell
python -m pip install -r requirements.txt
python scripts/prepare_large.py
```

This resumable workflow requests up to 58 USGS stations for **2010–2025**, joins all three named sources, keeps **2025 as a separate holdout**, trains candidate models, generates predictions, evaluates the frozen model, and copies evidence to `reports/` and `public/reports/`. Failed stations and missing attributes are recorded. Long weather requests consume weighted API quotas; the downloader caches completed responses and honors `Retry-After`. It may pause for a provider quota reset. Rerun to resume cached work.

The dedicated local dataset folder is organized for inspection:

```text
data/large/
  raw/                         cached source downloads
  train/train.csv              fitting data, including discharge targets
  test/test.csv                later inputs, without discharge targets
  predictions/predictions.csv  generated values for those test rows
  evaluation/actuals.csv        actual public holdout answers, evaluation only
  evaluation/comparison.csv    actual, predicted, signed error, absolute error
  evaluation/metrics.json      final public holdout scores
  metadata/                    stations, attributes, and source provenance
  README.md                    dataset-specific counts and instructions
```

Open `evaluation/comparison.csv` to inspect predictions. The training script does **not** read `evaluation/actuals.csv`. Acquisition-stage copies remain at the root of `data/large/` for compatibility. To rebuild organized copies after a manual training run, use `python scripts/organize_dataset.py --data data/large`.

Run the stages individually:

```powershell
python scripts/download_data.py --large --start 2010-01-01 --end 2025-12-31 --test-start 2025-01-01 --output data/large
python scripts/download_catchments.py --data data/large
python solution.py --train data/large/train.csv --test data/large/test.csv --output predictions.csv --metrics reports/metrics.json --model floodcast.joblib
python scripts/validate_submission.py --test data/large/test.csv --predictions predictions.csv
python scripts/evaluate_holdout.py --data data/large
```

The first small baseline is reproducible with `python scripts/download_data.py` (2021–2024, five stations, output `data/demo`). Its earlier scores are archived separately in `reports/five_station_*.json` and are not the final model's results.

## Generate the official event submission

Put the actual event CSVs in `data/event/`, retaining station IDs as strings. Run:

```powershell
pip install -r requirements.txt
python solution.py --improved --regional --train data/event/train.csv --test data/event/test.csv --metadata data/event/station_metadata.csv --experiment data/experiments/event --output predictions.csv --metrics reports/event_metrics.json --model event_model.joblib
python scripts/validate_submission.py --test data/event/test.csv --predictions predictions.csv
```

This improved command was dry-run on files in the organizers' exact schema (4 stations, no `impervious_surface_pct` column, official 6-column metadata). It finished, the output passed the validator, and the test target file was never opened. Regional weather features need `data/large/raw/station_inventory.rdb` (local, not in Git); stations missing from it fall back to local weather. Drop `--improved --regional --metadata ... --experiment ...` to run the original V1 model instead.

The pipeline rejects test inputs containing `discharge_cfs`, overlapping train/test dates, duplicate keys, invalid training targets, or missing required columns. The validator requires exactly `station_id,date,discharge_cfs`, the same row count and keys in the same order as test, finite nonnegative values, and UTF-8 CSV. It reopens the actual written file to check it. Predictions are generated by code; never edit them by hand.

The training pipeline does not read `demo_holdout_actuals.csv`. Only the separate final evaluation script reads public holdout truth, after model selection. No external pretrained model is used. Raw StreamStats flow statistics are excluded through an explicit static-characteristic allowlist.

## Data sources and limitations

| Source | Used for | Access |
| --- | --- | --- |
| [USGS NWIS / Water Data APIs](https://api.waterdata.usgs.gov/) | Historical discharge, actual station metadata, latest gauge observations | Public endpoints; live adapter prefers modern OGC API and falls back to legacy NWIS |
| [Open-Meteo historical weather](https://open-meteo.com/en/docs/historical-weather-api) | Daily precipitation, min/max temperature, soil moisture | Keyless noncommercial access, with rate limits |
| [USGS StreamStats Gage Statistics Services](https://www.usgs.gov/streamstats/web-services) | Published basin characteristics and citations | Actual station records; availability varies; missing static fields supplemented by [USGS GAGES-II](https://doi.org/10.5066/P96CPHOT) |
| [Open-Meteo flood API](https://open-meteo.com/en/docs/flood-api) | External daily GloFAS river forecast on the map | Modeled discharge, not a physical gauge reading |
| [Geoapify](https://www.geoapify.com/) / [CARTO](https://carto.com/attributions) | Maps and optional place search | Geoapify free-plan browser key; CARTO fallback |
| [AWS public terrain tiles](https://registry.opendata.aws/terrain-tiles/) | Terrain and scenario elevation grid | Terrarium elevation tiles |
| Esri World Imagery | Optional satellite layer | Public tile endpoint for this prototype; attribution displayed |

Historical weather is reanalysis at a gauge coordinate, not basin-averaged rainfall or an operational future forecast. Some rivers are regulated by reservoirs; model inputs do not capture operations. Basin attributes vary in definition and availability; missing values are imputed using training data only. Static land cover comes from published snapshots. Larger training data does not guarantee accurate flood peaks or transfer to every unseen basin. See `model_card.md` and machine-readable reports for measured performance.

The flood scenario uses **mapped river channels and a terrain-connected rising stage**, with a 193×193 elevation grid. The default window is12×12km (about62m cells);6km and20km windows trade detail for coverage. River polygons/centerlines come from the map's OpenStreetMap vector tiles (Geoapify, or OpenFreeMap without a key). Elevations use bilinear samples of AWS Terrarium tiles. Local robust channel-surface estimates follow river bends and slopes; bank/bridge outliers are suppressed in the channel reference, while floodplain terrain barriers are preserved. A minimax connectivity solver computes the stage required to overtop each terrain saddle, keeping isolated depressions dry until connected.

Water renders as a separate elevated WebGL mesh sharing the terrain depth buffer. Interpolated triangle edges move the shoreline between grid cells, with subtle surface ripples and depth shading. Replay raises stage over a14-second illustrative sequence; pause holds the displayed level, resume continues from it, and reset returns to zero. Playback seconds do not represent physical flood-arrival times. Numeric land area excludes mapped river cells; the interface flags water reaching the window boundary and explicitly labels a point-source fallback if channel geometry cannot load. The map stays centered beside the controls instead of stretching with the forecast panel.

This remains an **exploratory stage scenario**, not a shallow-water/hydrodynamic forecast. DEM resolution, imperfect channel mapping and missing bathymetry/defenses limit accuracy; reservoir operations, levees and drains are not resolved. The reference surface is inferred from terrain, not calibrated to the current gauge datum. A gauge-height reading or discharge forecast is therefore not automatically treated as a rise above the terrain: the former live-sync conversion was removed. Forecast-card rise presets are labeled as assumptions. Terrain and water share1.5× visual relief; reported depths are unexaggerated. The simulation must not guide emergency decisions.

## Project files

Judge-facing results are stored in [`evaluation/README.md`](evaluation/README.md), with the evaluation matrix, metric definitions, actual-versus-predicted charts, every public test prediction, per-station scores, and a two-page PDF. The five-slide presentation is in `presentation/`. These report the measured public experiment, not official hidden-test scores.

[`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md) compares the uploaded brief with measured failure modes and distinguishes completed experiments from remaining data work. [`evaluation/improvement_trials.csv`](evaluation/improvement_trials.csv) records candidate validation metrics, including rejected attempts; compact evidence is retained under `reports/experiments/`. Optional advanced learners require `pip install -r requirements-advanced.txt`.

Area monitoring is implemented through **Draw boundary** on the map and **Area alerts** below the chart. Draw at least three points, finish the polygon, then set a name and height threshold in metres. Simulation alerts require both flood intersection and sufficient simulated water rise. USGS alerts require a linked gauge inside the polygon and a fresh gauge-height observation; gauge height is relative to its datum, not flood depth. Areas persist only in this browser, and alerts run only while the page is open. Geometry/threshold tests and the build pass; full browser verification of the newly added drawing/alert flow remains pending in the handoff.

To rebuild the judge report after training:

```powershell
python -m pip install -r requirements-evaluation.txt
python scripts/create_evaluation_report.py
```

- `solution.py`, `requirements.txt`: reproducible regression training and inference to CSV.
- `scripts/`: download, basin enrichment, final holdout evaluation, and submission validator.
- `predictions.csv`: code-generated public-data output, until replaced using official event data.
- `reports/`: measured validation/holdout results and source provenance.
- `model_card.md`: measured performance, features, limitations.
- `presentation/`: five-slide presentation (generated from final evidence).
- `src/`: React dashboard, actual API adapters, map and terrain simulation.
- `tests/`: CSV/leakage/units and flood-connectivity checks.
- `HANDOFF.md`: current task context, milestones, commands and remaining work.

Large raw downloads, local environment secrets, and serialized models are kept local and excluded from Git. Regenerate them with the commands above. Do not commit the Geoapify key.

## Final submission: install, predict, evaluate, test

Commands run from the repository root. Full steps and expected results: `docs/REPRODUCTION.md`.

```bash
pip install -r requirements.txt                 # core: models, prediction, server, tests
pip install -r requirements-evaluation.txt      # also needed for reports and stress tests
python -m scripts.write_manifest                # checksums for models/
python -m scripts.predict --input test/example_history.csv --output test/example_forecasts.csv
python test/score_check.py                      # FLOODCAST scores: RMSE 46,543 on the test files
python -m scripts.evaluate                      # regenerates reports/ (needs data/augmented_v2, see REPRODUCTION)
python -m unittest discover -s tests            # 29 Python tests
npm test                                        # 42 JavaScript tests
```

Shipped model artifacts: `models/` (see `docs/MODEL_ARTIFACT_INVENTORY.md`). Documentation: `docs/TECHNICAL_REPORT.md`, `docs/MODEL_CARD.md`, `docs/VALIDATION_PROTOCOL.md`, `docs/DATA_DICTIONARY.md`, `docs/data_provenance.md`, `docs/API_INTEGRATION_STATUS.md`, `docs/DEMO_SCRIPT.md`, `docs/TEAM_CONTRIBUTIONS.md`. Results: `reports/validation_summary.md`, `reports/TEST_RESULTS.md`.

## Verification

```powershell
python -m unittest discover -s tests -v
npm test
npm run build
```

The training metrics are validation evidence, not the official normalized leaderboard score. Only organizers can score the hidden event targets. Confirm the target definition with the organizers, regenerate the CSV if official test rows are released, and submit the repo and that output through the event's form yourself.
