"""Validation-only flow-regime ensemble using verified fitted models and cached predictions."""
from argparse import Namespace
import argparse
import hashlib
import json
from pathlib import Path
import sys
import joblib
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from solution import read_input,features,metrics,validate_output,KEYS
from scripts.improve_model import regional_features,predict_candidate,relative_score

def combine(log_pred,raw_pred,frame,config):
    signal=log_pred if config['signal']=='predicted_flow' else frame.drainage_area_sqmi.fillna(0).to_numpy()
    fraction=config['raw_cap']*np.clip((signal-config['low'])/(config['high']-config['low']),0,1)
    return (1-fraction)*log_pred+fraction*raw_pred

def select_regime(train,previous,predictions):
    splits={'future_dates':train.date>=previous['validation_cutoff'],
            'unseen_station_future_dates':(train.date>=previous['validation_cutoff'])&train.station_id.isin(previous['held_out_stations'])}
    incumbent=previous['validation'][previous['selected_model']];reference=previous['validation']['baseline_log']
    options=[]
    for signal,lows,highs in [('predicted_flow',[0,1000,3000,10000],[5000,20000,50000,100000]),
                              ('drainage_area',[0,1000,5000,10000],[10000,30000,100000])]:
        for low in lows:
            for high in highs:
                if high<=low:continue
                for cap in [.5,.75,1.]:
                    config={'signal':signal,'low':low,'high':high,'raw_cap':cap};result={}
                    for name,val in splits.items():
                        pred=combine(predictions[f'baseline_log__{name}'],predictions[f'regional_raw__{name}'],train.loc[val],config)
                        result[name]={'model':metrics(train.loc[val,'discharge_cfs'],pred,train.loc[val,'station_id']),
                                      'median_baseline':reference[name]['median_baseline']}
                    eligible=all(result[name]['model'][metric]<=incumbent[name]['model'][metric]
                                 for name in splits for metric in ['rmse','extreme_rmse'])
                    options.append((relative_score(result,reference),config,result,eligible))
    eligible=[option for option in options if option[3]]
    return min(eligible,key=lambda option:option[0]) if eligible else None,options

def main(args):
    source=Path(args.source);out=Path(args.experiment);out.mkdir(parents=True,exist_ok=True)
    previous=json.loads((source/'metrics.json').read_text(encoding='utf-8'))
    train=read_input(args.train,True);test=read_input(args.test)
    for key,path in [('train',args.train),('test',args.test),('metadata',args.metadata)]:
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=previous['input_hashes'][key]:raise ValueError('Frozen training/input hashes changed')
    if 'discharge_cfs' in test or test.date.min()<=train.date.max():raise ValueError('Invalid test features')
    cached=np.load(source/'validation_predictions.npz')
    selected,options=select_regime(train,previous,cached)
    summary=[{'score':score,'gating':config,'passes_gate':eligible,
              'validation':{name:r['model'] for name,r in results.items()}} for score,config,results,eligible in options]
    (out/'search.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    if selected is None:
        print('No flow-regime candidate improves all4 incumbent validation RMSE metrics. Existing ensemble retained.');return
    score,config,result,_=selected
    selection={**previous,'selected_model':'regime_ensemble_v2','gating':config,
               'selected_components':[{'kind':'baseline_log','weight':'1 - dynamic_raw_weight'}, {'kind':'regional_raw','weight':'dynamic_raw_weight'}],
               'validation_score_relative_to_v1':score,'passes_both_rmse_gate':True,
               'selection_note':'Flow-dependent convex weights selected only on temporal/geographic validation. Signal is a model prediction or known drainage area, never actual target discharge. Requires all4 validation RMSE metrics not to worsen against the incumbent V2 ensemble.'}
    selection['validation']={**previous['validation'],'regime_ensemble_v2':result}
    (out/'selection_locked.json').write_text(json.dumps(selection,indent=2),encoding='utf-8')
    print('GATING LOCKED BEFORE TEST EVALUATION:',config,'score',score,flush=True)
    bundle=joblib.load(source/'model.joblib');metadata=bundle['metadata'];models={m['kind']:m for m in bundle['components']}
    if not {'baseline_log','regional_raw'}.issubset(models):raise ValueError('Expected fitted component models not present')
    history=train[pd.to_datetime(train.date)>=pd.to_datetime(test.date).min()-pd.Timedelta(days=90)]
    base_train=features(train);region_train=regional_features(train,metadata)
    base_test=features(test,history=history);region_test=regional_features(test,metadata,history=history)
    train_prediction=combine(predict_candidate(models['baseline_log'],train,base_train),predict_candidate(models['regional_raw'],train,region_train),train,config)
    prediction=combine(predict_candidate(models['baseline_log'],test,base_test),predict_candidate(models['regional_raw'],test,region_test),test,config)
    output=test[KEYS].copy();output['discharge_cfs']=prediction;validate_output(test,output)
    output.to_csv(out/'predictions.csv',index=False,encoding='utf-8',float_format='%.6f')
    validate_output(test,pd.read_csv(out/'predictions.csv',dtype={'station_id':str}))
    selection['training_metrics']=metrics(train.discharge_cfs,train_prediction,train.station_id)
    (out/'metrics.json').write_text(json.dumps(selection,indent=2),encoding='utf-8')
    joblib.dump({**bundle,'gating':config},out/'model.joblib')
    print('Flow-regime experiment generated validated predictions. Test actuals were never loaded.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',default='data/experiments/v3')
    parser.add_argument('--experiment',default='data/experiments/v5');parser.add_argument('--train',default='data/large/train/train.csv')
    parser.add_argument('--test',default='data/large/test/test.csv');parser.add_argument('--metadata',default='data/large/metadata/station_metadata.csv')
    main(parser.parse_args())
