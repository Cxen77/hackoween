import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { Position } from 'geojson';

type Way = { tags: Record<string,string>; geometry: {lon:number;lat:number}[]; nodes?: number[]; holes?: {lon:number;lat:number}[][] };
const cache = new Map<string,Promise<Way[]>>();
let metadata: Promise<{tiles:string[]}> | undefined;

/** Read water geometry from the same OSM vector service as the map, even in satellite mode. */
export async function mappedRiverWays(west:number,south:number,east:number,north:number):Promise<Way[]> {
  const key=import.meta.env.VITE_GEOAPIFY_API_KEY;
  if(!metadata)metadata=(async()=>{
    if(!key){
      const response=await fetch('https://tiles.openfreemap.org/planet/latest',{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Map water geometry unavailable');
      return response.json();
    }
    const response=await fetch(`https://maps.geoapify.com/v1/styles/dark-matter/style.json?apiKey=${key}`,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Map water geometry unavailable');
    const style=await response.json();
    const source=Object.values(style.sources).find((s:any)=>s.type==='vector') as {url?:string;tiles?:string[]};
    if(source.tiles)return source;
    const info=await fetch(source.url!,{signal:AbortSignal.timeout(12000)});
    if(!info.ok)throw new Error('Water tile metadata unavailable');
    return info.json();
  })().catch(error=>{metadata=undefined;throw error;});
  const tilejson=await metadata;
  const z=11,n=2**z;
  const tx=(lon:number)=>Math.floor((lon+180)/360*n);
  const ty=(lat:number)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
  const tasks=[];
  for(let x=tx(west);x<=tx(east);x++)for(let y=ty(north);y<=ty(south);y++)tasks.push({x,y});
  const result:Way[]=[];
  const point=(p:Position)=>({lon:p[0],lat:p[1]});
  // At most four requests concurrently; cache tiles across slider changes and nearby reaches.
  for(let start=0;start<tasks.length;start+=4){
    const batch=await Promise.all(tasks.slice(start,start+4).map(({x,y})=>{
      const id=`${z}/${x}/${y}`;
      if(!cache.has(id))cache.set(id,(async()=>{
        const url=tilejson.tiles[0].replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y));
        const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('River tile unavailable');
        const tile=new VectorTile(new PbfReader(await response.arrayBuffer()));
        const ways:Way[]=[];
        for(const name of ['water','waterway']){
          const layer=tile.layers[name];if(!layer)continue;
          for(let i=0;i<layer.length;i++){
            const feature=layer.feature(i);
            if(name==='waterway'&&!['river','canal'].includes(String(feature.properties.class)))continue;
            const geometry=feature.toGeoJSON(x,y,z).geometry;
            if(geometry.type==='Polygon'||geometry.type==='MultiPolygon'){
              const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
              for(const rings of polygons)ways.push({tags:{natural:'water'},geometry:rings[0].map(point),holes:rings.slice(1).map(r=>r.map(point)),nodes:[0,0]});
            }else if(geometry.type==='LineString'||geometry.type==='MultiLineString'){
              const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
              for(const line of lines)ways.push({tags:{waterway:'river'},geometry:line.map(point)});
            }
          }
        }
        return ways;
      })().catch(error=>{cache.delete(id);throw error;}));
      return cache.get(id)!;
    }));
    batch.forEach(ways=>result.push(...ways));
  }
  while(cache.size>64)cache.delete(cache.keys().next().value!);
  return result;
}
