import test from 'node:test';
import assert from 'node:assert/strict';
import {pointInRing,ringsIntersect,validBoundary,evaluateMonitor} from '../src/geofence.mjs';
const ring=[[0,0],[2,0],[2,2],[0,2]],area={id:'a',name:'Test',ring,basis:'scenario',threshold:3};
const feature=r=>({geometry:{type:'Polygon',coordinates:[[...r,r[0]]]}});
test('point containment includes boundaries',()=>{assert.equal(pointInRing([1,1],ring),true);assert.equal(pointInRing([0,1],ring),true);assert.equal(pointInRing([3,1],ring),false);});
test('intersection catches crossing edges, containment and boundary contact',()=>{
 assert.equal(ringsIntersect(ring,[[1,-1],[3,1],[1,3],[-1,1]]),true);
 assert.equal(ringsIntersect(ring,[[.5,.5],[1,.5],[1,1]]),true);
 assert.equal(ringsIntersect(ring,[[2,0],[3,0],[3,1],[2,1]]),true);
 assert.equal(ringsIntersect(ring,[[3,3],[4,3],[4,4]]),false);
});
test('invalid and self-crossing boundaries are rejected',()=>{assert.equal(validBoundary(ring),true);assert.equal(validBoundary([[0,0],[2,2],[0,2],[2,0]]),false);assert.equal(validBoundary([[0,0],[1,1],[2,2]]),false);});
test('scenario requires BOTH spatial overlap and water-rise threshold',()=>{
 const context={scenarioEnabled:true,scenarioRise:3,floodFeatures:[feature(ring)]};
 assert.equal(evaluateMonitor(area,context).active,true);
 assert.equal(evaluateMonitor(area,{...context,scenarioRise:2.9}).active,false);
 assert.equal(evaluateMonitor(area,{...context,floodFeatures:[]}).active,false);
 assert.equal(evaluateMonitor(area,{...context,scenarioEnabled:false}).active,false);
});
test('gauge alerts convert feet to metres, require containment and reject stale readings',()=>{
 const now=Date.now(),a={...area,basis:'gauge',threshold:1};
 const gauge={heightFeet:4,lon:1,lat:1,time:new Date(now).toISOString()};
 assert.equal(evaluateMonitor(a,{gauge,now}).active,true);
 assert.equal(evaluateMonitor(a,{gauge:{...gauge,heightFeet:3},now}).active,false);
 assert.equal(evaluateMonitor(a,{gauge:{...gauge,lon:4},now}).active,false);
 assert.equal(evaluateMonitor(a,{gauge:{...gauge,time:new Date(now-3*3600000).toISOString()},now}).active,false);
 assert.equal(evaluateMonitor(a,{gauge:null,now}).active,false);
});
