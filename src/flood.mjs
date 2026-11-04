/** Connected static bathtub inundation. Elevations and stage are metres. No hydrodynamic claims. */
export function connectedFlood(elevations, size, seed, rise) {
  if(size*size!==elevations.length || seed<0 || seed>=elevations.length || !Number.isFinite(elevations[seed]) || !Number.isFinite(rise) || rise<0) throw new Error('Invalid elevation grid or water rise');
  const level=elevations[seed]+rise;
  const visited=new Uint8Array(elevations.length);
  const depths=new Float32Array(elevations.length);
  const queue=[seed]; visited[seed]=1;
  for(let head=0;head<queue.length;head++) {
    const i=queue[head]; const row=Math.floor(i/size); const col=i%size;
    if(!Number.isFinite(elevations[i]) || elevations[i]>level) continue;
    depths[i]=Math.max(0,level-elevations[i]);
    const neighbors=[];
    if(row>0) neighbors.push(i-size); if(row<size-1) neighbors.push(i+size);
    if(col>0) neighbors.push(i-1); if(col<size-1) neighbors.push(i+1);
    for(const j of neighbors) if(!visited[j]) {visited[j]=1;queue.push(j);}
  }
  return {depths,level};
}
