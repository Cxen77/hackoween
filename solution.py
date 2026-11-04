"""FLOODCAST: train on observed targets, validate by time/station, generate exact CSV output."""
from __future__ import annotations
import argparse
import json
import shutil
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline

FEATURES = ['precipitation_mm', 'temp_max_c', 'temp_min_c', 'soil_moisture',
            'drainage_area_sqmi', 'mean_elevation_ft', 'slope_pct', 'forest_cover_pct']
KEYS = ['station_id', 'date']

def read_input(path, target=False):
    frame = pd.read_csv(path, dtype={'station_id': str})
    required = KEYS + FEATURES + (['discharge_cfs'] if target else [])
    missing = set(required) - set(frame)
    if missing:
        raise ValueError(f'{path}: missing columns {sorted(missing)}')
    if frame.empty or frame[KEYS].isna().any().any() or frame.duplicated(KEYS).any():
        raise ValueError(f'{path}: empty input, null keys, or duplicate station/date pairs')
    frame['date'] = pd.to_datetime(frame.date, errors='raise').dt.strftime('%Y-%m-%d')
    if frame.duplicated(KEYS).any():
        raise ValueError('Dates normalize to duplicate station/date pairs')
    for col in FEATURES:
        frame[col] = pd.to_numeric(frame[col], errors='raise').replace([np.inf, -np.inf], np.nan)
    if 'impervious_surface_pct' in frame:
        frame['impervious_surface_pct'] = pd.to_numeric(frame.impervious_surface_pct,errors='raise').replace([np.inf,-np.inf],np.nan)
    if target:
        y = pd.to_numeric(frame.discharge_cfs, errors='raise')
        if not np.isfinite(y).all() or (y < 0).any():
            raise ValueError('Training targets must be finite and non-negative')
        frame['discharge_cfs'] = y
    return frame

def features(frame, history=None):
    """No station labels, target lags, target encodings, or statistics across the test boundary."""
    x = frame[FEATURES].copy()
    x['impervious_surface_pct'] = frame['impervious_surface_pct'] if 'impervious_surface_pct' in frame else np.nan
    date = pd.to_datetime(frame.date)
    angle = 2 * np.pi * date.dt.dayofyear / 365.25
    x['season_sin'] = np.sin(angle)
    x['season_cos'] = np.cos(angle)
    x['temperature_range'] = x.temp_max_c - x.temp_min_c
    x['temperature_mean'] = (x.temp_max_c + x.temp_min_c) / 2
    x['rain_soil_interaction'] = x.precipitation_mm * x.soil_moisture
    x['rain_drainage_interaction'] = x.precipitation_mm * np.log1p(x.drainage_area_sqmi.clip(lower=0))
    x['rain_squared'] = x.precipitation_mm.clip(lower=0) ** 2
    x['log_drainage_area'] = np.log1p(x.drainage_area_sqmi.clip(lower=0))
    x['freezing_precipitation'] = x.precipitation_mm * (x.temperature_mean < 0)
    # Weather-only antecedent rainfall. Never read discharge from frame or history.
    current=frame[KEYS+FEATURES].copy();current['_row']=np.arange(len(current))
    if history is not None:
        past=history[KEYS+FEATURES].copy();past['_row']=-1
        current=pd.concat([past,current],ignore_index=True)
    current['date']=pd.to_datetime(current.date)
    current=current.sort_values(['station_id','date'])
    for days in [3,7,14,30]:
        accumulated=[]
        for _,group in current.groupby('station_id',sort=False):
            series=pd.Series(group.precipitation_mm.to_numpy(),index=pd.DatetimeIndex(group.date))
            values=series.rolling(f'{days}D',closed='left',min_periods=1).sum().to_numpy()
            accumulated.append(pd.DataFrame({'_row':group['_row'].to_numpy(),'value':values}))
        values=pd.concat(accumulated,ignore_index=True)
        x[f'rain_previous_{days}d']=values[values._row>=0].sort_values('_row').value.to_numpy()
    return x.replace([np.inf, -np.inf], np.nan)

def metrics(actual, predicted, stations):
    frame = pd.DataFrame({'actual': np.asarray(actual), 'prediction': predicted, 'station': np.asarray(stations)})
    threshold = frame.groupby('station').actual.transform(lambda s: s.quantile(.9))
    extreme = frame.actual >= threshold
    return {'rmse': float(np.sqrt(mean_squared_error(actual, predicted))),
            'extreme_rmse': float(np.sqrt(mean_squared_error(frame.loc[extreme, 'actual'], frame.loc[extreme, 'prediction']))),
            'mae': float(mean_absolute_error(actual, predicted)), 'r2': float(r2_score(actual, predicted)),
            'rows': len(frame), 'extreme_rows': int(extreme.sum())}

def build_model(kind, seed):
    regressor = (ExtraTreesRegressor(n_estimators=160, min_samples_leaf=5, max_features=.9, max_depth=24,
                                    random_state=seed, n_jobs=-1)
                 if kind.startswith('extra_trees') else
                 HistGradientBoostingRegressor(max_iter=250, learning_rate=.065, max_leaf_nodes=23,
                                               l2_regularization=8, early_stopping=False, random_state=seed))
    return make_pipeline(SimpleImputer(strategy='median', add_indicator=True, keep_empty_features=True), regressor)

def scale_for(frame, kind, fallback):
    if not kind.endswith('_specific'):
        return np.ones(len(frame))
    return frame.drainage_area_sqmi.where(frame.drainage_area_sqmi > 0).fillna(fallback).to_numpy()

def validate_output(test, output):
    if output.columns.tolist() != ['station_id', 'date', 'discharge_cfs']:
        raise ValueError('Incorrect output column names/order')
    if len(test) != len(output) or not output[KEYS].reset_index(drop=True).equals(test[KEYS].reset_index(drop=True)):
        raise ValueError('Output must preserve every test key and its order exactly')
    if not np.isfinite(output.discharge_cfs).all() or (output.discharge_cfs < 0).any():
        raise ValueError('Invalid discharge prediction')

def run_improved(args):
    from scripts.improve_model import run as improve
    improve(args)
    dest=Path(args.output);dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(Path(args.experiment)/'predictions.csv',dest)
    Path(args.metrics).parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(Path(args.experiment)/'metrics.json',args.metrics)
    if args.model:shutil.copyfile(Path(args.experiment)/'model.joblib',args.model)

def run(args):
    train, test = read_input(args.train, True), read_input(args.test)
    if 'discharge_cfs' in test:
        raise ValueError('test.csv contains target column; supply test features only')
    if pd.to_datetime(test.date).min() <= pd.to_datetime(train.date).max():
        raise ValueError('All test dates must be strictly after all training dates')
    dates = sorted(train.date.unique())
    if len(dates) < 30:
        raise ValueError('At least 30 training dates are required for meaningful time validation')
    cutoff = dates[int(len(dates) * .8)]
    station_ids = sorted(train.station_id.unique())
    split = []
    # Time holdout measures forecasting; station+time holdout measures geographic transfer.
    split.append(('future_dates', train.date < cutoff, train.date >= cutoff))
    if len(station_ids) > 1:
        held_out = ([station_ids[-1]] if len(station_ids)<10 else
                    sorted(np.random.default_rng(args.seed).choice(station_ids,size=max(2,len(station_ids)//5),replace=False).tolist()))
        split.append(('unseen_station_future_dates', (train.date < cutoff) & ~train.station_id.isin(held_out),
                      (train.date >= cutoff) & train.station_id.isin(held_out)))
    X, y = features(train), train.discharge_cfs.to_numpy()
    reports = {}; candidates = ['hist_raw', 'hist_log', 'extra_trees', 'hist_specific', 'extra_trees_specific']
    for kind in candidates:
        reports[kind] = {}
        for name, fit, val in split:
            if fit.sum() < 20 or val.sum() < 2:
                raise ValueError(f'Not enough rows for {name}')
            model = build_model(kind, args.seed)
            fallback = train.loc[fit, 'drainage_area_sqmi'].where(lambda s:s>0).median()
            fallback = float(fallback) if np.isfinite(fallback) else 1.
            fit_scale = scale_for(train.loc[fit], kind, fallback)
            val_scale = scale_for(train.loc[val], kind, fallback)
            model.fit(X.loc[fit], np.log1p(y[fit]) if kind == 'hist_log' else y[fit]/fit_scale)
            raw = model.predict(X.loc[val])
            pred = np.maximum(0, np.expm1(raw) if kind == 'hist_log' else raw*val_scale)
            baseline = np.full(val.sum(), float(np.median(y[fit])))
            reports[kind][name] = {'model': metrics(y[val], pred, train.loc[val, 'station_id']),
                                  'median_baseline': metrics(y[val], baseline, train.loc[val, 'station_id'])}
        print(kind, json.dumps(reports[kind]), flush=True)
    def selection_score(kind):
        scores=[]
        for result in reports[kind].values():
            m, b = result['model'], result['median_baseline']
            scores.append(.4*m['rmse']/max(b['rmse'], 1e-9) + .3*m['extreme_rmse']/max(b['extreme_rmse'], 1e-9)
                          + .2*m['mae']/max(b['mae'], 1e-9) + .1*(1-m['r2'])/max(1-b['r2'], 1e-9))
        return float(np.mean(scores))
    best = min(candidates, key=selection_score)
    model = build_model(best, args.seed)
    fallback = train.drainage_area_sqmi.where(lambda s:s>0).median()
    fallback = float(fallback) if np.isfinite(fallback) else 1.
    model.fit(X, np.log1p(y) if best == 'hist_log' else y/scale_for(train,best,fallback))
    train_raw = model.predict(X)
    train_pred = np.maximum(0, np.expm1(train_raw) if best == 'hist_log' else train_raw*scale_for(train,best,fallback))
    history=train[pd.to_datetime(train.date)>=pd.to_datetime(test.date).min()-pd.Timedelta(days=30)]
    raw = model.predict(features(test,history=history))
    pred = np.maximum(0, np.expm1(raw) if best == 'hist_log' else raw*scale_for(test,best,fallback))
    output = test[KEYS].copy(); output['discharge_cfs'] = pred
    validate_output(test, output)
    dest = Path(args.output); dest.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(dest, index=False, encoding='utf-8', float_format='%.6f')
    validate_output(test, pd.read_csv(dest, dtype={'station_id': str}))
    report = {'selected_model': best, 'validation_cutoff': cutoff, 'held_out_stations': held_out if len(station_ids)>1 else [],
              'selection_note': 'Equal average across time and unseen-station splits; weighted error ratios to a training-median baseline. Not the official leaderboard normalization.',
              'features': X.columns.tolist(), 'train_rows':len(train), 'test_rows':len(test),
              'train_dates':[train.date.min(),train.date.max()], 'test_dates':[test.date.min(),test.date.max()],
              'seed':args.seed, 'training_metrics':metrics(y,train_pred,train.station_id), 'validation':reports}
    Path(args.metrics).parent.mkdir(parents=True, exist_ok=True)
    Path(args.metrics).write_text(json.dumps(report, indent=2), encoding='utf-8')
    if args.model:
        joblib.dump({'pipeline':model, 'target_log':best=='hist_log', 'target_specific':best.endswith('_specific'),
                     'drainage_fallback':fallback,'features':X.columns.tolist()}, args.model)
    print(f'Selected {best}; wrote {len(output)} validated predictions to {dest}', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train', default='data/train.csv'); parser.add_argument('--test', default='data/test.csv')
    parser.add_argument('--output', default='predictions.csv'); parser.add_argument('--metrics', default='reports/metrics.json')
    parser.add_argument('--model'); parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--improved',action='store_true',help='Run validation-selected v2 peak-aware/enriched models and ensembles')
    parser.add_argument('--metadata',default='data/large/metadata/station_metadata.csv')
    parser.add_argument('--experiment',default='data/experiments/v2')
    parser.add_argument('--regional',action='store_true',help='Add cached weather-point regional proxies from USGS HUC regions')
    parser.add_argument('--inventory',default='data/large/raw/station_inventory.rdb')
    parser.add_argument('--validation-cache')
    parser.add_argument('--optimize-ensemble',action='store_true')
    parser.add_argument('--minimax-ensemble',action='store_true')
    parser.add_argument('--upstream',action='store_true')
    parser.add_argument('--skip-pair-grid',action='store_true')
    parser.add_argument('--advanced',action='store_true',help='Test optional LightGBM/CatBoost candidates; install requirements-advanced.txt')
    parser.add_argument('--incumbent-gate',action='store_true',help='Require improvement over the sealed cached champion')
    args=parser.parse_args()
    if args.improved:
        run_improved(args)
    else:run(args)
