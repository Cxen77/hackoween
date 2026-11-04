"""Check the exact submission schema against test.csv without reading any test targets."""
import argparse
from pathlib import Path
import sys
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from solution import validate_output

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test',required=True);parser.add_argument('--predictions',default='predictions.csv')
    args=parser.parse_args()
    test=pd.read_csv(args.test,dtype={'station_id':str},encoding='utf-8-sig')
    output=pd.read_csv(args.predictions,dtype={'station_id':str},encoding='utf-8')
    if test[['station_id','date']].isna().any().any() or test.duplicated(['station_id','date']).any():
        raise ValueError('Invalid or duplicate test keys')
    validate_output(test,output)
    print(f'PASS: UTF-8, exact columns/order, {len(output):,} matching rows, no missing/extra keys, all predictions finite and nonnegative.')
