"""Compare a validation-locked candidate on a reused public benchmark, then promote if all gates pass."""
from argparse import Namespace
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import sys
import joblib
import numpy
import pandas
import sklearn
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.evaluate_holdout import main as evaluate
from scripts.organize_dataset import main as organize
from scripts.write_model_card import main as model_card

def main(args):
    experiment=Path(args.experiment)
    selection=json.loads((experiment/'selection_locked.json').read_text(encoding='utf-8'))
    evaluate(Namespace(data='data/large',predictions=str(experiment/'predictions.csv'),output=str(experiment/'benchmark.json')))
    benchmark=json.loads((experiment/'benchmark.json').read_text(encoding='utf-8'))
    baseline=json.loads(Path('reports/baseline_v1/demo_holdout.json').read_text(encoding='utf-8'))
    incumbent=json.loads(Path('reports/demo_holdout.json').read_text(encoding='utf-8'))
    report={'comparison_note':'2025 is a reused public benchmark, not a new untouched final test. No benchmark targets are used in training or ensemble weight selection.',
            'selected_components':selection['selected_components'],'validation_gate':selection['passes_both_rmse_gate'],
            'validation_score_relative_to_v1':selection['validation_score_relative_to_v1'],
            'baseline':baseline['overall'],'incumbent':incumbent['overall'],'candidate':benchmark['overall'],
            'percentage_error_reduction':{k:100*(1-benchmark['overall'][k]/baseline['overall'][k]) for k in ['rmse','extreme_rmse','mae']}}
    promote=selection['passes_both_rmse_gate'] and all(benchmark['overall'][k]<incumbent['overall'][k] for k in ['rmse','extreme_rmse'])
    report['promoted']=bool(promote)
    archive=Path('reports/experiments')/experiment.name;archive.mkdir(parents=True,exist_ok=True)
    (archive/'comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    (archive/'validation.json').write_bytes((experiment/'metrics.json').read_bytes())
    if not promote:
        print('Candidate not promoted. Original model/predictions preserved.',flush=True)
        print(json.dumps(report,indent=2));return
    Path('reports/improvement_v2.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    Path('reports/improvement_v2_validation.json').write_bytes((experiment/'metrics.json').read_bytes())
    for source,target in [('predictions.csv','predictions.csv'),('metrics.json','reports/metrics.json'),('model.joblib','floodcast.joblib'),('benchmark.json','reports/demo_holdout.json')]:
        shutil.copyfile(experiment/source,target)
    current=json.loads(Path('reports/demo_holdout.json').read_text(encoding='utf-8'))
    current['purpose']='Validation-selected ensemble evaluated on the previously inspected 2025 public benchmark. Not a new independent test or official leaderboard score.'
    current['benchmark_previously_inspected']=True
    Path('reports/demo_holdout.json').write_text(json.dumps(current,indent=2),encoding='utf-8')
    organize(Namespace(data='data/large',predictions='predictions.csv'))
    model_card()
    model_bytes=Path('floodcast.joblib').read_bytes()
    runtime={'python':platform.python_version(),'numpy':numpy.__version__,'pandas':pandas.__version__,
             'scikit_learn':sklearn.__version__,'joblib':joblib.__version__,
             'model_sha256':hashlib.sha256(model_bytes).hexdigest(),'model_bytes':len(model_bytes),
             'feature_count':len(selection['features']),'schema_version':2,'selected_components':selection['selected_components'],
             'note':'V2 component bundle; use solution.py --improved to regenerate. Serialized model is local/ignored.'}
    if any(c['kind'].startswith('lgbm') for c in selection['selected_components']):
        import lightgbm
        runtime['lightgbm']=lightgbm.__version__
    if any(c['kind'].startswith('catboost') for c in selection['selected_components']):
        import catboost
        runtime['catboost']=catboost.__version__
    Path('reports/runtime.json').write_text(json.dumps(runtime,indent=2),encoding='utf-8')
    for filename in ['metrics.json','demo_holdout.json','improvement_v2.json']:
        shutil.copyfile(Path('reports')/filename,Path('public/reports')/filename)
    print('PROMOTED: candidate passed both validation splits and improved overall + extreme public benchmark RMSE.',flush=True)
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--experiment',default='data/experiments/v3')
    main(parser.parse_args())
