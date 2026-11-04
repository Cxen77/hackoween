"""BASINSHIFT-style system: multi-horizon forecasts + exceedance probabilities + calibrated intervals.

Per horizon h in {1,3,7}, with forecast origin t-h (only discharge up to t-h is used):
  point forecast : 0.5 * persistence + 0.5 * exp(log1p(q_{t-h}) + predicted log-change)    (LightGBM, L2)
  quantiles      : 5/25/50/75/95% of the log-change (LightGBM quantile); 90% interval = 5%-95% widened by
                   split-conformal on a calibration slice; CRPS approximated from the 5 quantiles (pinball)
  probabilities  : P(q_t > T90) and P(q_t > T99): LightGBM classifiers + isotonic calibration on the same slice
Thresholds T90/T99 are per-catchment quantiles of a REFERENCE period only (strictly before any test date).
Missing history rule: gaps <= 7 days are filled with the last observation; if history is still missing the system
falls back to the weather-only GBM point forecast and the training base rate (no interval, flagged).
Baselines: persistence, seasonal climatology (station-month median of reference period), weather-only GBM.
Data are cleaned first (scripts/clean_data.py). LightGBM handles missing feature values natively.

Experiments:
  heldout : fit on our stations, test on 20% held-out OUR stations, dates >= 2022-01-01 (reference < 2022)
  caravan : fit on all our stations (<= 2024), test on Caravan US basins 2010-2020 (reference < 2010). No Caravan fit.

Usage: python -m scripts.basinshift_model --experiment heldout --out data/experiments/basinshift_model
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score

from solution import features, read_input
from scripts.basinshift_horizon import history_frame
from scripts.clean_data import clean_frame

HORIZONS = [1, 3, 7]
QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95]
FFILL_DAYS = 7
P = dict(n_estimators=300, learning_rate=0.06, num_leaves=63, min_child_samples=60, subsample=0.8, subsample_freq=1,
         colsample_bytree=0.8, verbose=-1, n_jobs=-1)


def thresholds(frame: pd.DataFrame, ref_mask: np.ndarray) -> pd.DataFrame:
    t = frame[ref_mask].groupby('station_id').discharge_cfs.quantile([0.9, 0.99]).unstack()
    t.columns = ['T90', 'T99']
    return frame[['station_id']].join(t, on='station_id')[['T90', 'T99']]


def clim_forecast(frame: pd.DataFrame, ref_mask: np.ndarray) -> np.ndarray:
    ref = frame[ref_mask]
    med = ref.groupby([ref.station_id, pd.to_datetime(ref.date).dt.month]).discharge_cfs.median()
    idx = pd.MultiIndex.from_arrays([frame.station_id.to_numpy(), pd.to_datetime(frame.date).dt.month.to_numpy()])
    return med.reindex(idx).to_numpy()


def build(frame, ref_cut, h, hist_frame=None, weather_frame=None, delay=0, thr_override=None):
    """Features at horizon h. hist_frame/weather_frame may be perturbed copies (stress tests); thresholds always
    come from the unperturbed reference period of `frame`."""
    W = features(weather_frame if weather_frame is not None else frame).reset_index(drop=True)
    thr = (thr_override if thr_override is not None else thresholds(frame, (frame.date < ref_cut).to_numpy())).reset_index(drop=True)
    X = W.copy()
    X['L_thr90'], X['L_thr99'] = np.log1p(thr.T90), np.log1p(thr.T99)
    if h is None:
        return X, thr, None
    H = history_frame(hist_frame if hist_frame is not None else frame, h + delay, ffill_limit=FFILL_DAYS)
    lag = H['lag_h'].to_numpy(float)
    X['L_lag'], X['L_lag1'] = np.log1p(H.lag_h), np.log1p(H.lag_h1)
    X['L_mean7'], X['L_mean30'], X['L_max7'] = np.log1p(H.mean7), np.log1p(H.mean30), np.log1p(H.max7)
    X['cv7'] = H.std7 / (H.mean7 + 1)
    X['trend'] = X.L_lag - X.L_mean30
    X['rel90'], X['rel_mean7_90'], X['rel_max7_99'] = X.L_lag - X.L_thr90, X.L_mean7 - X.L_thr90, X.L_max7 - X.L_thr99
    return X, thr, lag


def fit_bundle(fit_df, fit_ref_cut, cal_start, fit_end):
    """Train every head. Returns a dict bundle (also what gets saved)."""
    y = fit_df.discharge_cfs.to_numpy(float)
    in_train = (fit_df.date < cal_start).to_numpy()
    in_cal = ((fit_df.date >= cal_start) & (fit_df.date < fit_end)).to_numpy()
    X0, _, _ = build(fit_df, fit_ref_cut, None)
    bundle = {'weather_only': lgb.LGBMRegressor(**P).fit(X0[in_train], np.log1p(y[in_train])),
              'weather_cols': list(X0.columns), 'horizons': {}}
    for h in HORIZONS:
        X, thr, lag = build(fit_df, fit_ref_cut, h)
        ok = ~np.isnan(lag) & ~np.isnan(thr.T90.to_numpy())
        r = np.log1p(y) - np.log1p(lag)
        tr, ca = in_train & ok, in_cal & ok
        b = {'cols': list(X.columns), 'mean': lgb.LGBMRegressor(**P).fit(X[tr], r[tr])}
        b['q'] = {q: lgb.LGBMRegressor(objective='quantile', alpha=q, **P).fit(X[tr], r[tr]) for q in QUANTILES}
        lo_c, hi_c = b['q'][0.05].predict(X[ca]), b['q'][0.95].predict(X[ca])
        score = np.maximum(lo_c - r[ca], r[ca] - hi_c)
        b['conformal_k'] = float(np.quantile(score, min(1.0, 0.9 * (1 + 1 / len(score)))))
        for name, col in [('90', 'T90'), ('99', 'T99')]:
            lab = (y > thr[col].to_numpy()).astype(int)
            clf = lgb.LGBMClassifier(**P).fit(X[tr], lab[tr])
            b[f'clf{name}'] = clf
            b[f'iso{name}'] = IsotonicRegression(out_of_bounds='clip', y_min=0, y_max=1).fit(clf.predict_proba(X[ca])[:, 1], lab[ca])
            b[f'base{name}'] = float(lab[tr].mean())
        bundle['horizons'][h] = b
        print(f'  trained horizon {h}: train rows {int(tr.sum()):,}, calibration rows {int(ca.sum()):,}, conformal k={b["conformal_k"]:.3f}', flush=True)
    return bundle


def forecast(bundle, frame, ref_cut, h, hist_frame=None, weather_frame=None, delay=0, thr_override=None):
    """All outputs for every row of `frame` (sorted by station,date). NaN where thresholds are unavailable."""
    b = bundle['horizons'][h]
    X, thr, lag = build(frame, ref_cut, h, hist_frame, weather_frame, delay, thr_override)
    Xw, _, _ = build(frame, ref_cut, None, weather_frame=weather_frame, thr_override=thr_override)
    wo = np.expm1(bundle['weather_only'].predict(Xw[bundle['weather_cols']]))
    fallback = np.isnan(lag)
    Xp = X[b['cols']]
    lag_safe = np.where(fallback, 0.0, lag)
    Ll = np.log1p(lag_safe)
    resid = np.expm1(Ll + b['mean'].predict(Xp))
    point = np.where(fallback, wo, 0.5 * lag_safe + 0.5 * resid)
    qs = np.sort(np.column_stack([b['q'][q].predict(Xp) for q in QUANTILES]), axis=1)
    quant = np.expm1(Ll[:, None] + qs).clip(min=0)
    k = b['conformal_k']
    lo, hi = np.expm1(Ll + qs[:, 0] - k).clip(min=0), np.expm1(Ll + qs[:, -1] + k)
    out = {'point': point, 'persistence': lag, 'weather_only': wo, 'lo': np.where(fallback, np.nan, lo),
           'hi': np.where(fallback, np.nan, hi), 'quantiles': np.where(fallback[:, None], np.nan, quant),
           'fallback': fallback, 'thr': thr}
    for name in ('90', '99'):
        p = b[f'iso{name}'].predict(b[f'clf{name}'].predict_proba(Xp)[:, 1])
        out[f'p{name}'] = np.where(fallback, b[f'base{name}'], p)
    return out


# ------------------------------------------------------------------ metrics
def ece_and_bins(p, y, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    table = [{'bin': b, 'mean_prob': float(p[idx == b].mean()), 'obs_freq': float(y[idx == b].mean()), 'count': int((idx == b).sum())}
             for b in range(bins) if (idx == b).any()]
    return float(sum(abs(t['mean_prob'] - t['obs_freq']) * t['count'] for t in table) / len(p)), table


def event_metrics(p, y, base_rate, stations):
    if y.sum() == 0:
        return {'events': 0}
    n = len(p)
    k = max(1, int(0.05 * n))
    top = np.argsort(-p, kind='stable')[:k]
    brier = float(np.mean((p - y) ** 2))
    e, table = ece_and_bins(p, y)
    basin_years = max(1.0, n / 365.25)
    return {'events': int(y.sum()), 'rows': int(n), 'event_rate': float(y.mean()), 'auprc': float(average_precision_score(y, p)),
            'recall_at_5pct_alert_budget': float(y[top].sum() / y.sum()), 'precision_at_5pct_alert_budget': float(y[top].mean()),
            'false_alarms_per_basin_year_at_5pct_budget': float((k - y[top].sum()) / basin_years * len(np.unique(stations))),
            'brier': brier, 'brier_skill_vs_base_rate': float(1 - brier / np.mean((base_rate - y) ** 2)), 'ece': e, 'reliability': table}


def basin_table(y, p, stations):
    d = pd.DataFrame({'s': stations, 'y': y, 'p': p})
    g = d.groupby('s')
    return pd.DataFrame({'n': g.size(), 'sse': g.apply(lambda x: ((x.y - x.p) ** 2).sum(), include_groups=False),
                         'nse': g.apply(lambda x: 1 - ((x.y - x.p) ** 2).sum() / max(((x.y - x.y.mean()) ** 2).sum(), 1e-9), include_groups=False)})


def point_metrics(y, p, stations):
    ext = y >= pd.Series(y).groupby(stations).transform(lambda s: s.quantile(0.9)).to_numpy()
    bt = basin_table(y, p, stations)
    return {'rmse': float(np.sqrt(np.mean((y - p) ** 2))), 'extreme_rmse': float(np.sqrt(np.mean((y[ext] - p[ext]) ** 2))),
            'mae': float(np.mean(np.abs(y - p))), 'median_basin_nse': float(bt.nse.median()), 'mean_basin_nse': float(bt.nse.mean()),
            'nse_iqr': [float(bt.nse.quantile(0.25)), float(bt.nse.quantile(0.75))], 'share_basins_nse_gt0': float((bt.nse > 0).mean()),
            'basins': int(len(bt))}


def crps_from_quantiles(y, quant):
    loss = 0.0
    for j, q in enumerate(QUANTILES):
        diff = y - quant[:, j]
        loss += np.mean(np.maximum(q * diff, (q - 1) * diff))
    return float(2 * loss / len(QUANTILES))


def bootstrap_ratio(y, p_model, p_base, stations, n=300, seed=0):
    bm, bb = basin_table(y, p_model, stations), basin_table(y, p_base, stations)
    rng = np.random.default_rng(seed)
    idx = np.arange(len(bm))
    ratios, dn = [], []
    for _ in range(n):
        s = rng.choice(idx, size=len(idx), replace=True)
        ratios.append(np.sqrt(bm.sse.to_numpy()[s].sum() / bb.sse.to_numpy()[s].sum()))
        dn.append(np.median(bm.nse.to_numpy()[s]) - np.median(bb.nse.to_numpy()[s]))
    return {'rmse_ratio_model_over_persistence_ci95': [float(np.quantile(ratios, 0.025)), float(np.quantile(ratios, 0.975))],
            'median_nse_gain_ci95': [float(np.quantile(dn, 0.025)), float(np.quantile(dn, 0.975))]}


def evaluate(out, frame, y, mask, bundle_h, area, include_baselines=True, clim=None):
    """Metrics dict for the rows in `mask`."""
    m = mask
    yt, st = y[m], frame.station_id.to_numpy()[m]
    rep = {'rows_scored': int(m.sum()), 'fallback_rows': int(out['fallback'][m].sum()),
           'forecast': {'basinshift_blend': point_metrics(yt, out['point'][m], st)}}
    if include_baselines:
        rep['forecast']['persistence'] = point_metrics(yt, np.where(np.isnan(out['persistence'][m]), out['weather_only'][m], out['persistence'][m]), st)
        rep['forecast']['weather_only_gbm'] = point_metrics(yt, out['weather_only'][m], st)
        if clim is not None:
            rep['forecast']['seasonal_climatology'] = point_metrics(yt, clim[m], st)
        rep['bootstrap_vs_persistence'] = bootstrap_ratio(yt, out['point'][m], rep_pers(out, m), st)
    cov = ~out['fallback'][m]
    if cov.any():
        lo, hi = out['lo'][m][cov], out['hi'][m][cov]
        rep['interval_90'] = {'coverage': float(np.mean((yt[cov] >= lo) & (yt[cov] <= hi))), 'median_width_cfs': float(np.median(hi - lo)),
                              'rows': int(cov.sum()), 'crps_approx_cfs': crps_from_quantiles(yt[cov], out['quantiles'][m][cov]),
                              'persistence_mae_for_reference': float(np.mean(np.abs(yt[cov] - out['persistence'][m][cov])))}
    rep['events'] = {}
    thr = out['thr']
    for name, col, key, base in [('high_flow_q90', 'T90', 'p90', None), ('extreme_flow_q99', 'T99', 'p99', None)]:
        t = thr[col].to_numpy()[m]
        lab = (yt > t).astype(int)
        base_rate = float(np.mean(lab)) if False else (0.10 if col == 'T90' else 0.01)
        pers_ind = np.where(np.isnan(out['persistence'][m]), 0.0, (out['persistence'][m] > t).astype(float))
        rep['events'][name] = {'model': event_metrics(out[key][m], lab, base_rate, st),
                               'persistence_indicator': event_metrics(pers_ind, lab, base_rate, st)}
    # Breakdown by catchment size (terciles of drainage area).
    a = area[m]
    edges = np.quantile(np.unique(a), [1 / 3, 2 / 3])
    rep['by_catchment_size'] = {}
    for label, sel in [('small', a <= edges[0]), ('medium', (a > edges[0]) & (a <= edges[1])), ('large', a > edges[1])]:
        if sel.sum() > 50:
            rep['by_catchment_size'][label] = {'blend': point_metrics(yt[sel], out['point'][m][sel], st[sel]),
                                               'persistence': point_metrics(yt[sel], np.where(np.isnan(out['persistence'][m][sel]), out['weather_only'][m][sel], out['persistence'][m][sel]), st[sel])}
    return rep


def rep_pers(out, m):
    return np.where(np.isnan(out['persistence'][m]), out['weather_only'][m], out['persistence'][m])


def run(fit_df, test_df, fit_ref_cut, cal_start, fit_end, test_ref_cut, test_start, test_end, label, out_dir):
    fit_df = fit_df.sort_values(['station_id', 'date']).reset_index(drop=True)
    test_df = test_df.sort_values(['station_id', 'date']).reset_index(drop=True)
    print(f'[{label}] training heads on {len(fit_df):,} rows / {fit_df.station_id.nunique()} stations', flush=True)
    bundle = fit_bundle(fit_df, fit_ref_cut, cal_start, fit_end)
    joblib.dump({'bundle': bundle, 'fit_ref_cut': fit_ref_cut, 'test_ref_cut': test_ref_cut}, out_dir / f'models_{label}.joblib')
    in_test = ((test_df.date >= test_start) & (test_df.date <= test_end)).to_numpy()
    y = test_df.discharge_cfs.to_numpy(float)
    area = test_df.drainage_area_sqmi.to_numpy(float)
    clim = clim_forecast(test_df, (test_df.date < test_ref_cut).to_numpy())
    results = {'label': label, 'test_rows': int(in_test.sum()), 'test_stations': int(test_df[in_test].station_id.nunique()), 'horizons': {}}
    for h in HORIZONS:
        o = forecast(bundle, test_df, test_ref_cut, h)
        mask = in_test & ~np.isnan(o['thr'].T90.to_numpy()) & ~np.isnan(clim)
        rep = evaluate(o, test_df, y, mask, bundle['horizons'][h], area, True, clim)
        results['horizons'][str(h)] = rep
        f = rep['forecast']
        print(f"[{label}] h={h} rows={rep['rows_scored']:,} RMSE blend {f['basinshift_blend']['rmse']:,.0f} persist {f['persistence']['rmse']:,.0f} "
              f"clim {f['seasonal_climatology']['rmse']:,.0f} wx {f['weather_only_gbm']['rmse']:,.0f} | median NSE blend "
              f"{f['basinshift_blend']['median_basin_nse']:.3f} persist {f['persistence']['median_basin_nse']:.3f} | 90% cov "
              f"{rep['interval_90']['coverage']:.3f} | q90 AUPRC {rep['events']['high_flow_q90']['model'].get('auprc', float('nan')):.3f}", flush=True)
        (out_dir / f'basinshift_{label}.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    return results


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--experiment', choices=['heldout', 'caravan'], required=True)
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--caravan', default='data/external/caravan/Caravan')
    ap.add_argument('--out', default='data/experiments/basinshift_model')
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    ours, rep = clean_frame(read_input(args.train, True), target=True)
    (out / 'data_quality_train.json').write_text(json.dumps(rep, indent=2), encoding='utf-8')
    if args.experiment == 'heldout':
        ids = sorted(ours.station_id.unique())
        held = sorted(np.random.default_rng(args.seed).choice(ids, size=max(2, len(ids) // 5), replace=False).tolist())
        run(ours[~ours.station_id.isin(held)], ours[ours.station_id.isin(held)], '2022-01-01', '2020-07-01', '2022-01-01',
            '2022-01-01', '2022-01-01', '2024-12-31', 'heldout', out)
    else:
        from scripts.external_caravan_eval import load_basins
        caravan, crep = clean_frame(load_basins(Path(args.caravan), set(ours.station_id)), target=True)
        (out / 'data_quality_caravan.json').write_text(json.dumps(crep, indent=2), encoding='utf-8')
        # Keep 1995-2020: thresholds come from 1995-2009 (reference), tests from 2010-2020. Limits memory/runtime.
        caravan = caravan[caravan.date >= '1995-01-01'].reset_index(drop=True)
        print('caravan basins', caravan.station_id.nunique(), 'rows', len(caravan), flush=True)
        run(ours, caravan, '2023-01-01', '2023-01-01', '2025-01-01', '2010-01-01', '2010-01-01', '2020-12-31', 'caravan', out)


if __name__ == '__main__':
    main()
