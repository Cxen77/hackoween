"""Publish compact experiment evidence; raw data, caches and models stay local."""
import argparse
import json
from pathlib import Path
import shutil
import pandas as pd


def main(folders):
    rows=[]
    for folder in map(Path,folders):
        source=folder/'metrics.json'
        if not source.exists():raise ValueError(f'Experiment not complete: {folder}')
        report=json.loads(source.read_text(encoding='utf-8'))
        destination=Path('reports/experiments')/folder.name
        destination.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination/'validation.json')
        for name in ['selection_locked.json','minimax_optimizer.json','benchmark.json']:
            if (folder/name).exists():shutil.copyfile(folder/name,destination/name)
        for candidate,splits in report['validation'].items():
            for split,value in splits.items():
                rows.append({'experiment':folder.name,'candidate':candidate,'split':split,
                             'selected':candidate==report['selected_model'],
                             'selected_passes_validation_gate':report['passes_both_rmse_gate'],
                             **value['model']})
    pd.DataFrame(rows).to_csv('evaluation/improvement_trials.csv',index=False)
    print(f'Archived {len(folders)} experiments; {len(rows)} validation metric rows.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('experiments',nargs='+')
    main(parser.parse_args().experiments)
