import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRiverFlood,riverFloodAtStage,waterSurfaceMesh,channelMaskFromWays} from '../src/river-flood.mjs';

test('water overtops banks before entering an isolated low depression',()=>{
  const n=5,h=Array.from({length:25},(_,i)=>[0,1,8,0,0][i%n]);
  const channel=Uint8Array.from(h,(_,i)=>+(i%n===0));
  const model=prepareRiverFlood(h,n,channel,10);
  const low=riverFloodAtStage(model,2),high=riverFloodAtStage(model,9);
  assert.equal(low.depths[11],1);assert.equal(low.depths[13],0);
  assert.equal(high.depths[13],9);
  assert.equal(riverFloodAtStage(model,0).floodedCells,0);
});

test('the full sloping channel rises together without inundating its banks too early',()=>{
  const n=7,h=Array.from({length:49},(_,i)=>Math.floor(i/n)*.5+(i%n===2?0:3));
  const channel=Uint8Array.from(h,(_,i)=>+(i%n===2));
  const model=prepareRiverFlood(h,n,channel,23);
  const result=riverFloodAtStage(model,2);
  for(let r=0;r<n;r++)assert.ok(Math.abs(result.depths[r*n+2]-2)<.01);
  assert.equal(result.floodedCells,0);
  assert.equal(riverFloodAtStage(model,4).floodedCells,42);
});

test('rising stage has monotonic extent and depth; dry land is not counted as river area',()=>{
  const n=9,h=Array.from({length:n*n},(_,i)=>Math.abs(i%n-4)*1.3+Math.floor(i/n)*.1);
  const channel=Uint8Array.from(h,(_,i)=>+(i%n===4));
  const model=prepareRiverFlood(h,n,channel,40);
  let previous=riverFloodAtStage(model,0);
  for(const rise of [.1,.5,1,2,4,8]){
    const current=riverFloodAtStage(model,rise);
    assert.ok(current.floodedCells>=previous.floodedCells);
    current.depths.forEach((d,i)=>assert.ok(d+1e-5>=previous.depths[i]));
    previous=current;
  }
  assert.equal(previous.floodedCells,72);
  assert.equal(previous.boundaryReached,true);
});

test('shoreline mesh interpolates between grid samples instead of adding blocky cells',()=>{
  const model=prepareRiverFlood([0,2,0,2],2,new Uint8Array([1,0,1,0]),0);
  const mesh=waterSurfaceMesh(model,1);
  assert.ok(mesh.length>0);
  const xs=Array.from(mesh).filter((_,i)=>i%4===0);
  assert.ok(xs.some(x=>Math.abs(x-.5)<1e-5));
  assert.ok(xs.every(x=>x<=.5+1e-5));
  assert.ok(Array.from(mesh).every(Number.isFinite));
});

test('river geometry keeps the nearby connected channel and rejects remote waterways',()=>{
  const grid={size:9,west:0,south:0,dx:.001,dy:.001,cellArea:10000};
  const geometry=[{tags:{waterway:'river'},geometry:[{lon:.0045,lat:.0005},{lon:.0045,lat:.0085}]}];
  const result=channelMaskFromWays(geometry,grid);
  assert.ok(result);assert.equal(result.mask.reduce((a,b)=>a+b,0),9);
  assert.equal(channelMaskFromWays([],grid),null);
});

test('invalid stages and missing terrain cannot become flooded water',()=>{
  const model=prepareRiverFlood([0,NaN,0,9],2,new Uint8Array([1,0,0,0]),0);
  assert.equal(riverFloodAtStage(model,20).depths[1],0);
  assert.throws(()=>riverFloodAtStage(model,-1));
  assert.throws(()=>prepareRiverFlood([0],2,new Uint8Array([1]),0));
});

test('a high bridge pixel cannot inject floodwater into neighbouring land',()=>{
  const n=9,h=Array.from({length:81},(_,i)=>i%n===4?0:6);
  h[40]=20;
  const channel=Uint8Array.from(h,(_,i)=>+(i%n===4));
  const model=prepareRiverFlood(h,n,channel,31);
  const result=riverFloodAtStage(model,1);
  assert.equal(result.floodedCells,0);
  assert.equal(result.depths[40],0);
  assert.ok(Math.abs(model.base[31])<.05);
});

test('a dry island is retained inside a mapped water polygon',()=>{
  const grid={size:9,west:0,south:0,dx:.001,dy:.001,cellArea:10000};
  const ring=(lo,hi)=>[[lo,lo],[hi,lo],[hi,hi],[lo,hi],[lo,lo]].map(([lon,lat])=>({lon,lat}));
  const result=channelMaskFromWays([{tags:{natural:'water'},nodes:[1,1],geometry:ring(.0005,.0085),holes:[ring(.0025,.0065)]}],grid);
  assert.ok(result);
  assert.equal(result.mask[40],0);
  assert.equal(result.mask[9],1);
});
