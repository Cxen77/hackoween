import { connectedFlood } from './flood.mjs';
import type { FeatureCollection, Polygon } from 'geojson';
export type Grid = { heights:number[]; size:number; west:number; south:number; dx:number; dy:number; seed:number; cellArea:number };
const tileCache = new Map<string,Promise<ImageData>>();
async function terrainTile(x:number,y:number,z:number) {
  const key=`${z}/${x}/${y}`;
  if(!tileCache.has(key)) tileCache.set(key,(async()=>{
    const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`,{signal:AbortSignal.timeout(20000)});
    if(!r.ok) throw new Error(`Elevation service returned ${r.status}`);
    const bitmap=await createImageBitmap(await r.blob()); const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,256,256);
  })().catch(e=>{tileCache.delete(key);throw e;}));
  return tileCache.get(key)!;
}
export async function loadGrid(lat:number,lon:number):Promise<Grid> {
  const size=65, span=5000, dy=span/111320/size, dx=dy/Math.cos(lat*Math.PI/180);
  const west=lon-dx*size/2,south=lat-dy*size/2,z=12,n=2**z;
  const points=Array.from({length:size*size},(_,i)=>{
    const lng=west+(i%size+0.5)*dx, lt=south+(Math.floor(i/size)+0.5)*dy;
    const tx=(lng+180)/360*n,ty=(1-Math.asinh(Math.tan(lt*Math.PI/180))/Math.PI)/2*n;
    return {x:Math.floor(tx),y:Math.floor(ty),px:Math.min(255,Math.floor((tx%1)*256)),py:Math.min(255,Math.floor((ty%1)*256))};
  });
  const keys=[...new Set(points.map(p=>`${p.x},${p.y}`))];
  const tiles=new Map(await Promise.all(keys.map(async k=>{const [x,y]=k.split(',').map(Number);return [k,await terrainTile(x,y,z)] as const;})));
  const heights=points.map(p=>{const d=tiles.get(`${p.x},${p.y}`)!.data, i=(p.py*256+p.px)*4;return d[i]*256+d[i+1]+d[i+2]/256-32768;});
  // Gauge coordinates often sit on a bank. Snap to the lowest nearby DEM cell within ~155 m.
  let seed=Math.floor(size*size/2);const center=Math.floor(size/2);
  for(let row=center-2;row<=center+2;row++)for(let col=center-2;col<=center+2;col++){
    if((row-center)**2+(col-center)**2>4)continue;
    const i=row*size+col;if(heights[i]<heights[seed])seed=i;
  }
  return {heights,size,west,south,dx,dy,seed,cellArea:(span/size)**2};
}
export function floodFeatures(grid:Grid,rise:number):{geojson:FeatureCollection<Polygon>;area:number;maxDepth:number;level:number} {
  const {depths,level}=connectedFlood(grid.heights,grid.size,grid.seed,rise);
  const features:FeatureCollection<Polygon>['features']=[];let maxDepth=0;
  for(let i=0;i<depths.length;i++) if(depths[i]>0.05){
    const x=grid.west+(i%grid.size)*grid.dx,y=grid.south+Math.floor(i/grid.size)*grid.dy,depth=depths[i];
    maxDepth=Math.max(maxDepth,depth);
    features.push({type:'Feature',properties:{depth},geometry:{type:'Polygon',coordinates:[[[x,y],[x+grid.dx,y],[x+grid.dx,y+grid.dy],[x,y+grid.dy],[x,y]]]}});
  }
  return {geojson:{type:'FeatureCollection',features},area:features.length*grid.cellArea/1e6,maxDepth,level};
}
