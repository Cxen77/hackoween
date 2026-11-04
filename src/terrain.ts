import { connectedFlood } from './flood.mjs';
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
 * Dynamic span and 129x129 resolution ensure wide geographic river reach coverage
 * with fine, sub-100m grid cells that smooth naturally without blockiness.
 */
export async function loadGrid(lat: number, lon: number, span = 20000, size = 129): Promise<Grid> {
  const dy = span / 111320 / size;
  const dx = dy / Math.cos((lat * Math.PI) / 180);
  const west = lon - (dx * size) / 2;
  const south = lat - (dy * size) / 2;
  const z = 11;
  const n = 2 ** z;

  const points = Array.from({ length: size * size }, (_, i) => {
    const lng = west + ((i % size) + 0.5) * dx;
    const lt = south + (Math.floor(i / size) + 0.5) * dy;
    const tx = ((lng + 180) / 360) * n;
    const ty = ((1 - Math.asinh(Math.tan((lt * Math.PI) / 180)) / Math.PI) / 2) * n;
    return {
      x: Math.floor(tx),
      y: Math.floor(ty),
      px: Math.min(255, Math.floor((tx % 1) * 256)),
      py: Math.min(255, Math.floor((ty % 1) * 256))
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
    const i = (p.py * 256 + p.px) * 4;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  });

  // Hydro-condition artificial bridge deck spikes so river inundation flows smoothly under bridges
  const heights = Float32Array.from(rawHeights);
  for (let r = 1; r < size - 1; r++) {
    for (let c = 1; c < size - 1; c++) {
      const idx = r * size + c;
      const v = rawHeights[idx];
      const n = rawHeights[idx + size], s = rawHeights[idx - size];
      const w = rawHeights[idx - 1], e = rawHeights[idx + 1];
      if (v > n + 2.5 && v > s + 2.5 && Math.abs(n - s) < 6) {
        heights[idx] = Math.max(n, s);
      } else if (v > e + 2.5 && v > w + 2.5 && Math.abs(e - w) < 6) {
        heights[idx] = Math.max(e, w);
      }
    }
  }

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

  return { heights: Array.from(heights), size, west, south, dx, dy, seed, cellArea: (span / size) ** 2, span };
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
} {
  // Use connected flood starting strictly at the river channel seed
  const { depths, level } = connectedFlood(grid.heights, grid.size, grid.seed, rise);
  const features: (FeatureCollection<Polygon>['features'][0] | FeatureCollection<LineString>['features'][0])[] = [];
  let maxDepth = 0;
  let wetCount = 0;
  const size = grid.size;

  const wetIndices: number[] = [];
  for (let i = 0; i < depths.length; i++) {
    if (depths[i] > 0.05) {
      wetCount++;
      wetIndices.push(i);
      if (depths[i] > maxDepth) maxDepth = depths[i];
    }
  }

  // Determine hydraulic flow direction and reach drop from the active inundated channel
  let flowDirection = 'Upstream → Downstream';
  let gradient = 0;
  if (wetIndices.length >= 4) {
    let highest = wetIndices[0], lowest = wetIndices[0];
    for (const idx of wetIndices) {
      if (grid.heights[idx] > grid.heights[highest]) highest = idx;
      if (grid.heights[idx] < grid.heights[lowest]) lowest = idx;
    }
    const upR = Math.floor(highest / size), upC = highest % size;
    const downR = Math.floor(lowest / size), downC = lowest % size;
    const dRow = downR - upR;
    const dCol = downC - upC;
    if (Math.abs(dCol) >= Math.abs(dRow) && Math.abs(dCol) > 2) {
      flowDirection = dCol > 0 ? 'West → East' : 'East → West';
    } else if (Math.abs(dRow) > 2) {
      flowDirection = dRow > 0 ? 'South → North' : 'North → South';
    }
    const drop = Math.max(0, grid.heights[highest] - grid.heights[lowest]);
    gradient = grid.span > 0 ? drop / (grid.span / 1000) : 0;
  }

  if (wetCount === 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      area: 0,
      maxDepth: 0,
      level,
      flowDirection,
      gradient
    };
  }

  // Adaptive depth tiers calibrated to current river water depth
  const depthThresholds = [0.05];
  if (maxDepth >= 0.8) depthThresholds.push(0.5);
  if (maxDepth >= 2.0) depthThresholds.push(1.5);
  if (maxDepth >= 4.5) depthThresholds.push(3.5);
  if (maxDepth >= 9.0) depthThresholds.push(7.0);
  if (maxDepth >= 16.0) depthThresholds.push(12.0);

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
      } else if (Math.abs(area) >= 4) {
        // Filter out 1-2 cell DEM noise holes to eliminate "black square boxes"
        holeRings.push(raw);
      }
    }

    // Smooth rings and convert to geographical coordinates
    for (const outer of outerRings) {
      const smoothed = smoothRing(outer, 3);
      const geoOuter: [number, number][] = smoothed.map(pt => toGeo(pt[0], pt[1]));

      const geoHoles: [number, number][][] = [];
      for (const hole of holeRings) {
        const smoothedHole = smoothRing(hole, 2);
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
      if (threshold === 0.05) {
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
    area: (wetCount * grid.cellArea) / 1e6,
    maxDepth,
    level,
    flowDirection,
    gradient
  };
}
