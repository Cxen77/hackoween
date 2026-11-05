/** River-connected stage scenarios. No discharge-to-stage or hydrodynamic claim. */
const neighbours = (i, n) => {
  const r = Math.floor(i / n), c = i % n, out = [];
  if (r) out.push(i - n); if (r < n - 1) out.push(i + n);
  if (c) out.push(i - 1); if (c < n - 1) out.push(i + 1);
  return out;
};
const median = values => {
  const sorted = values.slice().sort((a,b) => a-b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Rasterize actual OSM river ways, retaining only the nearest connected channel. */
export function channelMaskFromWays(elements, grid) {
  const {size:n,west,south,dx,dy} = grid;
  const mask = new Uint8Array(n*n);
  const cell = p => [(p.lon-west)/dx-.5,(p.lat-south)/dy-.5];
  for (const way of elements) {
    if (!way.geometry?.length) continue;
    const points=way.geometry.map(cell);
    const rings=[points,...(way.holes??[]).map(ring=>ring.map(cell))];
    const polygon=way.tags?.natural==='water' || way.tags?.waterway==='riverbank';
    // Scan-line filling keeps large, braided river polygons reasonably cheap.
    if (polygon && way.nodes?.[0]===way.nodes?.at(-1)) {
      for(let r=0;r<n;r++) {
        const crossings=[];
        for(const ring of rings)for(let j=0;j<ring.length-1;j++) {
          const [x1,y1]=ring[j], [x2,y2]=ring[j+1];
          if((y1>r)!==(y2>r)) crossings.push(x1+(r-y1)*(x2-x1)/(y2-y1));
        }
        crossings.sort((a,b)=>a-b);
        for(let j=0;j+1<crossings.length;j+=2)
          for(let c=Math.max(0,Math.ceil(crossings[j]));c<=Math.min(n-1,Math.floor(crossings[j+1]));c++)mask[r*n+c]=1;
      }
    }
    for(let j=0;j<points.length-1;j++) {
      const [x1,y1]=points[j], [x2,y2]=points[j+1];
      const steps=Math.ceil(Math.max(Math.abs(x2-x1),Math.abs(y2-y1))*2);
      // Ignore very remote full-way segments returned by Overpass.
      if(Math.max(x1,x2)<-1||Math.min(x1,x2)>n||Math.max(y1,y2)<-1||Math.min(y1,y2)>n)continue;
      for(let k=0;k<=steps;k++) {
        const t=steps?k/steps:0,c=Math.round(x1+(x2-x1)*t),r=Math.round(y1+(y2-y1)*t);
        if(r>=0&&r<n&&c>=0&&c<n)mask[r*n+c]=1;
      }
    }
  }
  const center=(n-1)/2;
  let closest=-1, distance=Infinity;
  for(let i=0;i<mask.length;i++)if(mask[i]) {
    const d=(i%n-center)**2+(Math.floor(i/n)-center)**2;
    if(d<distance){distance=d;closest=i;}
  }
  // Do not silently bind an arbitrary distant river to a non-river place.
  if(closest<0 || Math.sqrt(distance)*Math.sqrt(grid.cellArea)>1500)return null;
  const connected=new Uint8Array(n*n), queue=[closest];connected[closest]=1;
  for(let head=0;head<queue.length;head++) {
    const i=queue[head],r=Math.floor(i/n),c=i%n;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++) {
      const rr=r+dr,cc=c+dc,j=rr*n+cc;
      if(rr>=0&&rr<n&&cc>=0&&cc<n&&mask[j]&&!connected[j]){connected[j]=1;queue.push(j);}
    }
  }
  return {mask:connected,seed:closest};
}

/** Robust reach slope from mapped channel DEM samples, never floodplain peaks. */
function fitReachPlane(heights,n,points,seed) {
  const center=(n-1)/2;
  let a=0,b=0,offset=median(points.map(i=>heights[i]));
  // Iteratively weighted plane fit suppresses DEM canopy/bridge outliers.
  for(let iter=0;iter<4&&points.length>5;iter++) {
    const residuals=points.map(i=>heights[i]-offset-a*(i%n-center)-b*(Math.floor(i/n)-center));
    const scale=Math.max(.25,1.4826*median(residuals.map(Math.abs)));
    let sw=0,sx=0,sy=0,sz=0,sxx=0,syy=0,sxy=0,sxz=0,syz=0;
    points.forEach((i,k)=>{
      const x=i%n-center,y=Math.floor(i/n)-center,z=heights[i];
      const w=Math.min(1,1.5*scale/Math.max(Math.abs(residuals[k]),1e-9));
      sw+=w;sx+=w*x;sy+=w*y;sz+=w*z;sxx+=w*x*x;syy+=w*y*y;sxy+=w*x*y;sxz+=w*x*z;syz+=w*y*z;
    });
    const xx=sxx-sx*sx/sw+1e-5,yy=syy-sy*sy/sw+1e-5,xy=sxy-sx*sy/sw;
    const xz=sxz-sx*sz/sw,yz=syz-sy*sz/sw,det=xx*yy-xy*xy;
    a=(xz*yy-yz*xy)/det;b=(yz*xx-xz*xy)/det;offset=(sz-a*sx-b*sy)/sw;
  }
  if(points.length<6){a=0;b=0;offset=heights[seed];}
  return {offset,a,b};
}

function reachSurface(heights,n,channel,seed) {
  const points=[];
  for(let i=0;i<heights.length;i++)if(channel[i]&&Number.isFinite(heights[i]))points.push(i);
  const direction=fitReachPlane(heights,n,points,seed), center=(n-1)/2;
  const local=new Float32Array(heights.length), owner=new Int32Array(heights.length).fill(-1);
  // Follow local river bends and changes in slope; never extrapolate one plane
  // across an entire valley (which can put water tens of metres above its banks).
  for(const i of points){
    const r=Math.floor(i/n),c=i%n,near=[];
    for(let dr=-3;dr<=3;dr++)for(let dc=-3;dc<=3;dc++){
      const rr=r+dr,cc=c+dc,j=rr*n+cc;
      if(rr>=0&&rr<n&&cc>=0&&cc<n&&channel[j]&&Number.isFinite(heights[j]))near.push(j);
    }
    const fitted=fitReachPlane(heights,n,near,i);
    // Water pixels can be mixed with high riverbanks/bridge decks in the DEM.
    // Use the lower residual envelope, preserving a clean channel's actual slope.
    const residuals=near.map(j=>heights[j]-fitted.offset-fitted.a*(j%n-center)-fitted.b*(Math.floor(j/n)-center)).sort((a,b)=>a-b);
    const correction=near.length>=6?Math.min(0,residuals[Math.floor(residuals.length*.15)]??0):0;
    local[i]=fitted.offset+fitted.a*(c-center)+fitted.b*(r-center)+correction;owner[i]=i;
  }
  const distance=(i,s)=>s<0?Infinity:(i%n-s%n)**2+(Math.floor(i/n)-Math.floor(s/n))**2;
  // Two bidirectional Euclidean nearest-channel sweeps, independent of river stage.
  for(let pass=0;pass<2;pass++)for(const direction of [1,-1]){
    for(let rr=0;rr<n;rr++)for(let cc=0;cc<n;cc++){
      const r=direction>0?rr:n-1-rr,c=direction>0?cc:n-1-cc,i=r*n+c;
      if(channel[i])continue;
      for(const [dr,dc] of [[0,-direction],[-direction,-1],[-direction,0],[-direction,1]]){
        const y=r+dr,x=c+dc;
        if(y<0||y>=n||x<0||x>=n)continue;
        const candidate=owner[y*n+x];
        if(distance(i,candidate)<distance(i,owner[i]))owner[i]=candidate;
      }
    }
  }
  return {base:Float32Array.from(heights,(_,i)=>local[owner[i]]),a:direction.a,b:direction.b};
}

/** Precompute minimum river stage needed to cross every terrain saddle.
 * Multi-source minimax Dijkstra prevents flooding isolated low depressions.
 */
export function prepareRiverFlood(heights,size,channel,seed) {
  if(!Number.isInteger(size)||size<2||size*size!==heights.length||channel.length!==heights.length||
     !Number.isInteger(seed)||seed<0||seed>=heights.length||!channel[seed]||!Number.isFinite(heights[seed]))throw new Error('Invalid river grid');
  const surface=reachSurface(heights,size,channel,seed);
  const activation=new Float64Array(heights.length).fill(Infinity),heap=[];
  function push(i,cost){
    let j=heap.length;heap.push([i,cost]);
    while(j){const p=(j-1)>>1;if(heap[p][1]<=cost)break;heap[j]=heap[p];j=p;}heap[j]=[i,cost];
  }
  function pop(){
    const first=heap[0],last=heap.pop();
    if(heap.length){let j=0;while(j*2+1<heap.length){let c=j*2+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[j]=heap[c];j=c;}heap[j]=last;}
    return first;
  }
  let sources=0;
  for(let i=0;i<channel.length;i++)if(channel[i]&&Number.isFinite(heights[i])&&heights[i]<=surface.base[i]+.5){activation[i]=0;push(i,0);sources++;}
  if(!sources){activation[seed]=0;push(seed,0);}
  while(heap.length){
    const [i,cost]=pop();if(cost>activation[i]+1e-5)continue;
    for(const j of neighbours(i,size))if(Number.isFinite(heights[j])){
      const needed=Math.max(cost,heights[j]-surface.base[j],0);
      if(needed<activation[j]){activation[j]=needed;push(j,activation[j]);}
    }
  }
  return {...surface,activation,channel,size,seed,heights};
}

export function riverFloodAtStage(model,rise) {
  if(!Number.isFinite(rise)||rise<0)throw new Error('Invalid water rise');
  const depths=new Float32Array(model.heights.length);
  let floodedCells=0,maxDepth=0,boundaryReached=false;
  if(rise===0)return {depths,level:model.base[model.seed],floodedCells,maxDepth,boundaryReached};
  for(let i=0;i<depths.length;i++) {
    if(model.activation[i]>rise||!Number.isFinite(model.heights[i]))continue;
    const depth=Math.max(0,model.base[i]+rise-model.heights[i]);
    depths[i]=depth;
    if(depth>.02&&!model.channel[i]){
      floodedCells++;maxDepth=Math.max(maxDepth,depth);
      const r=Math.floor(i/model.size),c=i%model.size;
      if(!r||!c||r===model.size-1||c===model.size-1)boundaryReached=true;
    }
  }
  return {depths,level:model.base[model.seed]+rise,floodedCells,maxDepth,boundaryReached};
}

/** Clip triangles at the stage contour so a shoreline moves between grid cells. */
export function waterSurfaceMesh(model,rise) {
  const {size:n,activation,base,heights}=model,vertices=[];
  const vertex=i=>[i%n,Math.floor(i/n),base[i]+rise,Math.max(0,base[i]+rise-heights[i]),rise-activation[i]];
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  for(let r=0;r<n-1;r++)for(let c=0;c<n-1;c++){
    const i=r*n+c;
    for(const ids of [[i,i+1,i+n],[i+1,i+n+1,i+n]]) {
      let polygon=ids.map(vertex),clipped=[];
      for(let j=0;j<3;j++){
        const a=polygon[j],b=polygon[(j+1)%3],inside=a[4]>0,other=b[4]>0;
        if(inside)clipped.push(a);
        if(inside!==other&&Number.isFinite(a[4])&&Number.isFinite(b[4]))clipped.push(mix(a,b,a[4]/(a[4]-b[4])));
      }
      for(let j=1;j+1<clipped.length;j++)for(const v of [clipped[0],clipped[j],clipped[j+1]])vertices.push(...v.slice(0,4));
    }
  }
  return new Float32Array(vertices);
}

/** The river itself: the mapped channel drawn as shallow water at the reference level, whatever the stage. Flooding beyond the
 * channel comes only from waterSurfaceMesh. Each channel cell becomes a slightly oversized quad (so a one-cell-wide river is
 * visible) sitting just above the ground, because a 30 m terrain model cannot resolve the real channel bed. */
export function channelWaterMesh(model,depth=1.2,lift=.3,half=.9){
  const {size:n,channel,base,heights}=model,vertices=[];
  for(let i=0;i<channel.length;i++){
    if(!channel[i]||!Number.isFinite(heights[i]))continue;
    const c=i%n,r=Math.floor(i/n),z=Math.max(base[i],heights[i])+lift;
    const a=[c-half,r-half,z,depth],b=[c+half,r-half,z,depth],d=[c-half,r+half,z,depth],e=[c+half,r+half,z,depth];
    for(const v of [a,b,d,b,e,d])vertices.push(...v);
  }
  return new Float32Array(vertices);
}
