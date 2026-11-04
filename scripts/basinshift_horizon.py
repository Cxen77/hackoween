"""BASINSHIFT-style multi-horizon, multi-seed validation (validation only; no test labels).

For a target day t and horizon h, the forecast origin is t-h. Only discharge up to t-h is used.

Models per (horizon, seed, split):
  persistence      : q(t-h)
  weather_only     : weather/attribute features, no discharge history
  residual         : weather + history features; predicts log1p(q_t) - log1p(q_{t-h})
  blend_50         : 0.5 * persistence + 0.5 * residual (weight fixed in advance, not tuned)

Held-out stations change with the seed, so each seed gives a different unseen-station split.

Usage: python -m scripts.basinshift_horizon --horizons 1 3 7 --seeds 42 7 123 --out data/experiments/basinshift_horizon
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import r2_score

from solution import read_input
from scripts.improve_model import improved_features

HIST = ['lag_h', 'lag_h1', 'mean7', 'mean30', 'max7', 'std7']
MODEL_KEYS = ['persistence', 'weather_only', 'residual', 'blend_50']


def history_frame(train: pd.DataFrame, h: int, ffill_limit: int = 0) -> pd.DataFrame:
    """Discharge-history features known at origin t-h, aligned to each (station, date) row.

    ffill_limit > 0 fills ONLY gaps of at most that many days with the last observation (explicit short-gap rule);
    longer gaps stay missing. Default 0 keeps earlier experiments unchanged.
    """
    parts = []
    for sid, g in train.sort_values('date').groupby('station_id'):
        s = g.set_index(pd.to_datetime(g.date))['discharge_cfs'].asfreq('D')
        if ffill_limit:
            s = s.ffill(limit=ffill_limit)
        base = s.shift(h)  # latest value available at origin t-h
        f = pd.DataFrame({
            'lag_h': base,
            'lag_h1': s.shift(h + 1),
            'mean7': base.rolling(7, min_periods=3).mean(),
            'mean30': base.rolling(30, min_periods=10).mean(),
            'max7': base.rolling(7, min_periods=3).max(),
            'std7': base.rolling(7, min_periods=3).std(),
        })
        f['station_id'] = sid
        f['date'] = f.index.strftime('%Y-%m-%d')
        parts.append(f.reset_index(drop=True))
    hist = pd.concat(parts, ignore_index=True)
    keys = train[['station_id', 'date']].copy()
    merged = keys.merge(hist, on=['station_id', 'date'], how='left', validate='one_to_one')
    return merged[HIST].reset_index(drop=True)


def rmse(a, p):
    return float(np.sqrt(np.mean((a - p) ** 2)))


def score(actual: np.ndarray, pred: np.ndarray, station: np.ndarray) -> dict:
    thr = pd.Series(actual).groupby(station).transform(lambda s: s.quantile(0.9)).to_numpy()
    ext = actual >= thr
    return {
        'rmse': rmse(actual, pred),
        'extreme_rmse': rmse(actual[ext], pred[ext]),
        'mae': float(np.mean(np.abs(actual - pred))),
        'r2': float(r2_score(actual, pred)),
    }


def lgbm(seed: int) -> lgb.LGBMRegressor:
    return lgb.LGBMRegressor(n_estimators=600, learning_rate=0.03, num_leaves=63,
                             min_child_samples=40, subsample=0.8, subsample_freq=1,
                             colsample_bytree=0.8, random_state=seed, verbose=-1)


def run_one(train, weather, hist, y, station, lag, fit, val, seed):
    """Return predictions for one split. `lag` is the persistence value for every row."""
    fit_m, val_m = fit, val
    X_w = weather.to_numpy()
    X_h = np.hstack([X_w, hist.to_numpy()])
    lag_fit = lag[fit_m]
    lag_val = lag[val_m]
    y_fit = y[fit_m]

    # weather_only: log target, as in the FLOODCAST champion family.
    m = lgbm(seed).fit(X_w[fit_m], np.log1p(y_fit))
    weather_pred = np.expm1(m.predict(X_w[val_m])).clip(min=0)

    # residual: change from origin discharge, excluding fit rows without it.
    ok = ~np.isnan(lag_fit)
    m = lgbm(seed).fit(X_h[fit_m][ok], np.log1p(y_fit[ok]) - np.log1p(lag_fit[ok]))
    delta = m.predict(X_h[val_m])
    residual = np.expm1(np.log1p(lag_val) + delta).clip(min=0)

    persist = np.where(np.isnan(lag_val), float(np.nanmedian(y_fit)), lag_val)
    residual = np.where(np.isnan(residual), persist, residual)
    blend = 0.5 * persist + 0.5 * residual
    return {'persistence': persist, 'weather_only': weather_pred,
            'residual': residual, 'blend_50': blend}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--metadata', default='data/large/metadata/station_metadata.csv')
    ap.add_argument('--horizons', type=int, nargs='+', default=[1, 3, 7])
    ap.add_argument('--seeds', type=int, nargs='+', default=[42, 7, 123])
    ap.add_argument('--out', default='data/experiments/basinshift_horizon')
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    train = read_input(args.train, True)
    metadata = pd.read_csv(args.metadata, dtype={'station_id': str})
    weather = improved_features(train, metadata).reset_index(drop=True)

    dates = sorted(train.date.unique())
    cutoff = dates[int(len(dates) * 0.8)]
    ids = sorted(train.station_id.unique())
    y = train.discharge_cfs.to_numpy(dtype=float)
    station = train.station_id.to_numpy()
    is_later = (train.date >= cutoff).to_numpy()

    results = []
    for h in args.horizons:
        hist = history_frame(train, h)
        lag = hist['lag_h'].to_numpy(dtype=float)
        for seed in args.seeds:
            held = set(np.random.default_rng(seed).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())
            held_m = np.isin(station, list(held))
            splits = {
                'future_dates': (~is_later, is_later),
                'unseen_station_future_dates': (~is_later & ~held_m, is_later & held_m),
            }
            for name, (fit, val) in splits.items():
                preds = run_one(train, weather, hist, y, station, lag, fit, val, seed)
                entry = {'horizon': h, 'seed': seed, 'split': name, 'rows': int(val.sum())}
                for key in MODEL_KEYS:
                    entry[key] = score(y[val], preds[key], station[val])
                results.append(entry)
                print(h, seed, name, {k: round(entry[k]['rmse']) for k in MODEL_KEYS}, flush=True)
                (out / 'basinshift_horizon_metrics.json').write_text(json.dumps(results, indent=2), encoding='utf-8')

    # Summary: mean RMSE over seeds, and how often blend beats persistence.
    summary = {}
    for h in args.horizons:
        for name in ['future_dates', 'unseen_station_future_dates']:
            rows = [r for r in results if r['horizon'] == h and r['split'] == name]
            key = f'h{h}_{name}'
            summary[key] = {
                m: {'rmse_mean': float(np.mean([r[m]['rmse'] for r in rows])),
                    'extreme_rmse_mean': float(np.mean([r[m]['extreme_rmse'] for r in rows]))}
                for m in MODEL_KEYS}
            summary[key]['blend_beats_persistence_rmse_seeds'] = int(sum(
                r['blend_50']['rmse'] < r['persistence']['rmse'] for r in rows))
            summary[key]['seeds'] = len(rows)
    (out / 'basinshift_horizon_summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
