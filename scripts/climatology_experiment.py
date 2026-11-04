"""Station-climatology features (training-period statistics only) vs the V2 champion. Validation only.

Per-station statistics of log1p(discharge) are computed from FITTING rows only:
  clim_mean_log, clim_q10_log, clim_q90_log, clim_max_log, clim_month_mean_log (station x calendar month)
Leakage controls:
  * fit rows use leave-one-year-out statistics (a row never sees its own year);
  * validation rows use statistics from all fitting rows only;
  * a random share of fit STATIONS has the statistics masked to NaN, so the model learns a fallback and
    unseen stations (all statistics NaN) are still handled;
  * no test target and no validation target ever enters a feature.
Splits and seeds mirror scripts/improve_model.py so numbers compare to the V2 champion.

Usage: python -m scripts.climatology_experiment --out data/experiments/climatology_v1
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from solution import read_input, metrics
from scripts.download_data import parse_rdb
from scripts.improve_model import regional_features

CLIM = ['clim_mean_log', 'clim_q10_log', 'clim_q90_log', 'clim_max_log', 'clim_month_mean_log']


def tables(df: pd.DataFrame):
    """Per-station and per-station-month statistics from the given rows only."""
    z = np.log1p(df.discharge_cfs)
    g = z.groupby(df.station_id)
    st = pd.DataFrame({'clim_mean_log': g.mean(), 'clim_q10_log': g.quantile(.1),
                       'clim_q90_log': g.quantile(.9), 'clim_max_log': g.max()})
    month = pd.to_datetime(df.date).dt.month
    mo = z.groupby([df.station_id, month]).mean().rename('clim_month_mean_log')
    return st, mo


def apply(rows: pd.DataFrame, st: pd.DataFrame, mo: pd.Series) -> pd.DataFrame:
    out = st.reindex(rows.station_id.to_numpy()).reset_index(drop=True)
    idx = pd.MultiIndex.from_arrays([rows.station_id.to_numpy(), pd.to_datetime(rows.date).dt.month.to_numpy()])
    out['clim_month_mean_log'] = mo.reindex(idx).to_numpy()
    return out[CLIM]


def clim_for_fit(fit_rows: pd.DataFrame, mask_frac: float, seed: int) -> pd.DataFrame:
    """Leave-one-year-out statistics for fitting rows, with station-level masking."""
    year = pd.to_datetime(fit_rows.date).dt.year.to_numpy()
    out = pd.DataFrame(np.nan, index=range(len(fit_rows)), columns=CLIM)
    for y in np.unique(year):
        other, here = fit_rows[year != y], year == y
        if other.empty:
            continue
        st, mo = tables(other)
        out.loc[here, CLIM] = apply(fit_rows[here], st, mo).to_numpy()
    stations = sorted(fit_rows.station_id.unique())
    masked = set(np.random.default_rng(seed + 1).choice(stations, size=int(len(stations) * mask_frac), replace=False))
    out.loc[fit_rows.station_id.isin(masked).to_numpy(), CLIM] = np.nan
    return out


def model(seed):
    return lgb.LGBMRegressor(n_estimators=700, learning_rate=0.04, num_leaves=47, min_child_samples=40,
                             subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=seed, verbose=-1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--metadata', default='data/large/metadata/station_metadata.csv')
    ap.add_argument('--inventory', default='data/large/raw/station_inventory.rdb')
    ap.add_argument('--out', default='data/experiments/climatology_v1')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--mask-frac', type=float, default=0.25)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    train = read_input(args.train, True)
    metadata = pd.read_csv(args.metadata, dtype={'station_id': str, 'huc2': str})
    inv = parse_rdb(Path(args.inventory).read_text(encoding='utf-8'))
    inv = inv[inv.agency_cd == 'USGS'].drop_duplicates('site_no')
    metadata['huc2'] = metadata['huc2'].combine_first(metadata.station_id.map(inv.set_index('site_no').huc_cd.str[:2])) \
        if 'huc2' in metadata else metadata.station_id.map(inv.set_index('site_no').huc_cd.str[:2])

    X = regional_features(train, metadata).reset_index(drop=True)
    y = train.discharge_cfs.to_numpy(float)
    dates = sorted(train.date.unique())
    cutoff = dates[int(len(dates) * .8)]
    ids = sorted(train.station_id.unique())
    held = sorted(np.random.default_rng(args.seed).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())
    splits = {'future_dates': (train.date < cutoff, train.date >= cutoff),
              'unseen_station_future_dates': ((train.date < cutoff) & ~train.station_id.isin(held),
                                              (train.date >= cutoff) & train.station_id.isin(held))}
    report = {'cutoff': cutoff, 'held_out_stations': held, 'seed': args.seed, 'mask_frac': args.mask_frac, 'validation': {}}
    for name, (fit, val) in splits.items():
        fit_m, val_m = fit.to_numpy(), val.to_numpy()
        fit_rows, val_rows = train[fit_m].reset_index(drop=True), train[val_m].reset_index(drop=True)
        st, mo = tables(fit_rows)
        Xf = pd.concat([X[fit_m].reset_index(drop=True), clim_for_fit(fit_rows, args.mask_frac, args.seed)], axis=1)
        Xv = pd.concat([X[val_m].reset_index(drop=True), apply(val_rows, st, mo)], axis=1)
        raw = model(args.seed).fit(Xf, y[fit_m]).predict(Xv).clip(min=0)
        log = np.expm1(model(args.seed).fit(Xf, np.log1p(y[fit_m])).predict(Xv)).clip(min=0)
        blend = 0.25 * log + 0.75 * raw  # same weights as the V2 champion
        # Control: identical learner and features WITHOUT the station statistics, to isolate their effect.
        base_cols = list(X.columns)
        c_raw = model(args.seed).fit(Xf[base_cols], y[fit_m]).predict(Xv[base_cols]).clip(min=0)
        c_log = np.expm1(model(args.seed).fit(Xf[base_cols], np.log1p(y[fit_m])).predict(Xv[base_cols])).clip(min=0)
        c_blend = 0.25 * c_log + 0.75 * c_raw
        stations = val_rows.station_id
        report['validation'][name] = {k: metrics(y[val_m], p, stations) for k, p in
                                      {'clim_raw': raw, 'clim_log': log, 'clim_blend_25_75': blend,
                                       'control_raw': c_raw, 'control_log': c_log,
                                       'control_blend_25_75': c_blend}.items()}
        print(name, json.dumps({k: {m: round(v[m]) if m != 'r2' else round(v[m], 4) for m in ('rmse', 'extreme_rmse', 'mae', 'r2')}
                                for k, v in report['validation'][name].items()}, indent=1), flush=True)
        np.savez_compressed(out / f'validation_{name}.npz', raw=raw, log=log, blend=blend)
        (out / 'climatology_metrics.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
