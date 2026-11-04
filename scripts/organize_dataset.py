"""Organize downloaded train/test/evaluation data and code-generated predictions for inspection."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from solution import validate_output, metrics

def main(args):
    root=Path(args.data)
    destinations={'train.csv':'train/train.csv','test.csv':'test/test.csv',
                  'demo_holdout_actuals.csv':'evaluation/actuals.csv',
                  'station_metadata.csv':'metadata/station_metadata.csv',
                  'catchment_attributes.csv':'metadata/catchment_attributes.csv',
                  'provenance.json':'metadata/provenance.json','catchment_provenance.json':'metadata/catchment_provenance.json'}
    for source,destination in destinations.items():
        target=root/destination;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/source,target)
    (root/'predictions').mkdir(exist_ok=True)
    shutil.copyfile(args.predictions,root/'predictions'/'predictions.csv')
    test=pd.read_csv(root/'test/test.csv',dtype={'station_id':str})
    predictions=pd.read_csv(root/'predictions/predictions.csv',dtype={'station_id':str})
    validate_output(test,predictions)
    actual=pd.read_csv(root/'evaluation/actuals.csv',dtype={'station_id':str})
    comparison=actual.merge(predictions,on=['station_id','date'],suffixes=('_actual','_predicted'),validate='one_to_one')
    if len(comparison)!=len(actual) or len(actual)!=len(test):raise ValueError('Incomplete evaluation key coverage')
    comparison['error_cfs']=comparison.discharge_cfs_predicted-comparison.discharge_cfs_actual
    comparison['absolute_error_cfs']=comparison.error_cfs.abs()
    comparison.to_csv(root/'evaluation/comparison.csv',index=False,encoding='utf-8')
    scored=metrics(comparison.discharge_cfs_actual,comparison.discharge_cfs_predicted.to_numpy(),comparison.station_id)
    (root/'evaluation/metrics.json').write_text(json.dumps(scored,indent=2),encoding='utf-8')
    readme=f'''# Public FLOODCAST dataset

This is downloaded real public data, NOT the official event test set.

| Folder | Contents | Role |
| --- | --- | --- |
| `raw/` | Cached USGS, weather, StreamStats and GAGES-II source responses | Reproducible acquisition |
| `train/train.csv` | {len(pd.read_csv(root/'train/train.csv')):,} historical rows with discharge targets | Model fitting and internal validation |
| `test/test.csv` | {len(test):,} later rows without discharge | Features supplied for predictions |
| `evaluation/actuals.csv` | Actual public test discharge, kept separate | Evaluation ONLY, never input to training |
| `predictions/predictions.csv` | Code-generated output for every test row | Finite nonnegative discharge predictions |
| `evaluation/comparison.csv` | Actual vs predicted discharge and signed/absolute errors | Inspect predictions row by row |
| `evaluation/metrics.json` | Overall RMSE, extreme RMSE, MAE, R² | Frozen-model holdout evaluation |
| `metadata/` | Station locations, basin attributes, source provenance/citations | Explain origin and feature coverage |

Targets are USGS daily mean discharge in cfs. Dates, units and missing features are documented in metadata. Top-level CSVs are retained as acquisition-stage compatibility files; the organized folders are the inspection copies. Raw responses can contain flow summaries, but the training code reads only allowlisted weather and static descriptors.

To reproduce predictions using these separated folders:

```powershell
python solution.py --train {root.as_posix()}/train/train.csv --test {root.as_posix()}/test/test.csv --output {root.as_posix()}/predictions/predictions.csv --metrics reports/inspection_metrics.json
python scripts/validate_submission.py --test {root.as_posix()}/test/test.csv --predictions {root.as_posix()}/predictions/predictions.csv
```

Training reads train and test features only. The comparison/evaluation code is the only code that reads actual public holdout answers. Data and local trained artifacts are ignored by Git; download scripts and reports are tracked.
'''
    (root/'README.md').write_text(readme,encoding='utf-8')
    print(f'Organized {root}: train/, test/, metadata/, evaluation/, predictions/, raw/.')
    print(f'Comparison saved: {root}/evaluation/comparison.csv ({len(comparison):,} rows).')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--data',default='data/large')
    parser.add_argument('--predictions',default='predictions.csv');main(parser.parse_args())
