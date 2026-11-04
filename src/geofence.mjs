const EPS=1e-10;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function onSegment(p,a,b){return Math.abs(cross(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
function segmentsIntersect(a,b,c,d){const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);return ((p>EPS&&q<-EPS)||(p<-EPS&&q>EPS))&&((r>EPS&&s<-EPS)||(r<-EPS&&s>EPS))||onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d);}
export function pointInRing(point,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];if(onSegment(point,a,b))return true;
  if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;
}
function bounds(ring){return ring.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);}
export function ringsIntersect(a,b){
 if(a.length<3||b.length<3)return false;
 const x=bounds(a),y=bounds(b);if(x[0]>y[2]||y[0]>x[2]||x[1]>y[3]||y[1]>x[3])return false;
 if(pointInRing(a[0],b)||pointInRing(b[0],a))return true;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(segmentsIntersect(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;
 return false;
}
export function validBoundary(ring){
 if(!Array.isArray(ring)||ring.length<3||ring.length>100||ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85))return false;
 let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<EPS)return false;area+=a[0]*b[1]-b[0]*a[1];}
 if(Math.abs(area)<EPS)return false;
 for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++){
  if(j===i+1||(i===0&&j===ring.length-1))continue;
  if(segmentsIntersect(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length]))return false;
 }return true;
}
export function validMonitor(area){return area&&typeof area.id==='string'&&typeof area.name==='string'&&area.name.trim().length>0&&area.name.length<=60&&validBoundary(area.ring)&&['scenario','gauge'].includes(area.basis)&&Number.isFinite(area.threshold)&&area.threshold>0&&area.threshold<=1000;}
/** Thresholds are metres. Gauge height is relative to its station datum, never scenario rise. */
export function evaluateMonitor(area,context){
 if(!validMonitor(area))return {id:area?.id,active:false,status:'Invalid boundary',height:null};
 if(area.basis==='scenario'){
  if(!context.scenarioEnabled)return {id:area.id,active:false,status:'Enable a flood scenario',height:null};
  const height=context.scenarioRise;
  if(!Number.isFinite(height)||height<area.threshold)return {id:area.id,active:false,status:'Below water-rise threshold',height};
  const touches=(context.floodFeatures??[]).some(f=>f.geometry?.type==='Polygon'&&ringsIntersect(area.ring,f.geometry.coordinates[0]));
  return {id:area.id,active:touches,status:touches?'Simulated flood entered boundary':'No simulated flood inside boundary',height};
 }
 const g=context.gauge;
 if(!g||!Number.isFinite(g.heightFeet))return {id:area.id,active:false,status:'Select a linked USGS height gauge',height:null};
 if(!pointInRing([g.lon,g.lat],area.ring))return {id:area.id,active:false,status:'Selected gauge is outside boundary',height:null};
 const age=context.now-Date.parse(g.time);
 if(!Number.isFinite(age)||age>2*3600000||age<-600000)return {id:area.id,active:false,status:'Gauge reading is stale or unavailable',height:null};
 const height=g.heightFeet*.3048,active=height>=area.threshold;
 return {id:area.id,active,status:active?'USGS gauge-height threshold reached':'Below gauge-height threshold',height};
}
