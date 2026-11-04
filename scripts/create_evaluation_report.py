"""Create a judge-facing regression evaluation matrix, charts and PDF from actual frozen predictions."""
import json
from pathlib import Path
import shutil
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.platypus import Table, TableStyle

def main():
    out=Path('evaluation');out.mkdir(exist_ok=True)
    load=lambda f:json.loads((Path('reports')/f).read_text(encoding='utf-8'))
    m=load('metrics.json');h=load('demo_holdout.json');d=load('provenance.json');selected=m['validation'][m['selected_model']]
    cases=[('Training fit (not validation)',m['training_metrics']),('Later-date validation',selected['future_dates']['model']),
           ('Unseen stations + later dates',selected['unseen_station_future_dates']['model']),
           ('2025 public benchmark (reused)' if m.get('schema_version')==2 else '2025 independent public test',h['overall']),('2025 station-median baseline',h['training_station_median_baseline'])]
    matrix=pd.DataFrame([{'evaluation':name,**result} for name,result in cases])
    matrix=matrix[['evaluation','rows','rmse','extreme_rmse','mae','r2','extreme_rows']]
    matrix.to_csv(out/'metrics_matrix.csv',index=False)
    report={'purpose':'Judge-facing evaluation of a public-data experiment. Not official hidden-test or leaderboard results.',
            'selected_model':m['selected_model'],'train_rows':m['train_rows'],'test_rows':m['test_rows'],
            'station_count':len(d['stations']),'period':d['period'],'evaluations':matrix.to_dict(orient='records'),
            'holdout_rmse_reduction_vs_station_median_percent':100*(1-h['overall']['rmse']/h['training_station_median_baseline']['rmse']),
            'definitions':{'rmse':'Root mean squared error in cfs; lower is better; penalizes large errors.',
                           'extreme_rmse':'RMSE on actual top 10% discharge within each station, including threshold ties.',
                           'mae':'Mean absolute error in cfs; lower is better.',
                           'r2':'Proportion of variance explained. Not a percentage of correct predictions; can be negative.'},
            'official_scoring_weights':{'rmse':.4,'extreme_rmse':.3,'mae':.2,'r2':.1},
            'benchmark_note':m.get('benchmark_note','Original frozen public holdout evaluated after model selection.'),
            'official_score_note':'Leaderboard normalization depends on all teams and hidden event labels; no official composite score can be claimed here.'}
    (out/'metrics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    comparison=pd.read_csv('data/large/evaluation/comparison.csv',dtype={'station_id':str})
    shutil.copyfile('data/large/evaluation/comparison.csv',out/'predictions_vs_actual.csv')
    shutil.copyfile('data/large/evaluation/per_station_metrics.csv',out/'per_station_metrics.csv')
    negative=sum(v['r2']<0 for v in h['by_station'].values())
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False,
                         'axes.labelcolor':'#355968','text.color':'#244856','axes.edgecolor':'#a3b5bc'})
    fig=plt.figure(figsize=(14,8.5),layout='constrained');gs=fig.add_gridspec(2,2,height_ratios=[1,1.05])
    ax=fig.add_subplot(gs[0,0]);actual=comparison.discharge_cfs_actual;pred=comparison.discharge_cfs_predicted
    ax.scatter(actual,pred,s=6,alpha=.18,c='#078e99',rasterized=True,label='Public test records')
    limit=max(actual.max(),pred.max());ax.plot([0,limit],[0,limit],color='#a66d4b',lw=1.4,ls='--',label='Perfect prediction')
    ax.set_xscale('symlog',linthresh=1);ax.set_yscale('symlog',linthresh=1)
    ax.set_xlabel('Actual daily mean discharge (cfs)');ax.set_ylabel('Predicted discharge (cfs)');ax.set_title('Actual vs predicted · all public test rows',loc='left',fontweight='bold',pad=12);ax.grid(alpha=.12);ax.legend(frameon=False,fontsize=9,loc='upper left')
    ax=fig.add_subplot(gs[0,1]);comparison['month']=pd.to_datetime(comparison.date).dt.month
    monthly=comparison.groupby('month').error_cfs.agg(lambda s:np.sqrt(np.mean(s*s)))
    ax.bar(monthly.index,monthly.values,color='#238d9b',width=.65)
    ax.set_xticks(range(1,13),['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
    ax.set_ylabel('RMSE (cfs)');ax.set_title('Test error by month · 2025',loc='left',fontweight='bold',pad=12);ax.grid(axis='y',alpha=.13);ax.set_axisbelow(True)
    ax=fig.add_subplot(gs[1,:]);potomac=comparison[comparison.station_id=='01646500'].sort_values('date')
    dates=pd.to_datetime(potomac.date);ax.plot(dates,potomac.discharge_cfs_actual,color='#315361',lw=1.5,label='Actual USGS discharge');ax.plot(dates,potomac.discharge_cfs_predicted,color='#07a2a9',lw=1.4,label='Model prediction')
    ax.set_ylabel('Daily mean discharge (cfs)');ax.set_title('Potomac station 01646500 · one named example, not the overall score',loc='left',fontweight='bold',pad=12);ax.grid(alpha=.13);ax.legend(frameon=False,loc='upper right',ncol=2,fontsize=10)
    fig.suptitle('FLOODCAST · frozen-model public test evaluation',fontsize=20,fontweight='bold',x=.02,ha='left')
    fig.savefig(out/'evaluation_charts.png',dpi=180,facecolor='white');plt.close(fig)
    fmt=lambda x:f'{x:,.0f}'
    markdown='\n'.join(f"| {name} | {v['rows']:,} | {v['rmse']:,.2f} | {v['extreme_rmse']:,.2f} | {v['mae']:,.2f} | {v['r2']:.4f} |" for name,v in cases)
    readme=f'''# FLOODCAST evaluation matrix

**Public-data experiment, not the official competition test set.** Selected model: `{m['selected_model']}`. Actual data: {len(d['stations'])} stations, {d['period'][0]} through {d['period'][1]}; {m['train_rows']:,} training rows and {m['test_rows']:,} later test rows. Model fitting and ensemble selection use training-period validation only. {report['benchmark_note']}

| Evaluation | Rows | RMSE (cfs) | Extreme RMSE (cfs) | MAE (cfs) | R² |
| --- | ---: | ---: | ---: | ---: | ---: |
{markdown}

Test RMSE is **{report['holdout_rmse_reduction_vs_station_median_percent']:.1f}% lower** than a station-median baseline learned from training data. Test R² **{h['overall']['r2']:.4f}** measures explained variance; it is **not “{100*h['overall']['r2']:.1f}% accuracy.”** This is a regression task predicting a continuous discharge value, so no classification accuracy percentage is claimed.

## Files for judges

- `evaluation_report.pdf`: two-page readable report and actual prediction charts.
- `metrics_matrix.csv`: the numerical evaluation matrix, including training, time validation, geography validation, public benchmark, and baseline.
- `metrics.json`: exact unrounded metrics, definitions, and organizer scoring weights.
- `evaluation_charts.png`: actual-vs-predicted scatter, monthly test RMSE, and a named Potomac time-series example.
- `predictions_vs_actual.csv`: every public test station/date, actual discharge, prediction and errors.
- `per_station_metrics.csv`: all station scores. **{negative} of {len(h['by_station'])} evaluated stations have negative R²**; aggregate results must not hide these failures.

Lower RMSE, extreme RMSE, and MAE are better. Higher R² is better. The extreme-event calculation uses the actual top 10% within each evaluated station, including ties at the threshold. Overall cfs metrics are influenced heavily by large rivers. The chart uses symmetric logarithmic axes so low and high flows, including zero, remain visible.

The brief's score weights are 40% overall RMSE, 30% extreme RMSE, 20% MAE, 10% R². Its final normalized score requires hidden event labels and all-team normalization; it cannot be calculated from this public experiment.

## Limitations

The public target is daily **mean** USGS discharge; confirm the brief's peak-daily target against official event data. Weather is retrospective reanalysis at a gauge coordinate, not basin-average operational forecast rainfall. Some physical attributes are missing and are imputed using training data. Nearby gauges can share a basin, and regulated flows may be hard to predict. See `../model_card.md` for complete limitations and per-station results. Do not tune the model using this final public test and continue calling it independent.

## Rebuild

```powershell
python -m pip install -r requirements-evaluation.txt
python scripts/create_evaluation_report.py
```

Source evidence: `../reports/metrics.json`, `../reports/demo_holdout.json`, and `../reports/provenance.json`. Public predictions were generated by `solution.py`, not edited manually. Official competition submission requires running against the actual event test rows and validating that output.
'''
    (out/'README.md').write_text(readme,encoding='utf-8')
    pdf=canvas.Canvas(str(out/'evaluation_report.pdf'),pagesize=(1120,720));pdf.setTitle('FLOODCAST Evaluation Matrix — Public Test Results')
    pdf.setFillColor(colors.HexColor('#174b59'));pdf.setFont('Helvetica-Bold',34);pdf.drawString(60,654,'FLOODCAST / Evaluation matrix')
    pdf.setFont('Helvetica',17);pdf.setFillColor(colors.HexColor('#536f7b'));pdf.drawString(60,616,f"{len(d['stations'])} stations  |  {m['train_rows']:,} training rows  |  {m['test_rows']:,} public test rows")
    pdf.drawString(60,585,f"Selected model: {m['selected_model']}    Test period: {h['period'][0]} to {h['period'][1]}")
    data=[['Evaluation','Rows','RMSE (cfs)','Extreme RMSE','MAE (cfs)','R-squared']]
    for name,v in cases[1:]:data.append([name,f"{v['rows']:,}",fmt(v['rmse']),fmt(v['extreme_rmse']),fmt(v['mae']),f"{v['r2']:.4f}"])
    table=Table(data,colWidths=[320,95,150,160,150,125],rowHeights=[46]*5)
    table.setStyle(TableStyle([('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTNAME',(0,1),(-1,-1),'Helvetica'),('FONTSIZE',(0,0),(-1,-1),16),('TEXTCOLOR',(0,0),(-1,-1),colors.HexColor('#244b58')),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e1f0f0')),('LINEBELOW',(0,0),(-1,-1),.6,colors.HexColor('#d9e5e7')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),10)]))
    table.wrapOn(pdf,1000,230);table.drawOn(pdf,60,305)
    pdf.setFont('Helvetica-Bold',23);pdf.setFillColor(colors.HexColor('#078e99'));pdf.drawString(60,257,f"{report['holdout_rmse_reduction_vs_station_median_percent']:.1f}% lower test RMSE than the training station-median baseline")
    pdf.setFont('Helvetica',16);pdf.setFillColor(colors.HexColor('#536f7b'))
    lines=[f"R-squared {h['overall']['r2']:.4f} describes explained variance, not a percentage of correct predictions.",
           'Extreme RMSE uses the actual top 10% discharge days within each station, including threshold ties.',
           f'{negative} of {len(h["by_station"])} evaluated stations have negative R-squared. Per-station results are included.',
           'Previously inspected 2025 public benchmark; not a fresh independent test. No test targets enter training.',
           'Sources: USGS discharge; Open-Meteo historical weather; USGS StreamStats and GAGES-II.']
    for i,line in enumerate(lines):pdf.drawString(60,214-i*29,line)
    pdf.setFont('Helvetica',12);pdf.drawString(60,37,'Full definitions, raw values, all predictions and limitations: evaluation/README.md and model_card.md');pdf.showPage()
    pdf.setFillColor(colors.HexColor('#174b59'));pdf.setFont('Helvetica-Bold',29);pdf.drawString(60,665,'Actual predictions and test errors')
    pdf.drawImage(str(out/'evaluation_charts.png'),60,69,width=1000,height=580,preserveAspectRatio=True,anchor='c')
    pdf.setFont('Helvetica',12);pdf.setFillColor(colors.HexColor('#536f7b'));pdf.drawString(60,37,'Every point comes from the frozen-model public test predictions. No invented curves or scores.');pdf.save()
    print(f'Created evaluation matrix, all-row comparison, per-station metrics, charts and evaluation_report.pdf. Negative station R2: {negative}/{len(h["by_station"])}.')

if __name__=='__main__':main()
