"""Fit the station-climatology blend on ALL training rows and predict test; route by whether the station was seen.

Routing rule (knowable at prediction time, uses no target): a test station present in train.csv uses the
station-climatology blend; any other station keeps the current production prediction (V2) from --fallback.
Writes only to --out; never touches root predictions.csv. Test labels are never opened.

Usage: python -m scripts.climatology_final --out data/experiments/climatology_final
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from solution import read_input, validate_output
from scripts.download_data import parse_rdb
from scripts.improve_model import regional_features
from scripts.climatology_experiment import CLIM, apply, clim_for_fit, model, tables


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', default='data/large/train/train.csv')
    ap.add_argument('--test', default='data/large/test/test.csv')
    ap.add_argument('--metadata', default='data/large/metadata/station_metadata.csv')
    ap.add_argument('--inventory', default='data/large/raw/station_inventory.rdb')
    ap.add_argument('--fallback', default='predictions.csv', help='Current production predictions for unseen stations')
    ap.add_argument('--out', default='data/experiments/climatology_final')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--mask-frac', type=float, default=0.25)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    train, test = read_input(args.train, True), read_input(args.test)
    if 'discharge_cfs' in test:
        raise ValueError('Test must not contain targets')
    if test.date.min() <= train.date.max():
        raise ValueError('Test dates must follow training dates')
    metadata = pd.read_csv(args.metadata, dtype={'station_id': str, 'huc2': str})
    inv = parse_rdb(Path(args.inventory).read_text(encoding='utf-8'))
    inv = inv[inv.agency_cd == 'USGS'].drop_duplicates('site_no')
    regions = metadata.station_id.map(inv.set_index('site_no').huc_cd.str[:2])
    metadata['huc2'] = metadata['huc2'].combine_first(regions) if 'huc2' in metadata else regions

    Xtr = regional_features(train, metadata).reset_index(drop=True)
    Xte = regional_features(test, metadata, history=train).reset_index(drop=True)
    st, mo = tables(train)
    Xf = pd.concat([Xtr, clim_for_fit(train, args.mask_frac, args.seed)], axis=1)
    Xt = pd.concat([Xte, apply(test, st, mo)], axis=1)
    y = train.discharge_cfs.to_numpy(float)

    raw = model(args.seed).fit(Xf, y).predict(Xt).clip(min=0)
    log = np.expm1(model(args.seed).fit(Xf, np.log1p(y)).predict(Xt)).clip(min=0)
    clim_pred = 0.25 * log + 0.75 * raw

    fallback = pd.read_csv(args.fallback, dtype={'station_id': str})
    if not fallback[['station_id', 'date']].reset_index(drop=True).equals(test[['station_id', 'date']].reset_index(drop=True)):
        raise ValueError('Fallback predictions must match test keys and order')
    seen = test.station_id.isin(set(train.station_id)).to_numpy()
    final = np.where(seen, clim_pred, fallback.discharge_cfs.to_numpy())
    result = pd.DataFrame({'station_id': test.station_id, 'date': test.date, 'discharge_cfs': final})
    validate_output(test, result)
    result.to_csv(out / 'predictions.csv', index=False, encoding='utf-8')
    print(f'wrote {len(result)} rows; {int(seen.sum())} from climatology blend, {int((~seen).sum())} from fallback')


if __name__ == '__main__':
    main()
