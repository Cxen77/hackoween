"""Write the model card from actual generated evidence, never hand-entered scores."""
import json
from pathlib import Path

def main():
    load=lambda name:json.loads((Path('reports')/name).read_text(encoding='utf-8'))
    m=load('metrics.json');h=load('demo_holdout.json');d=load('provenance.json');c=load('catchment_provenance.json')
    selected=m['validation'][m['selected_model']]
    rows=[('Training fit (not validation)',m['training_metrics']),
          ('Later-date validation',selected['future_dates']['model']),
          ('Unseen-station + later-date validation',selected['unseen_station_future_dates']['model']),
          ('Separate 2025 public holdout',h['overall']),
          ('Holdout training-station median baseline',h['training_station_median_baseline'])]
    table='\n'.join(f"| {name} | {v['rows']:,} | {v['rmse']:,.2f} | {v['extreme_rmse']:,.2f} | {v['mae']:,.2f} | {v['r2']:.4f} |" for name,v in rows)
    perstation='\n'.join(f"| {sid} | {v['rows']:,} | {v['rmse']:,.2f} | {v['mae']:,.2f} | {v['r2']:.4f} |" for sid,v in h['by_station'].items())
    coverage='\n'.join(f'- `{name}`: {count}/{c["total_stations"]} stations have a mapped StreamStats value.' for name,count in c['coverage_stations'].items())
    text=f'''# FLOODCAST model card

## Identity and intended use

- Model: `{m['selected_model']}`; selected and trained during this project session, not imported as an external pretrained model.
- Implementation: `solution.py`, scikit-learn HistGradientBoosting / ExtraTrees candidates, fixed seed {m['seed']}.
- Intended use: retrospective daily river-discharge regression experiments and producing the exact competition CSV from supplied train/test features.
- Not intended for emergency warnings, evacuation decisions, calibrated inundation forecasts, or claims of reliable peak prediction at every unseen basin.
- Official event data was not supplied. Root `predictions.csv` covers the public experiment only.

## Actual data

Downloaded {len(d['stations'])} stations, {d['period'][0]} through {d['period'][1]}; {m['train_rows']:,} training records and {m['test_rows']:,} held-out public records. Training dates: {m['train_dates'][0]}–{m['train_dates'][1]}; public holdout: {m['test_dates'][0]}–{m['test_dates'][1]}.

Target: actual **USGS daily mean discharge in cfs**, parameter 00060, statistic 00003. This is not an instantaneous daily maximum. The participant brief mixes a peak-daily target description with daily-mean source examples; confirm the official target using event training data.

Weather: Open-Meteo historical reanalysis at actual NWIS gauge coordinates: daily precipitation, min/max temperature, and mean hourly 0–7 cm soil moisture. These are retrospective features, not weather known before the target day. Fixed historical climate model versions were not pinned; cached raw responses are retained to reproduce this run.

Catchments: actual published USGS StreamStats Gage Statistics basin characteristics; NWIS drainage area is retained where StreamStats lacks it. Fields with unknown, incompatible, or ambiguous units remain missing. Source records, variable codes, original units, converted values, and citations are in `reports/catchment_provenance.json`.

{coverage}

## Features and models

Features: {', '.join('`'+f+'`' for f in m['features'])}.

Candidates: raw-target gradient boosting, log-target gradient boosting, raw-target ExtraTrees, drainage-normalized gradient boosting, and drainage-normalized ExtraTrees. Drainage-normalized models learn cfs per square mile and multiply predictions by the known drainage area. Missing/nonpositive drainage uses a median calculated on fitting rows only. Other numeric missing values use training-only median imputation with missingness indicators. Predictions are clipped at zero.

The pipeline does not use station identity as a predictor, any discharge lag or target encoding, StreamStats discharge statistics/quantiles, actual test labels, or data from another team's model. Station IDs are used only to group prior weather and to construct validation splits. Weather windows are closed on the right at the preceding instant (`closed='left'`); current/future rainfall is excluded from antecedent totals.

## Validation and results

Validation cutoff: **{m['validation_cutoff']}**. Temporal fit uses earlier dates; geographic fit additionally excludes entire held-out stations. Geographic validation includes only later dates from those stations. Held-out station IDs: {', '.join(m.get('held_out_stations',[]))}.

Model selection uses the mean of the two validation split scores: 40% overall RMSE ratio, 30% extreme RMSE ratio, 20% MAE ratio, 10% (1-R²) ratio, each relative to the fitting-set median baseline. This is a local selection criterion, **not** the organizers' leaderboard normalization. The final public holdout is evaluated only after selection and refitting on all training rows.

| Evaluation | Rows | RMSE (cfs) | Extreme RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: | ---: |
{table}

Extreme events are the actual top 10% of discharge within each evaluated station, including ties at the 90th percentile. Lower RMSE/MAE is better. Negative R² indicates performance worse than predicting that evaluation group's mean; these failures are retained, not hidden. The earlier five-station experiment used a different period/features and is archived separately; its scores are not directly comparable to this larger run.

### Public holdout by station

| Station | Rows | RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: |
{perstation}

## Known limitations

1. Local weather can poorly represent rainfall across a large catchment. No basin-average rainfall, routed upstream flow, snowpack evolution, or reservoir operations are modeled.
2. Historic weather is reanalysis, so reported accuracy does not establish operational forecast skill. An operational deployment needs forecast-vintage inputs and forecast-error evaluation.
3. Basin coverage is incomplete. Land-cover snapshots and published attributes may postdate early training records and may differ from current conditions; they are treated as allowed static descriptors, not time-correct reconstructions.
4. Station holdout is not a basin-disjoint spatial holdout: upstream/downstream gauges can share a river system. Geography claims should remain limited.
5. Raw public data can include provisional measurements. Negative/missing target sentinel values are excluded; raw quality qualifiers are retained in the cached USGS responses but not fully filtered for every data-quality category.
6. Extreme floods are rare; observed negative per-station R² values and peak errors show the limits of the model. More rows alone do not guarantee accuracy.
7. Station-local Open-Meteo days use civil time; USGS daily reporting can use fixed standard time, creating DST boundary mismatches.
8. The dashboard's GloFAS forecast is an external model, independent of this regression. The 3D connected-bathtub scenario is also independent of discharge predictions; converting discharge to flood depth requires a local rating curve and hydraulic modeling.

## Reproduction and submission checks

```powershell
python -m pip install -r requirements.txt
python scripts/prepare_large.py
python scripts/validate_submission.py --test data/large/test.csv --predictions predictions.csv
```

Official event run:

```powershell
python solution.py --train data/event/train.csv --test data/event/test.csv --output predictions.csv --metrics reports/event_metrics.json
python scripts/validate_submission.py --test data/event/test.csv --predictions predictions.csv
```

The generator preserves leading-zero station IDs, enforces strict future test dates, rejects target-bearing test inputs, and checks exact UTF-8 output columns/order, row/key coverage, finite nonnegative values, and the reopened file. Predictions are produced by running code and must not be edited manually. Only the organizers can calculate official hidden-test and leaderboard scores.
'''
    Path('model_card.md').write_text(text,encoding='utf-8')
    print('Wrote model_card.md from actual measured reports.')

if __name__=='__main__':main()
