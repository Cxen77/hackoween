# FLOODCAST

Predict river discharge from weather and catchment characteristics, then explore observations, model forecasts, and flood scenarios on an interactive 3D map.

**Team name:** FLOODCAST (working project name; confirm before event submission).  
**Members:** Not supplied yet; add actual team members before submitting to organizers.

## Approach

The regression pipeline joins actual USGS daily discharge, Open-Meteo historical weather and soil moisture, and published USGS StreamStats basin characteristics. It compares gradient boosting and ExtraTrees models on raw, log, and drainage-normalized discharge using temporal and unseen-station validation. Features include seasonal terms, rainfall interactions, and strictly preceding 3/7/14/30-day weather windows; discharge targets never enter the input features. The selected model generates a validated, non-negative numerical prediction for every test station/date. The map independently displays latest USGS observations, Open-Meteo/GloFAS river forecasts, and an explicitly labeled elevation-based flood scenario.

## Important submission distinction

The attached brief's official `train.csv` and `test.csv` were not supplied. The root **`predictions.csv` is generated from the downloaded public-data experiment**, not from the organizers' hidden test set. Replace it by running the same code against the actual event files before submission. Never upload the public-data CSV as if it covered the official test rows.

The public target is **USGS daily mean discharge, parameter 00060 / statistic 00003, in cfs**. The brief uses both “peak daily discharge” and daily-mean source examples; confirm the organizers' actual target definition. The supplied training script learns the target from their CSV without substituting public labels.

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
python solution.py --train data/event/train.csv --test data/event/test.csv --output predictions.csv --metrics reports/event_metrics.json --model event_model.joblib
python scripts/validate_submission.py --test data/event/test.csv --predictions predictions.csv
```

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

The flood scenario is a **static connected bathtub approximation**, using a 65×65 elevation grid across 5×5 km. The seed snaps to the lowest elevation cell within approximately 155 m of the selected point to account for gauges located on a riverbank. Water elevation equals that terrain elevation plus the chosen rise. The connected area includes existing low ground and river cells; it is not an estimate of newly flooded property. It excludes hydrodynamics, defenses, channel bathymetry and drainage. Its flood depths cannot be derived from forecast discharge without a local rating curve/hydraulic model. Map relief is exaggerated 1.5×; numeric depths are not. It is a research visualization and must not guide emergency decisions.

## Project files

Judge-facing results are stored in [`evaluation/README.md`](evaluation/README.md), with the evaluation matrix, metric definitions, actual-versus-predicted charts, every public test prediction, per-station scores, and a two-page PDF. The five-slide presentation is in `presentation/`. These report the measured public experiment, not official hidden-test scores.

[`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md) compares the uploaded brief with measured failure modes and prioritizes leakage-safe experiments. It does not claim that those proposed improvements are already trained.

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

## Verification

```powershell
python -m unittest discover -s tests -v
npm test
npm run build
```

The training metrics are validation evidence, not the official normalized leaderboard score. Only organizers can score the hidden event targets. Confirm team details and the target definition, regenerate the CSV on official test rows, and submit the repo and that output through the event's form yourself.
