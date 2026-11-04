import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedFlood} from '../src/flood.mjs';
test('flood respects barriers and cannot reach isolated depressions',()=>{
 const {depths}=connectedFlood([0,9,0,0,9,0,0,9,0],3,3,2);
 assert.equal(depths[0],2);assert.equal(depths[2],0);assert.equal(depths[8],0);
});
test('flood spreads through a connected opening',()=>{
 const {depths}=connectedFlood([0,9,0,0,1,0,0,9,0],3,3,2);
 assert.equal(depths[5],2);assert.equal(depths[4],1);
});
test('grid edges do not wrap into next row',()=>{
 const {depths}=connectedFlood([9,9,0,0,9,9,9,9,9],3,2,1);
 assert.equal(depths[3],0);
});
test('invalid inputs fail explicitly',()=>{
 assert.throws(()=>connectedFlood([0],2,0,1));assert.throws(()=>connectedFlood([0],1,0,-1));
});
