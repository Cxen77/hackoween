"""BASINSHIFT-style 1-day-ahead forecast experiment (validation only; no test labels).

BASINSHIFT permits past observed discharge (up to the forecast origin) as input. This script
tests whether that history improves 1-day-ahead forecasts, and reports exceedance skill.

It does NOT produce FLOODCAST predictions: the FLOODCAST 2025 test has no discharge inputs,
so lag features cannot be used there beyond horizon 1 without recursive prediction.

Validation splits mirror scripts/improve_model.py:
  future_dates                 : later 20% of training dates, all stations
  unseen_station_future_dates  : later 20% dates, 20% of stations never seen in fitting rows
Ablations:
  persistence   : predict yesterday's discharge
  weather_only  : same weather/attribute features, no discharge history (fair baseline)
  with_history  : weather/attribute features + strictly-past discharge lags (BASINSHIFT setting)

Usage: python -m scripts.basinshift_forecast --out data/experiments/basinshift_v1
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import average_precision_score, r2_score

from solution import read_input
from scripts.improve_model import improved_features

HISTORY = ['lag1', 'lag2', 'mean7', 'mean30', 'max7', 'std7']


def add_history(train: pd.DataFrame) -> pd.DataFrame:
    """Strictly-past discharge features per station on a full daily calendar (shift, never same-day)."""
    frames = []
    for sid, g in train.sort_values('date').groupby('station_id'):
        s = g.set_index(pd.to_datetime(g.date))['discharge_cfs'].asfreq('D')
        past = s.shift(1)  # value known at forecast origin t-1 for target at t
        f = pd.DataFrame(index=s.index)
        f['lag1'] = s.shift(1)
        f['lag2'] = s.shift(2)
        f['mean7'] = past.rolling(7, min_periods=3).mean()
        f['mean30'] = past.rolling(30, min_periods=10).mean()
        f['max7'] = past.rolling(7, min_periods=3).max()
        f['std7'] = past.rolling(7, min_periods=3).std()
        f['date'] = f.index.strftime('%Y-%m-%d')
        f['station_id'] = sid
        frames.append(f)
    hist = pd.concat(frames, ignore_index=True)
    out = train.merge(hist, on=['station_id', 'date'], how='left')
    return out


def rmse(a, p):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(p)) ** 2)))


def extreme_mask(df: pd.DataFrame) -> np.ndarray:
    thr = df.groupby('station_id').discharge_cfs.transform(lambda s: s.quantile(0.9))
    return (df.discharge_cfs >= thr).to_numpy()


def score(actual, pred, frame):
    ext = extreme_mask(frame)
    a = np.asarray(actual)
    p = np.asarray(pred)
    return {
        'rmse': rmse(a, p),
        'extreme_rmse': rmse(a[ext], p[ext]),
        'mae': float(np.mean(np.abs(a - p))),
        'r2': float(r2_score(a, p)),
    }


def fit_predict_residual(X_fit, y_fit, lag_fit, X_val, lag_val, seed):
    """Predict the change from yesterday's flow in log space.

    Target: log1p(q_t) - log1p(q_{t-1}). Rows without yesterday's flow are excluded from fitting;
    at prediction, rows without it fall back to the persistence value (their lag is the fallback).
    """
    ok = ~np.isnan(lag_fit)
    target = np.log1p(y_fit[ok]) - np.log1p(lag_fit[ok])
    model = lgb.LGBMRegressor(
        n_estimators=600, learning_rate=0.03, num_leaves=63, min_child_samples=40,
        subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=seed, verbose=-1)
    model.fit(X_fit[ok], target)
    delta = model.predict(X_val)
    pred = np.expm1(np.log1p(lag_val) + delta).clip(min=0)
    return np.where(np.isnan(lag_val), np.nan, pred)


def fit_predict(X_fit, y_fit, X_val, seed):
    model = lgb.LGBMRegressor(
        n_estimators=600, learning_rate=0.03, num_leaves=63, min_child_samples=40,
        subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=seed, verbose=-1)
    model.fit(X_fit, np.log1p(y_fit))
    return np.expm1(model.predict(X_val)).clip(min=0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--metadata', default='data/large/metadata/station_metadata.csv')
    ap.add_argument('--out', default='data/experiments/basinshift_v1')
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    train = read_input(args.train, True)
    metadata = pd.read_csv(args.metadata, dtype={'station_id': str})
    dates = sorted(train.date.unique())
    cutoff = dates[int(len(dates) * 0.8)]
    ids = sorted(train.station_id.unique())
    held = sorted(np.random.default_rng(args.seed).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())

    # Weather/attribute features (same engineering as the FLOODCAST champion pipeline).
    weather = improved_features(train, metadata)
    frame = add_history(train)
    weather_cols = list(weather.columns)
    X_w = weather.copy()
    X_h = pd.concat([weather.reset_index(drop=True), frame[HISTORY].reset_index(drop=True)], axis=1)

    splits = {
        'future_dates': (train.date < cutoff, train.date >= cutoff),
        'unseen_station_future_dates': (
            (train.date < cutoff) & ~train.station_id.isin(held),
            (train.date >= cutoff) & train.station_id.isin(held)),
    }

    report = {'cutoff': cutoff, 'held_out_stations': held, 'seed': args.seed, 'validation': {}}
    for name, (fit, val) in splits.items():
        fit_m, val_m = fit.to_numpy(), val.to_numpy()
        val_frame = train.loc[val].reset_index(drop=True)
        y_fit = train.loc[fit, 'discharge_cfs'].to_numpy()
        y_val = train.loc[val, 'discharge_cfs'].to_numpy()

        # Persistence: yesterday's discharge; fall back to station median if missing.
        # Held-out stations have no fitting rows, so fall back to the global fitting median.
        persist = frame.loc[val, 'lag1'].fillna(float(train.loc[fit, 'discharge_cfs'].median())).to_numpy()

        weather_only = fit_predict(X_w[fit_m], y_fit, X_w[val_m], args.seed)
        with_hist = fit_predict(X_h[fit_m], y_fit, X_h[val_m], args.seed)

        lag_fit = frame.loc[fit, 'lag1'].to_numpy(dtype=float)
        lag_val = frame.loc[val, 'lag1'].to_numpy(dtype=float)
        residual = fit_predict_residual(X_h[fit_m], y_fit, lag_fit, X_h[val_m], lag_val, args.seed)
        # Rows lacking yesterday's flow use persistence fallback (same as the persistence baseline).
        residual = np.where(np.isnan(residual), persist, residual)

        report['validation'][name] = {
            'persistence': score(y_val, persist, val_frame),
            'weather_only': score(y_val, weather_only, val_frame),
            'with_history': score(y_val, with_hist, val_frame),
            'residual_history': score(y_val, residual, val_frame),
            'blend_persistence_residual': score(y_val, 0.5 * persist + 0.5 * residual, val_frame),
            'rows': int(val.sum()),
        }
        print(name, json.dumps(report['validation'][name], indent=1), flush=True)

    (out / 'basinshift_metrics.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('wrote', out / 'basinshift_metrics.json')


if __name__ == '__main__':
    main()
