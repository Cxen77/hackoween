import { channelMaskFromWays, prepareRiverFlood, riverFloodAtStage, waterSurfaceMesh } from './river-flood.mjs';
import { mappedRiverWays } from './riverGeometry';
import type { FeatureCollection, Polygon, LineString } from 'geojson';

export type Grid = {
  heights: number[];
  size: number;
  west: number;
  south: number;
  dx: number;
  dy: number;
  seed: number;
  cellArea: number;
  span: number;
  riverModel: ReturnType<typeof prepareRiverFlood>;
  channelSource: 'OpenStreetMap river geometry' | 'Point-source fallback';
};

const tileCache = new Map<string, Promise<ImageData>>();

async function terrainTile(x: number, y: number, z: number): Promise<ImageData> {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(
      key,
      (async () => {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, {
          signal: AbortSignal.timeout(20000)
        });
        if (!r.ok) throw new Error(`Elevation service returned ${r.status}`);
        const bitmap = await createImageBitmap(await r.blob());
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, 256, 256);
      })().catch(e => {
        tileCache.delete(key);
        throw e;
      })
    );
  }
  return tileCache.get(key)!;
}

/**
 * Load high-resolution DEM grid covering a wide river corridor.
 * Real elevation plus mapped river geometry. Grid resolution is span / size.
 */
export async function loadGrid(lat: number, lon: number, span = 20000, size = 193): Promise<Grid> {
  const dy = span / 111320 / size;
  const dx = dy / Math.cos((lat * Math.PI) / 180);
  const west = lon - (dx * size) / 2;
  const south = lat - (dy * size) / 2;
  const ways = mappedRiverWays(west, south, west + dx * size, south + dy * size).catch(() => []);
  const z = 12;
  const n = 2 ** z;

  const points = Array.from({ length: size * size }, (_, i) => {
    const lng = west + ((i % size) + 0.5) * dx;
    const lt = south + (Math.floor(i / size) + 0.5) * dy;
    const tx = ((lng + 180) / 360) * n;
    const ty = ((1 - Math.asinh(Math.tan((lt * Math.PI) / 180)) / Math.PI) / 2) * n;
    return {
      x: Math.floor(tx),
      y: Math.floor(ty),
      px: Math.max(0, Math.min(255, (tx % 1) * 256 - .5)),
      py: Math.max(0, Math.min(255, (ty % 1) * 256 - .5))
    };
  });

  const keys = [...new Set(points.map(p => `${p.x},${p.y}`))];
  const tiles = new Map(
    await Promise.all(
      keys.map(async k => {
        const [x, y] = k.split(',').map(Number);
        return [k, await terrainTile(x, y, z)] as const;
      })
    )
  );

  const rawHeights = points.map(p => {
    const d = tiles.get(`${p.x},${p.y}`)!.data;
    const x = Math.floor(p.px), y = Math.floor(p.py), fx = p.px - x, fy = p.py - y;
    const sample = (xx: number, yy: number) => {
      const i = (Math.min(255, yy) * 256 + Math.min(255, xx)) * 4;
      return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
    };
    return sample(x,y)*(1-fx)*(1-fy)+sample(x+1,y)*fx*(1-fy)+sample(x,y+1)*(1-fx)*fy+sample(x+1,y+1)*fx*fy;
  });
  // Preserve barriers: arbitrary ridge removal can turn real banks into openings.
  const heights = rawHeights;

  // Snap seed to the local riverbed within ~350 m of the selected station marker
  let seed = Math.floor((size * size) / 2);
  const center = Math.floor(size / 2);
  const searchRadius = Math.max(3, Math.floor(size * 0.035));
  for (let row = center - searchRadius; row <= center + searchRadius; row++) {
    for (let col = center - searchRadius; col <= center + searchRadius; col++) {
      if ((row - center) ** 2 + (col - center) ** 2 > searchRadius ** 2) continue;
      const i = row * size + col;
      if (heights[i] < heights[seed]) seed = i;
    }
  }

  const geometry = channelMaskFromWays(await ways, { size, west, south, dx, dy, cellArea: (span / size) ** 2 });
  const channel = geometry?.mask ?? new Uint8Array(size * size);
  if (geometry) seed = geometry.seed;
  else channel[seed] = 1;
  const riverModel = prepareRiverFlood(heights, size, channel, seed);
  return { heights, size, west, south, dx, dy, seed, cellArea: (span / size) ** 2, span, riverModel,
    channelSource: geometry ? 'OpenStreetMap river geometry' : 'Point-source fallback' };
}

/**
 * Trace continuous boundary loops around wet cells.
 * Only outer boundaries and genuine islands are traced, with NO interior cell seams.
 */
function traceBoundaryLoops(isWet: (r: number, c: number) => boolean, size: number): [number, number][][] {
  const adj = new Map<string, [number, number][]>();
  const addEdge = (r1: number, c1: number, r2: number, c2: number) => {
    const k1 = `${r1},${c1}`;
    let list = adj.get(k1);
    if (!list) {
      list = [];
      adj.set(k1, list);
    }
    list.push([r2, c2]);
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isWet(r, c)) continue;
      if (!isWet(r - 1, c)) addEdge(r, c + 1, r, c);
      if (!isWet(r, c - 1)) addEdge(r, c, r + 1, c);
      if (!isWet(r + 1, c)) addEdge(r + 1, c, r + 1, c + 1);
      if (!isWet(r, c + 1)) addEdge(r + 1, c + 1, r, c + 1);
    }
  }

  const rings: [number, number][][] = [];
  for (const [startKey, neighbors] of adj) {
    while (neighbors.length > 0) {
      const ring: [number, number][] = [];
      const [sr, sc] = startKey.split(',').map(Number);
      let curr: [number, number] = [sr, sc];
      ring.push(curr);

      while (true) {
        const ck = `${curr[0]},${curr[1]}`;
        const nextList = adj.get(ck);
        if (!nextList || nextList.length === 0) break;
        const next = nextList.pop()!;
        ring.push(next);
        curr = next;
        if (curr[0] === sr && curr[1] === sc) break;
      }
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

/**
 * Multi-iteration Chaikin corner-smoothing algorithm.
 * Converts sharp pixel/staircase corners into smooth, fluid hydrodynamic curves.
 */
function smoothRing(ring: [number, number][], iterations = 3): [number, number][] {
  if (ring.length < 4) return ring;
  let pts = ring;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    const len = pts.length;
    for (let i = 0; i < len - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      next.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25]);
      next.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
    }
    next.push([next[0][0], next[0][1]]);
    pts = next;
  }
  return pts;
}

/** Signed area to distinguish outer boundaries from interior dry islands */
function ringSignedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][1] * ring[i + 1][0] - ring[i + 1][1] * ring[i][0];
  }
  return a / 2;
}

/**
 * Extract natural shorelines where water meets real terrain.
 * Strips away artificial segments along the outer perimeter of the grid bounding box,
 * completely eliminating any visible rectangular box outline!
 */
function extractNaturalShorelines(ring: [number, number][], size: number): [number, number][][] {
  const shorelines: [number, number][][] = [];
  let current: [number, number][] = [];
  const borderTol = 0.05;

  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    const onBorder =
      (p1[0] <= borderTol && p2[0] <= borderTol) ||
      (p1[0] >= size - borderTol && p2[0] >= size - borderTol) ||
      (p1[1] <= borderTol && p2[1] <= borderTol) ||
      (p1[1] >= size - borderTol && p2[1] >= size - borderTol);

    if (onBorder) {
      if (current.length >= 2) shorelines.push(current);
      current = [];
    } else {
      if (current.length === 0) current.push(p1);
      current.push(p2);
    }
  }
  if (current.length >= 2) shorelines.push(current);
  return shorelines;
}

export function floodFeatures(
  grid: Grid,
  rise: number
): {
  geojson: FeatureCollection<Polygon | LineString>;
  area: number;
  maxDepth: number;
  level: number;
  flowDirection: string;
  gradient: number;
  boundaryReached: boolean;
  surface: Float32Array;
} {
  const { depths, level, floodedCells, maxDepth, boundaryReached } = riverFloodAtStage(grid.riverModel, rise);
  const surface = waterSurfaceMesh(grid.riverModel, rise);
  const features: (FeatureCollection<Polygon>['features'][0] | FeatureCollection<LineString>['features'][0])[] = [];
  let wetCount = 0;
  const size = grid.size;

  for (let i = 0; i < depths.length; i++) {
    if (depths[i] > 0.02) {
      wetCount++;
    }
  }

  const {a,b} = grid.riverModel;
  const gradient = Math.hypot(a,b) / Math.sqrt(grid.cellArea) * 1000;
  const flowDirection = gradient < .01 ? 'Near-level reach' : Math.abs(a)>Math.abs(b)
    ? a>0 ? 'East → West' : 'West → East' : b>0 ? 'North → South' : 'South → North';

  if (wetCount === 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      area: 0,
      maxDepth: 0,
      level,
      flowDirection,
      gradient, boundaryReached, surface
    };
  }

  // Exact footprint for geofence intersection. The GPU mesh handles visual depth.
  const depthThresholds = [0.02];

  const toGeo = (r: number, c: number): [number, number] => [
    grid.west + c * grid.dx,
    grid.south + r * grid.dy
  ];

  for (const threshold of depthThresholds) {
    const isWet = (r: number, c: number) =>
      r >= 0 && r < size && c >= 0 && c < size && depths[r * size + c] > threshold;

    const rawRings = traceBoundaryLoops(isWet, size);
    if (!rawRings.length) continue;

    const outerRings: [number, number][][] = [];
    const holeRings: [number, number][][] = [];

    for (const raw of rawRings) {
      const area = ringSignedArea(raw);
      if (area < 0) {
        outerRings.push(raw);
      } else {
        holeRings.push(raw);
      }
    }

    // Smooth rings and convert to geographical coordinates
    for (const outer of outerRings) {
      const smoothed = outer;
      const geoOuter: [number, number][] = smoothed.map(pt => toGeo(pt[0], pt[1]));

      const geoHoles: [number, number][][] = [];
      for (const hole of holeRings) {
        // A dry island belongs only to the outer ring containing it.
        let inside = false;
        const [y,x] = hole[0];
        for (let i=0,j=outer.length-1;i<outer.length;j=i++) {
          const [yi,xi]=outer[i], [yj,xj]=outer[j];
          if ((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
        }
        if (!inside) continue;
        const smoothedHole = hole;
        geoHoles.push(smoothedHole.map(pt => toGeo(pt[0], pt[1])));
      }

      // Smooth continuous water surface polygon
      features.push({
        type: 'Feature',
        properties: {
          depth: threshold,
          threshold,
          maxDepth
        },
        geometry: {
          type: 'Polygon',
          coordinates: [geoOuter, ...geoHoles]
        }
      });

      // Natural shoreline glow (omits artificial bounding box edges)
      if (threshold === 0.02) {
        const naturalShorelines = extractNaturalShorelines(smoothed, size);
        for (const line of naturalShorelines) {
          if (line.length >= 2) {
            features.push({
              type: 'Feature',
              properties: { shoreline: true },
              geometry: {
                type: 'LineString',
                coordinates: line.map(pt => toGeo(pt[0], pt[1]))
              }
            });
          }
        }
      }
    }
  }

  return {
    geojson: { type: 'FeatureCollection', features: features as any },
    area: (floodedCells * grid.cellArea) / 1e6,
    maxDepth,
    level,
    flowDirection,
    gradient, boundaryReached, surface
  };
}
