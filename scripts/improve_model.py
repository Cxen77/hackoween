"""Validation-selected peak-aware models. Test targets are never loaded by this script."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from solution import read_input, features, metrics, validate_output, build_model, KEYS, FEATURES

CANDIDATES=['baseline_log','baseline_raw','weather_log','weather_raw','weather_peak_raw','weather_specific','weather_poisson']
REGIONAL_CANDIDATES=['no_geo_log','regional_log','regional_raw','regional_peak_raw','base_poisson']

def regional_features(frame,metadata,history=None):
    """Weather-point regional proxies, not basin-average rainfall and never discharge aggregates."""
    x=features(frame,history=history)
    huc=metadata.set_index('station_id').huc2 if 'huc2' in metadata else pd.Series(dtype=str)
    current=frame[KEYS+FEATURES].copy();current['_row']=np.arange(len(frame))
    if history is not None:
        past=history[KEYS+FEATURES].copy();past['_row']=-1;current=pd.concat([past,current],ignore_index=True)
    current['region']=current.station_id.map(huc).fillna('unknown')
    current['date']=pd.to_datetime(current.date)
    current['temperature_mean']=(current.temp_max_c+current.temp_min_c)/2
    results=[]
    for region,g in current.groupby('region'):
        # Lower Mississippi receives these USGS hydrologic regions. Else use local HUC2.
        upstream=[] if region=='unknown' else ['05','06','07','08','10','11'] if region=='08' else [region]
        weather=current[current.region.isin(upstream)].groupby('date')[['precipitation_mm','soil_moisture','temperature_mean']].mean().sort_index()
        weather=weather.rename(columns={'precipitation_mm':'regional_rain','soil_moisture':'regional_soil','temperature_mean':'regional_temperature'})
        weather['regional_station_count']=current[current.region.isin(upstream)].groupby('date').size()
        for days in [3,7,14,30,60,90]:weather[f'regional_rain_previous_{days}d']=weather.regional_rain.rolling(f'{days}D',closed='left',min_periods=1).sum()
        weather['regional_soil_previous_14d']=weather.regional_soil.rolling('14D',closed='left',min_periods=1).mean()
        result=g[['_row','date']].merge(weather,left_on='date',right_index=True,how='left',validate='many_to_one')
        results.append(result)
    extra=pd.concat(results,ignore_index=True);extra=extra[extra._row>=0].sort_values('_row')
    for col in extra:
        if col not in ['_row','date']:x[col]=extra[col].to_numpy()
    # HUC2 is a shared physical region, not a station identifier.
    for region in sorted(huc.dropna().unique()):x[f'huc2_{region}']=(frame.station_id.map(huc)==region).astype(float)
    return x.replace([np.inf,-np.inf],np.nan)

def design(kind,base,enriched,regional):
    if kind.startswith('baseline') or kind=='base_poisson':return base
    if kind.startswith('regional'):return regional
    if kind=='no_geo_log':return enriched.drop(columns=['latitude','longitude'])
    return enriched

def improved_features(frame, metadata, history=None):
    x=features(frame,history=history)
    # Coordinates describe geography, not a learned target encoding or station identity.
    for col in ['latitude','longitude']:
        x[col]=frame.station_id.map(metadata.set_index('station_id')[col]) if col in metadata else np.nan
    current=frame[KEYS+FEATURES].copy();current['_row']=np.arange(len(frame))
    if history is not None:
        past=history[KEYS+FEATURES].copy();past['_row']=-1;current=pd.concat([past,current],ignore_index=True)
    current['date']=pd.to_datetime(current.date);current=current.sort_values(['station_id','date'])
    additions=[]
    for _,g in current.groupby('station_id',sort=False):
        index=pd.DatetimeIndex(g.date)
        result=pd.DataFrame({'_row':g._row.to_numpy()})
        rain=pd.Series(g.precipitation_mm.to_numpy(),index=index)
        soil=pd.Series(g.soil_moisture.to_numpy(),index=index)
        temperature=pd.Series((g.temp_max_c.to_numpy()+g.temp_min_c.to_numpy())/2,index=index)
        for days in [45,60,90]:result[f'rain_previous_{days}d']=rain.rolling(f'{days}D',closed='left',min_periods=1).sum().to_numpy()
        for days in [3,7,14,30]:
            result[f'soil_previous_{days}d']=soil.rolling(f'{days}D',closed='left',min_periods=1).mean().to_numpy()
            result[f'temp_previous_{days}d']=temperature.rolling(f'{days}D',closed='left',min_periods=1).mean().to_numpy()
        result['positive_degree_days_14d']=temperature.clip(lower=0).rolling('14D',closed='left',min_periods=1).sum().to_numpy()
        result['freezing_days_30d']=(temperature<0).astype(float).rolling('30D',closed='left',min_periods=1).sum().to_numpy()
        additions.append(result)
    extra=pd.concat(additions,ignore_index=True);extra=extra[extra._row>=0].sort_values('_row')
    for col in extra.columns:
        if col!='_row':x[col]=extra[col].to_numpy()
    x['soil_change_7d']=x.soil_moisture-x.soil_previous_7d
    x['temp_change_7d']=x.temperature_mean-x.temp_previous_7d
    x['wetness_long_rain']=x.soil_moisture*x.rain_previous_60d
    x['area_long_rain']=x.log_drainage_area*x.rain_previous_60d
    x['slope_rain']=x.slope_pct*x.precipitation_mm
    return x.replace([np.inf,-np.inf],np.nan)

def peak_weights(frame, multiplier=3.):
    # Fitting targets only; caller must pass only the fitting split.
    threshold=frame.groupby('station_id').discharge_cfs.transform(lambda y:y.quantile(.9))
    return np.where(frame.discharge_cfs.to_numpy()>=threshold.to_numpy(),multiplier,1.)

def candidate_model(kind,seed):
    if kind.startswith('baseline'):return build_model('hist_log' if kind.endswith('log') else 'hist_raw',seed)
    model=HistGradientBoostingRegressor(loss='poisson' if kind.endswith('poisson') else 'squared_error',
        max_iter=420,learning_rate=.055,max_leaf_nodes=23 if kind.startswith('regional') or kind=='base_poisson' else 31,
        l2_regularization=40 if kind.startswith('regional') else 12,
        early_stopping=False,random_state=seed)
    return make_pipeline(SimpleImputer(strategy='median',add_indicator=True,keep_empty_features=True),model)

def fit_candidate(kind,frame,x,seed):
    model=candidate_model(kind,seed);y=frame.discharge_cfs.to_numpy()
    fallback=frame.drainage_area_sqmi.where(lambda s:s>0).median()
    fallback=float(fallback) if np.isfinite(fallback) else 1.
    specific=kind.endswith('specific');log=kind.endswith('log')
    scale=frame.drainage_area_sqmi.where(lambda s:s>0).fillna(fallback).to_numpy() if specific else np.ones(len(frame))
    transformed=np.log1p(y) if log else y/scale
    kwargs={'histgradientboostingregressor__sample_weight':peak_weights(frame,1.8 if kind=='regional_peak_raw' else 3.)} if kind in ['weather_peak_raw','regional_peak_raw'] else {}
    model.fit(x,transformed,**kwargs)
    return {'kind':kind,'pipeline':model,'target_log':log,'target_specific':specific,'drainage_fallback':fallback,'features':x.columns.tolist()}

def predict_candidate(component,frame,x):
    raw=component['pipeline'].predict(x[component['features']])
    if component['target_log']:raw=np.expm1(np.minimum(raw,700))
    if component['target_specific']:raw=raw*frame.drainage_area_sqmi.where(lambda s:s>0).fillna(component['drainage_fallback']).to_numpy()
    return np.maximum(0,raw)

def relative_score(report,reference):
    scores=[]
    for name,result in report.items():
        m,b=result['model'],reference[name]['model']
        scores.append(.4*m['rmse']/b['rmse']+.3*m['extreme_rmse']/b['extreme_rmse']
                      +.2*m['mae']/b['mae']+.1*(1-m['r2'])/max(1-b['r2'],1e-9))
    return float(np.mean(scores))

def run(args):
    start=time.time();out=Path(args.experiment);out.mkdir(parents=True,exist_ok=True)
    train,test=read_input(args.train,True),read_input(args.test)
    if 'discharge_cfs' in test:raise ValueError('No test targets are allowed')
    if test.date.min()<=train.date.max():raise ValueError('Test dates must follow all training dates')
    metadata=pd.read_csv(args.metadata,dtype={'station_id':str,'huc2':str}) if args.metadata and Path(args.metadata).exists() else pd.DataFrame(columns=['station_id'])
    if metadata.station_id.duplicated().any():raise ValueError('Duplicate metadata stations')
    if getattr(args,'regional',False):
        from scripts.download_data import parse_rdb
        inventory=parse_rdb(Path(args.inventory).read_text(encoding='utf-8'))
        inventory=inventory[inventory.agency_cd=='USGS'].drop_duplicates('site_no')
        regions=inventory.set_index('site_no').huc_cd.str[:2]
        provided=metadata['huc2'] if 'huc2' in metadata else pd.Series(np.nan,index=metadata.index)
        metadata['huc2']=provided.combine_first(metadata.station_id.map(regions))
    dates=sorted(train.date.unique());cutoff=dates[int(len(dates)*.8)]
    ids=sorted(train.station_id.unique());held=sorted(np.random.default_rng(args.seed).choice(ids,size=max(2,len(ids)//5),replace=False).tolist())
    splits={'future_dates':(train.date<cutoff,train.date>=cutoff),
            'unseen_station_future_dates':((train.date<cutoff)&~train.station_id.isin(held),(train.date>=cutoff)&train.station_id.isin(held))}
    base=features(train);enriched=improved_features(train,metadata)
    regional=regional_features(train,metadata) if getattr(args,'regional',False) else base
    candidates=CANDIDATES+(REGIONAL_CANDIDATES if getattr(args,'regional',False) else [])
    hashes={k:hashlib.sha256(Path(v).read_bytes()).hexdigest() for k,v in [('train',args.train),('test',args.test),('metadata',args.metadata)] if v and Path(v).exists()}
    cache_report=None;cache_predictions=None
    if getattr(args,'validation_cache',None):
        folder=Path(args.validation_cache);cache_report=json.loads((folder/'metrics.json').read_text(encoding='utf-8'))
        if cache_report.get('input_hashes')!=hashes:raise ValueError('Cached validation inputs do not match current data')
        if cache_report['seed']!=args.seed or cache_report['validation_cutoff']!=cutoff or cache_report['held_out_stations']!=held:
            raise ValueError('Cached validation split or random seed does not match')
        cache_predictions=np.load(folder/'validation_predictions.npz')
    reports={};predictions={}
    for kind in candidates:
        reports[kind]={};predictions[kind]={};x=design(kind,base,enriched,regional)
        if cache_report and kind in cache_report['validation']:
            reports[kind]=cache_report['validation'][kind]
            predictions[kind]={name:cache_predictions[f'{kind}__{name}'] for name in splits}
            print(f'Reused verified validation cache: {kind}',flush=True);continue
        for name,(fit,val) in splits.items():
            print(f'Fitting {kind}: {name} ({fit.sum():,} rows)',flush=True)
            model=fit_candidate(kind,train.loc[fit],x.loc[fit],args.seed)
            pred=predict_candidate(model,train.loc[val],x.loc[val]);predictions[kind][name]=pred
            b=np.full(val.sum(),float(train.loc[fit,'discharge_cfs'].median()))
            reports[kind][name]={'model':metrics(train.loc[val,'discharge_cfs'],pred,train.loc[val,'station_id']),
                                 'median_baseline':metrics(train.loc[val,'discharge_cfs'],b,train.loc[val,'station_id'])}
        print(kind,json.dumps({k:v['model'] for k,v in reports[kind].items()}),flush=True)
        (out/'candidate_validation.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
    reference=reports['baseline_log'];options=[]
    def evaluate_components(components):
        result={}
        for name,(_,val) in splits.items():
            pred=sum(weight*predictions[kind][name] for kind,weight in components)
            result[name]={'model':metrics(train.loc[val,'discharge_cfs'],pred,train.loc[val,'station_id']),
                          'median_baseline':reference[name]['median_baseline']}
        return result
    for kind in candidates:options.append((relative_score(reports[kind],reference),[(kind,1.)],reports[kind]))
    for i,left in enumerate(candidates):
        for right in candidates[i+1:]:
            for weight in [.1,.25,.5,.75,.9]:
                parts=[(left,weight),(right,1-weight)];r=evaluate_components(parts)
                options.append((relative_score(r,reference),parts,r))
    if getattr(args,'optimize_ensemble',False):
        from scipy.optimize import minimize
        residuals=[];constraints=[]
        incumbent=cache_report['validation'][cache_report['selected_model']] if cache_report else reference
        for name,(_,val) in splits.items():
            g=train.loc[val];actual=g.discharge_cfs.to_numpy()
            error=np.column_stack([predictions[kind][name]-actual for kind in candidates])
            peak=actual>=g.groupby('station_id').discharge_cfs.transform(lambda y:y.quantile(.9)).to_numpy()
            covariance=error.T@error/len(actual);extreme=error[peak].T@error[peak]/peak.sum()
            residuals.append((error,covariance,extreme,reference[name]['model']))
            for covariance_matrix,metric in [(covariance,'rmse'),(extreme,'extreme_rmse')]:
                limit=incumbent[name]['model'][metric]**2
                constraints.append({'type':'ineq','fun':lambda w,c=covariance_matrix,b=limit:1-w@c@w/b,
                                    'jac':lambda w,c=covariance_matrix,b=limit:-2*c@w/b})
        def objective(w):
            value=0.;gradient=np.zeros(len(w))
            for error,covariance,extreme,base_metrics in residuals:
                c=covariance@w;e=extreme@w;rmse=max(np.sqrt(w@c),1e-12);peak_rmse=max(np.sqrt(w@e),1e-12)
                errors=error@w
                value+=.4*rmse/base_metrics['rmse']+.3*peak_rmse/base_metrics['extreme_rmse']+.2*np.mean(np.abs(errors))/base_metrics['mae']+.1*(w@c)/(base_metrics['rmse']**2)
                gradient+=.4*c/(rmse*base_metrics['rmse'])+.3*e/(peak_rmse*base_metrics['extreme_rmse'])+.2*(error.T@np.sign(errors))/(len(errors)*base_metrics['mae'])+.2*c/(base_metrics['rmse']**2)
            return value/len(residuals),gradient/len(residuals)
        constraints.append({'type':'eq','fun':lambda w:w.sum()-1,'jac':lambda w:np.ones(len(w))})
        initial=np.zeros(len(candidates))
        for component in (cache_report or {}).get('selected_components',[{'kind':'baseline_log','weight':1.}]):
            initial[candidates.index(component['kind'])]=component['weight']
        result=minimize(objective,initial,jac=True,method='SLSQP',bounds=[(0.,1.)]*len(candidates),constraints=constraints,
                        options={'maxiter':180,'ftol':1e-10})
        w=np.maximum(result.x,0);w/=w.sum()
        refined=[(kind,float(weight)) for kind,weight in zip(candidates,w) if weight>1e-8]
        total=sum(weight for _,weight in refined);refined=[(kind,weight/total) for kind,weight in refined]
        candidate_report=evaluate_components(refined)
        passes=all(candidate_report[name]['model'][metric]<=incumbent[name]['model'][metric]*(1+1e-7)
                   for name in splits for metric in ['rmse','extreme_rmse'])
        if result.success and passes:
            options.append((relative_score(candidate_report,reference),refined,candidate_report))
            print('Continuous validation-only ensemble accepted',refined,flush=True)
        else:print('Continuous refinement discarded; existing validation ensemble retained.',result.message,flush=True)
    # Predeclared gate: both validation splits must improve BOTH overall and extreme RMSE.
    eligible=[o for o in options if all(o[2][name]['model']['rmse']<reference[name]['model']['rmse']
              and o[2][name]['model']['extreme_rmse']<reference[name]['model']['extreme_rmse'] for name in splits)]
    score,parts,selected=min(eligible,key=lambda o:o[0]) if eligible else (1.,[('baseline_log',1.)],reference)
    best='ensemble_v2' if len(parts)>1 else parts[0][0]
    reports[best]=selected
    selection={'selected_model':best,'selected_components':[{'kind':k,'weight':w} for k,w in parts],
               'validation_cutoff':cutoff,'held_out_stations':held,'validation_score_relative_to_v1':score,
               'passes_both_rmse_gate':bool(eligible),'validation':reports,
               'selection_note':'Candidates and fixed-grid ensembles selected using training-period temporal/geographic validation only. Optional continuous refinement constrains all four RMSE metrics not to worsen against the incumbent validation ensemble. Gate requires lower overall AND extreme RMSE in BOTH splits than baseline v1. 2025 labels are not read.',
               'train_rows':len(train),'test_rows':len(test),'train_dates':[train.date.min(),train.date.max()],
               'test_dates':[test.date.min(),test.date.max()],'seed':args.seed,
               'features':list(dict.fromkeys(col for kind,_ in parts for col in design(kind,base,enriched,regional).columns)),
               'schema_version':2,'input_hashes':hashes,'uses_regional_weather_proxies':getattr(args,'regional',False),
               'benchmark_note':'2025 is a previously inspected public benchmark, not a new untouched independent test.'}
    (out/'selection_locked.json').write_text(json.dumps(selection,indent=2),encoding='utf-8')
    print('SELECTION LOCKED',best,parts,'score',score,'both-RMSE gate',bool(eligible),flush=True)
    history=train[pd.to_datetime(train.date)>=pd.to_datetime(test.date).min()-pd.Timedelta(days=90)]
    test_base=features(test,history=history);test_enriched=improved_features(test,metadata,history=history)
    test_regional=regional_features(test,metadata,history=history) if getattr(args,'regional',False) else test_base
    trained=[];train_pred=np.zeros(len(train));test_pred=np.zeros(len(test))
    for kind,weight in parts:
        x=design(kind,base,enriched,regional)
        component=fit_candidate(kind,train,x,args.seed);component['weight']=weight;trained.append(component)
        train_pred+=weight*predict_candidate(component,train,x)
        test_pred+=weight*predict_candidate(component,test,design(kind,test_base,test_enriched,test_regional))
    output=test[KEYS].copy();output['discharge_cfs']=test_pred;validate_output(test,output)
    output.to_csv(out/'predictions.csv',index=False,encoding='utf-8',float_format='%.6f')
    validate_output(test,pd.read_csv(out/'predictions.csv',dtype={'station_id':str}))
    selection['training_metrics']=metrics(train.discharge_cfs,train_pred,train.station_id)
    selection['elapsed_seconds']=time.time()-start
    (out/'metrics.json').write_text(json.dumps(selection,indent=2),encoding='utf-8')
    joblib.dump({'schema_version':2,'components':trained,'metadata':metadata,'feature_engineering':'improved_features_v2'},out/'model.joblib')
    np.savez_compressed(out/'validation_predictions.npz',**{f'{k}__{s}':p for k,values in predictions.items() for s,p in values.items()})
    print(f'Improved experiment complete: {out}; output contract passed. Test actuals were never opened.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train',default='data/large/train/train.csv');parser.add_argument('--test',default='data/large/test/test.csv')
    parser.add_argument('--metadata',default='data/large/metadata/station_metadata.csv');parser.add_argument('--experiment',default='data/experiments/v2')
    parser.add_argument('--regional',action='store_true');parser.add_argument('--inventory',default='data/large/raw/station_inventory.rdb')
    parser.add_argument('--optimize-ensemble',action='store_true')
    parser.add_argument('--validation-cache');parser.add_argument('--seed',type=int,default=42);run(parser.parse_args())
