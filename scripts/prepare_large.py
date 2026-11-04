"""Download all three sources, train, validate, and publish reproducible local experiment reports."""
from argparse import Namespace
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import solution
from download_data import main as download
from download_catchments import main as catchments
from evaluate_holdout import main as evaluate
from organize_dataset import main as organize

if __name__=='__main__':
    download(Namespace(large=True,start='2010-01-01',end='2025-12-31',test_start='2025-01-01',output='data/large'))
    catchments(Namespace(data='data/large'))
    solution.run_improved(Namespace(train='data/large/train.csv',test='data/large/test.csv',output='predictions.csv',
                           metrics='reports/metrics.json',model='floodcast.joblib',seed=42,
                           metadata='data/large/station_metadata.csv',experiment='data/experiments/prepared',
                           regional=True,inventory='data/large/raw/station_inventory.rdb',validation_cache=None))
    evaluate(Namespace(data='data/large',predictions='predictions.csv',output='reports/demo_holdout.json'))
    organize(Namespace(data='data/large',predictions='predictions.csv'))
    for filename in ['provenance.json','catchment_provenance.json']:
        shutil.copyfile(Path('data/large')/filename,Path('reports')/filename)
    Path('public/reports').mkdir(parents=True,exist_ok=True)
    for filename in ['metrics.json','demo_holdout.json','provenance.json','catchment_provenance.json']:
        shutil.copyfile(Path('reports')/filename,Path('public/reports')/filename)
    print('LARGE DATA TRAINING AND VALIDATION COMPLETE',flush=True)
