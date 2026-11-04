import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {prepareRiverFlood} from '../src/river-flood.mjs';

// Run the actual TypeScript GeoJSON adapter in Node; acquisition is not invoked.
let source=ts.transpileModule(readFileSync(new URL('../src/terrain.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
source=source.replace("'./river-flood.mjs'",JSON.stringify(new URL('../src/river-flood.mjs',import.meta.url).href));
source=source.replace(/^import .*mappedRiverWays.*\n/m,'const mappedRiverWays = () => Promise.resolve([]);\n');
const {floodFeatures}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('map adapter emits a filled polygon for connected wet land',()=>{
  const size=5,heights=new Array(25).fill(0),channel=new Uint8Array(25);channel[12]=1;
  const grid={size,heights,seed:12,west:0,south:0,dx:1,dy:1,span:5,cellArea:1,riverModel:prepareRiverFlood(heights,size,channel,12)};
  const result=floodFeatures(grid,1);
  assert.equal(result.area,24/1e6);
  const polygons=result.geojson.features.filter(f=>f.geometry.type==='Polygon');
  assert.ok(polygons.length>0,'wet area must produce a visible plan-view polygon');
  assert.ok(polygons[0].geometry.coordinates[0].length>=4);
});
