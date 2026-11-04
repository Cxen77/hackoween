/** Create an editable five-slide presentation from measured experiment reports. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=process.cwd();
const runtime=process.env.CODEX_RUNTIME_DEPENDENCIES || 'C:/Users/Dev/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=path.join(runtime,'node/node_modules');
const require=createRequire(import.meta.url);
const artifactPath=require.resolve('@oai/artifact-tool',{paths:[path.join(runtime,'node/node_modules')]});
const {Presentation,PresentationFile}=await import(pathToFileURL(artifactPath).href);
const skill=process.env.CODEX_PRESENTATION_SKILL || 'C:/Users/Dev/.codex/plugins/cache/openai-primary-runtime/presentations/26.1030.10813/skills/presentations';
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const metrics=JSON.parse(await fs.readFile('reports/metrics.json','utf8'));
const holdout=JSON.parse(await fs.readFile('reports/demo_holdout.json','utf8'));
const provenance=JSON.parse(await fs.readFile('reports/provenance.json','utf8'));
const catchments=JSON.parse(await fs.readFile('reports/catchment_provenance.json','utf8'));
const p=Presentation.create({slideSize:{width:1280,height:720}});
p.theme.defaultFont='Arial';
const staging=path.join(root,'.presentation-build');const out=path.join(root,'presentation');
await fs.mkdir(staging,{recursive:true});await fs.mkdir(out,{recursive:true});
const fmt=(v,d=0)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(v);
function text(slide,value,x,y,w,h,size=27,color='#355763',bold=false){
  const shape=slide.shapes.add({geometry:'textbox',name:value.slice(0,45),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  shape.text=value;shape.text.style={fontFamily:'Arial',fontSize:size,color,bold};return shape;
}
function slide(title){const s=p.slides.add();s.background.fill='#F6FAFA';text(s,title,72,58,1136,90,44,'#174B59',true);return s;}
function note(s,value){s.speakerNotes.text=value;}

let s=p.slides.add();s.background.fill='#123D4B';
text(s,'FLOODCAST',72,85,1120,100,76,'#FFFFFF',true);
text(s,'Predict daily river discharge',76,215,1080,75,45,'#7BDEDA');
text(s,'A regression model using weather and basin characteristics, with an interactive river map for exploring observations and scenarios.',76,330,1020,140,31,'#D8E8EC');
text(s,'Public-data experiment · November 2026\nTeam member names pending confirmation',76,574,1050,70,21,'#B9D1D8');
note(s,'Challenge source: FLOODCAST Participant Problem Statement, November 2026, supplied by user. Official event train/test CSVs were not supplied. This presentation reports a public-data experiment only. Team name is a working project name; actual member names must be completed before submission.');

s=slide('Three public data sources');
text(s,`${fmt(provenance.train_rows+provenance.test_rows)} daily records`,72,165,1120,65,42,'#068995',true);
text(s,`${provenance.stations.length} stations · ${provenance.period[0]} to ${provenance.period[1]}`,75,232,1100,45,25);
const rows=[['USGS discharge','Observed daily mean river flow in cfs; actual station metadata.'],['Open-Meteo weather','Precipitation, min/max temperature and soil moisture from reanalysis.'],['USGS StreamStats','Published drainage area, basin elevation, forest cover and slope where available.']];
rows.forEach((r,i)=>{text(s,r[0],75,320+i*92,315,55,27,'#174B59',true);text(s,r[1],405,320+i*92,795,75,25);});
text(s,'Daily mean is the public experiment target; confirm the event definition of “peak daily discharge.”',75,640,1120,42,18,'#6C858E');
note(s,`Sources: https://waterservices.usgs.gov/ ; https://open-meteo.com/en/docs/historical-weather-api ; https://www.usgs.gov/streamstats/web-services . Exact acquisition and station coverage: reports/provenance.json and reports/catchment_provenance.json. Static attributes were obtained from the StreamStats Gage Statistics Services; flow statistics were excluded. Coverage: ${JSON.stringify(catchments.coverage_stations)}.`);

s=slide('Weather, basin features, and time');
text(s,'Features',74,173,300,45,29,'#068995',true);
text(s,'Rainfall and soil moisture, temperatures, physical basin attributes, seasonal terms, and preceding 3/7/14/30-day rainfall.',390,173,810,110,28);
text(s,'Models',74,321,300,45,29,'#068995',true);
text(s,'Gradient boosting and ExtraTrees on raw, log, and drainage-normalized discharge. Imputation learns from training rows only.',390,321,810,110,28);
text(s,'Validation',74,470,300,45,29,'#068995',true);
text(s,`Hold out later dates and complete stations. Freeze model selection before the separate ${holdout.period[0].slice(0,4)} holdout. No test discharge inputs.`,390,470,810,125,28);
text(s,`Selected model: ${metrics.selected_model} · ${fmt(metrics.train_rows)} training rows`,74,645,1120,38,20,'#6C858E');
note(s,'Source: solution.py, reports/metrics.json. Station identity and all target-derived statistics are excluded from model inputs. Rainfall windows use closed-left time windows. Selection is weighted baseline-relative validation error averaged across temporal and geographic splits, not the official leaderboard normalization.');

s=slide('Measured regression performance');
const selected=metrics.validation[metrics.selected_model];
const values=[['Evaluation','RMSE (cfs)','Peak RMSE*','MAE (cfs)','R²'],
 ['Later dates',fmt(selected.future_dates.model.rmse),fmt(selected.future_dates.model.extreme_rmse),fmt(selected.future_dates.model.mae),fmt(selected.future_dates.model.r2,3)],
 ['Unseen stations',fmt(selected.unseen_station_future_dates.model.rmse),fmt(selected.unseen_station_future_dates.model.extreme_rmse),fmt(selected.unseen_station_future_dates.model.mae),fmt(selected.unseen_station_future_dates.model.r2,3)],
 [`${holdout.period[0].slice(0,4)} holdout`,fmt(holdout.overall.rmse),fmt(holdout.overall.extreme_rmse),fmt(holdout.overall.mae),fmt(holdout.overall.r2,3)]];
const table=s.tables.add({rows:4,columns:5,left:72,top:196,width:1136,height:272,columnWidths:[320,215,215,215,171],values});
table.borders.assign({fill:'#D9E5E7',width:1,style:'solid'});
for(let r=0;r<4;r++)for(let c=0;c<5;c++){
 const cell=table.getCell(r,c);cell.fill=r===0?'#E0EFF0':'#F6FAFA';cell.text.style={fontFamily:'Arial',fontSize:r===0?23:25,color:'#244F5C',bold:r===0};
}
text(s,`Holdout station-median baseline RMSE: ${fmt(holdout.training_station_median_baseline.rmse)} cfs`,75,510,1115,55,27);
text(s,'*Extreme-event RMSE: actual discharge in the top 10% within each station. Public experiment results; not official competition scores.',75,594,1100,75,21,'#6C858E');
note(s,'Evidence: reports/metrics.json and reports/demo_holdout.json. Holdout actuals are read only by scripts/evaluate_holdout.py, after model training and selection. Metric units are cfs except dimensionless R². Negative R² values represent poor generalization and must remain visible. The official score depends on organizer normalization and hidden targets; it cannot be calculated here.');

s=slide('Limitations and submission readiness');
text(s,'Flood peaks and unseen basins remain difficult',74,170,1120,55,31,'#068995',true);
text(s,'Gauge-point reanalysis does not represent every part of a large basin. Reservoir operations and incomplete basin attributes can limit accuracy.',74,243,1100,105,28);
text(s,'A scenario is not a hydraulic forecast',74,375,1120,55,31,'#068995',true);
text(s,'The 3D flood overlay is an elevation-based exploration. It is separate from predicted discharge and omits channel hydraulics and flood defenses.',74,448,1100,100,28);
text(s,'Before the official submission',74,582,1120,40,26,'#174B59',true);
text(s,'Confirm the target and team names. Run against official test rows. Validate the generated CSV; do not edit predictions by hand.',74,634,1100,65,23);
note(s,'Challenge rejection rules: exact station_id,date,discharge_cfs columns in order, every test row, finite nonnegative predictions, UTF-8, code-generated output, no test target leakage. Current predictions.csv covers the public experiment, not the absent event test set. Additional limitations: model_card.md. Simulation method: src/flood.mjs and src/terrain.ts.');

for(const [i,sl] of p.slides.items.entries()){
 const bytes=await p.export({slide:sl,format:'png',scale:1});await fs.writeFile(path.join(staging,`slide-${i+1}.png`),new Uint8Array(await bytes.arrayBuffer()));
}
const candidatePath=path.join(staging,'candidate.pptx');await(await PresentationFile.exportPptx(p)).save(candidatePath);
await finalizePresentation({workspaceDir:root,candidatePath,finalPath:path.join(out,'FLOODCAST.pptx'),
 pythonExecutable:path.join(runtime,'python/python.exe'),
 integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','4'],
 explicitTotalSlideCount:5,requiredNativeTableOwnerSlides:[4],fontPolicy:{basis:'design',families:['Arial']},
 verifyArtifactToolImport:true,receiptPath:path.join(staging,'validation.json')});
try{
 const pdf=await p.export({format:'pdf'});await fs.writeFile(path.join(out,'FLOODCAST.pdf'),new Uint8Array(await pdf.arrayBuffer()));
}catch(error){
 // The portable artifact runtime may lack pdf-lib's standard-font aliases. Preserve the
 // editable PPTX and assemble already rendered slides as an image-backed presentation PDF.
 const conversion=spawnSync(path.join(runtime,'python/python.exe'),['-c',
  'from PIL import Image; from pathlib import Path; import sys; src=Path(sys.argv[1]); pages=[Image.open(src/f"slide-{i}.png").convert("RGB") for i in range(1,6)]; pages[0].save(sys.argv[2],save_all=True,append_images=pages[1:],resolution=96)',staging,path.join(out,'FLOODCAST.pdf')],{encoding:'utf8'});
 if(conversion.status!==0)throw new Error(`PDF fallback failed: ${conversion.stderr}`,{cause:error});
 console.log('PDF assembled from verified slide renders; PPTX remains editable.');
}
console.log('Created five-slide presentation PDF and editable PPTX. Inspect .presentation-build/slide-1.png through slide-5.png before delivery.');
