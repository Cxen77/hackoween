"""Diagnose frozen public-test failures; never import this into model fitting/selection."""
from pathlib import Path
import numpy as np
import pandas as pd

def main():
    train=pd.read_csv('data/large/train/train.csv',dtype={'station_id':str})
    comparison=pd.read_csv('evaluation/predictions_vs_actual.csv',dtype={'station_id':str})
    rows=[]
    for sid,g in comparison.groupby('station_id'):
        extreme=g[g.discharge_cfs_actual>=g.discharge_cfs_actual.quantile(.9)]
        actual=float(extreme.discharge_cfs_actual.mean());pred=float(extreme.discharge_cfs_predicted.mean())
        rows.append({'station_id':sid,'name':g.station_name.iloc[0],
                     'rmse':float(np.sqrt(np.mean(g.error_cfs**2))),'mae':float(g.absolute_error_cfs.mean()),
                     'peak_actual_mean':actual,'peak_prediction_mean':pred,
                     'peak_bias_percent':100*(pred/actual-1) if actual else np.nan,
                     'squared_error':float((g.error_cfs**2).sum()),
                     'training_max_discharge_cfs':float(train.loc[train.station_id==sid,'discharge_cfs'].max())})
    result=pd.DataFrame(rows).sort_values('squared_error',ascending=False)
    result['squared_error_share_percent']=100*result.squared_error/result.squared_error.sum()
    result.to_csv('evaluation/error_diagnostics.csv',index=False)
    print(result.head(3).to_string(index=False))
    print('Top3 share of total squared error:',result.head(3).squared_error_share_percent.sum())

if __name__=='__main__':main()
