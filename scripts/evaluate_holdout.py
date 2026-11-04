"""One-time evaluation of the frozen model's PUBLIC demo holdout; never used in selection."""
import json
from pathlib import Path
import sys
import argparse
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from solution import metrics

def main(args):
    predictions=pd.read_csv(args.predictions,dtype={'station_id':str})
    truth=pd.read_csv(Path(args.data)/'demo_holdout_actuals.csv',dtype={'station_id':str})
    joined=truth.merge(predictions,on=['station_id','date'],suffixes=('_actual','_predicted'),validate='one_to_one')
    if len(joined)!=len(truth) or len(predictions)!=len(truth):raise ValueError('Holdout keys differ')
    report={'purpose':'Frozen-model evaluation on public demo holdout, not official leaderboard scores.',
            'period':[truth.date.min(),truth.date.max()],
            'overall':metrics(joined.discharge_cfs_actual,joined.discharge_cfs_predicted.to_numpy(),joined.station_id),
            'by_station':{sid:metrics(g.discharge_cfs_actual,g.discharge_cfs_predicted.to_numpy(),g.station_id) for sid,g in joined.groupby('station_id')}}
    train=pd.read_csv(Path(args.data)/'train.csv',dtype={'station_id':str})
    medians=train.groupby('station_id').discharge_cfs.median()
    baseline=joined.station_id.map(medians).fillna(train.discharge_cfs.median()).to_numpy()
    report['training_station_median_baseline']=metrics(joined.discharge_cfs_actual,baseline,joined.station_id)
    Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data',default='data/demo')
    parser.add_argument('--predictions',default='predictions.csv');parser.add_argument('--output',default='reports/demo_holdout.json')
    main(parser.parse_args())
