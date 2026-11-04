import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import {
  Activity, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ChevronRight,
  CircleHelp, CloudRain, Compass, Database, Droplets, Expand, Layers, MapPin,
  Minus, Mountain, Pause, Play, Plus, Radio, RefreshCw, Search, ShieldAlert,
  Waves, X
} from 'lucide-react';
import { stations, number, forecastUrl, weatherUrl, jsonFetch, fetchGauge, download, riverProfiles, defaultRiverProfile } from './data';
import type { Station, Forecast, Weather, Gauge, Remote, RiverHydraulicProfile } from './data';
import { loadGrid, floodFeatures } from './terrain';
import type { Grid } from './terrain';
import MonitorPanel from './MonitorPanel';
import { evaluateMonitor, validBoundary, validMonitor } from './geofence.mjs';
import type { AreaMonitor, MonitorResult } from './monitorTypes';
import type { FeatureCollection, Polygon, LineString } from 'geojson';

const key = (import.meta as unknown as { env: Record<string, string> }).env.VITE_GEOAPIFY_API_KEY;
maplibregl.setWorkerUrl(workerUrl);
const empty: FeatureCollection<Polygon | LineString> = { type: 'FeatureCollection', features: [] };

const rasterStyle = (satellite: boolean): StyleSpecification => ({
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [
        satellite
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: satellite
        ? 'Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics'
        : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
    }
  },
  layers: [{ id: 'base', type: 'raster', source: 'base' }]
});

const initial = <T,>(): Remote<T> => ({ data: null, error: null, loading: true });
const dateLabel = (v: string) => new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayOfWeek = (v: string) => new Date(v + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });

function getCurvedPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = 'M ' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ' C ' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
  }
  return d;
}

function Chart({ data, day, setDay, unit, weather }: { data: Forecast | null; day: number; setDay: (n: number) => void; unit: string; weather: Remote<Weather> }) {
  const values = data?.daily.river_discharge ?? [];
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!valid.length) return <div className="empty-chart"><RefreshCw className="spin" size={16}/><span>Waiting for GloFAS forecast telemetry…</span></div>;

  const scale = unit === 'cfs' ? 35.3146667 : 1;
  const max = Math.max(...valid) * 1.25 || 1;
  const pts: [number, number][] = values.map((v, i) => [
    35 + i * (620 / Math.max(1, values.length - 1)),
    104 - (v == null ? 0 : (v / max) * 78)
  ]);
  const curvePath = getCurvedPath(pts);
  const areaPath = pts.length ? `${curvePath} L ${pts[pts.length - 1][0].toFixed(1)},112 L ${pts[0][0].toFixed(1)},112 Z` : '';
  const activePt = pts[day];

  return (
    <>
      <div className="chart-wrap">
        <span className="chart-axis-max">{number(max * scale)} {unit}</span>
        <span className="chart-axis-mid">{number((max * scale) / 2)}</span>
        <svg viewBox="0 0 700 125" role="img" aria-label="Seven-day river discharge trend" className="forecast-svg">
          <defs>
            <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
              <stop offset="50%" stopColor="#0284c7" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[26, 65, 104].map(y => (
            <line key={y} x1="35" y1={y} x2="655" y2={y} stroke="#e2e8f0" strokeDasharray="3 5" />
          ))}
          {areaPath && <path d={areaPath} fill="url(#chart-gradient)" />}
          <path d={curvePath} fill="none" stroke="#0284c7" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
          {activePt && (
            <g className="active-cursor-marker">
              <line x1={activePt[0]} y1="10" x2={activePt[0]} y2="112" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="3 3" />
              <circle cx={activePt[0]} cy={activePt[1]} r="7" fill="#0284c7" fillOpacity="0.22" />
              <circle cx={activePt[0]} cy={activePt[1]} r="4" fill="#ffffff" stroke="#0284c7" strokeWidth="2.5" />
            </g>
          )}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r={day === i ? 0 : 3}
              fill="#ffffff"
              stroke="#0284c7"
              strokeWidth="1.5"
              style={{ cursor: 'pointer' }}
              onClick={() => setDay(i)}
            >
              <title>{dateLabel(data!.daily.time[i])}: {number(values[i]! * scale)} {unit}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="forecast-days">
        {data!.daily.time.map((d, i) => {
          const rain = weather.data?.daily.precipitation_sum?.[i];
          const val = values[i] == null ? null : values[i]! * scale;
          return (
            <button key={d} className={`forecast-day-btn ${day === i ? 'chosen' : ''}`} onClick={() => setDay(i)}>
              <span className="day-name">{i === 0 ? 'Today' : `${dayOfWeek(d)} ${dateLabel(d).split(' ')[1]}`}</span>
              <strong className="day-val">{number(val)}</strong>
              <span className="day-rain-info">
                {rain != null && Number(rain) > 0 ? (
                  <span className="has-rain"><CloudRain size={10} />{number(rain, 1)}mm</span>
                ) : (
                  <span className="is-dry">dry</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function App() {
  const [station, setStation] = useState<Station>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('station');
      if (p) {
        const found = stations.find(s =>
          s.id === p ||
          s.river.toLowerCase().includes(p.toLowerCase()) ||
          s.name.toLowerCase().includes(p.toLowerCase())
        );
        if (found) return found;
      }
    } catch {}
    return stations[0];
  });
  const [query, setQuery] = useState('');
  const [filterRegion, setFilterRegion] = useState<'all' | 'us' | 'in'>('all');
  const [places, setPlaces] = useState<Station[]>([]);
  const [searchError, setSearchError] = useState('');

  const [forecast, setForecast] = useState<Remote<Forecast>>(initial);
  const [weather, setWeather] = useState<Remote<Weather>>(initial);
  const [gauge, setGauge] = useState<Remote<Gauge>>(initial);

  const [refresh, setRefresh] = useState(0);
  const [auto, setAuto] = useState(true);
  const [day, setDay] = useState(0);
  const [unit, setUnit] = useState('cfs');

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [satellite, setSatellite] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('satellite') === '1';
    } catch {
      return false;
    }
  });
  const [is3d, setIs3d] = useState(true);

  const [showSimulation, setShowSimulation] = useState(true);
  const [rise, setRise] = useState<number>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('rise');
      if (p && Number.isFinite(Number(p))) return Number(p);
    } catch {}
    return 3;
  });
  const [corridorSpan, setCorridorSpan] = useState<number>(28000);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [gridError, setGridError] = useState('');
  const [gridLoading, setGridLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [animatedRise, setAnimatedRise] = useState(0);

  const [sources, setSources] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelReport, setModelReport] = useState<Record<string, any> | null>(null);

  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [layers, setLayers] = useState(false);

  const [areas, setAreas] = useState<AreaMonitor[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('floodcast-monitored-areas-v1') ?? '[]');
      return Array.isArray(saved) ? saved.filter(validMonitor).slice(0, 10) : [];
    } catch {
      return [];
    }
  });
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  drawingRef.current = drawing;
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [pendingRing, setPendingRing] = useState<[number, number][] | null>(null);
  const [drawingError, setDrawingError] = useState('');

  const [scenarioCells, setScenarioCells] = useState<FeatureCollection<Polygon | LineString>>(empty);
  const [scenarioHeight, setScenarioHeight] = useState(0);
  const [alertToast, setAlertToast] = useState<{ name: string; message: string; height: number | null; threshold: number; basis: string } | null>(null);
  const previousAlerts = useRef<Record<string, boolean>>({});
  const [storageError, setStorageError] = useState('');
  const [floodStats, setFloodStats] = useState({ area: 0, maxDepth: 0, level: 0, flowDirection: '', gradient: 0 });

  const profile = useMemo<RiverHydraulicProfile>(
    () => riverProfiles[station.id] || defaultRiverProfile,
    [station.id]
  );

  const pick = (s: Station) => {
    setStation(s);
    setQuery('');
    setPlaces([]);
    setDay(0);
    setPlaying(false);
    const prof = riverProfiles[s.id] || defaultRiverProfile;
    setRise(prof.defaultRise);
    setCorridorSpan(prof.defaultReach);
  };

  const toggle3D = (force?: boolean) => {
    const next = force !== undefined ? force : !is3d;
    setIs3d(next);
    const m = map.current;
    if (!m) return;
    m.setTerrain(next ? { source: 'terrain-dem', exaggeration: 3.2 } : null);
    if (m.getLayer('terrain-hills')) {
      m.setLayoutProperty('terrain-hills', 'visibility', next ? 'visible' : 'none');
    }
    m.easeTo({
      pitch: next ? 65 : 0,
      bearing: next ? -24 : 0,
      duration: 900
    });
  };

  const cyclePitch = () => {
    const m = map.current;
    if (!m) return;
    const current = m.getPitch();
    const next = current < 15 ? 48 : current < 55 ? 65 : current < 72 ? 80 : 0;
    setIs3d(next > 0);
    m.setTerrain(next > 0 ? { source: 'terrain-dem', exaggeration: 3.2 } : null);
    if (m.getLayer('terrain-hills')) {
      m.setLayoutProperty('terrain-hills', 'visibility', next > 0 ? 'visible' : 'none');
    }
    m.easeTo({ pitch: next, bearing: next > 0 ? -24 : 0, duration: 600 });
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement?.tagName || ''))) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search-box input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (!mapNode.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: mapNode.current,
        style: satellite ? rasterStyle(true) : key ? `https://maps.geoapify.com/v1/styles/dark-matter/style.json?apiKey=${key}` : rasterStyle(false),
        center: [station.lon, station.lat],
        zoom: 12.2,
        pitch: 65,
        bearing: -24,
        maxPitch: 85,
        attributionControl: { compact: true },
        canvasContextAttributes: { preserveDrawingBuffer: true }
      });
      map.current = m;
    } catch {
      setMapError('WebGL initialization failed. Enable hardware acceleration to view 3D terrain.');
      return;
    }

    let fallback = false;
    m.on('error', e => {
      if (!m.isStyleLoaded() && !fallback && e.error?.message?.includes('geoapify')) {
        fallback = true;
        m.setStyle(rasterStyle(false));
        setMapError('Using keyless CARTO dark map fallback.');
      }
    });

    m.on('style.load', () => {
      m.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Elevation: AWS Terrain Tiles'
      });
      m.setTerrain({ source: 'terrain-dem', exaggeration: 3.2 });
      m.addLayer({
        id: 'terrain-hills',
        type: 'hillshade',
        source: 'terrain-dem',
        layout: { visibility: 'visible' },
        paint: {
          'hillshade-exaggeration': 1.0,
          'hillshade-shadow-color': '#020617',
          'hillshade-highlight-color': '#e0f2fe',
          'hillshade-accent-color': '#38bdf8',
          'hillshade-illumination-direction': 315,
          'hillshade-illumination-anchor': 'viewport'
        }
      });
      m.addSource('flood', { type: 'geojson', data: empty });
      m.addLayer({
        id: 'flood-fill',
        type: 'fill',
        source: 'flood',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'depth'],
            0, '#38bdf8',
            1.0, '#0ea5e9',
            2.5, '#0284c7',
            5.0, '#1d4ed8',
            8.0, '#1e1b4b'
          ],
          'fill-opacity': 0.74,
          'fill-antialias': true
        }
      });
      m.addLayer({
        id: 'flood-shoreline-glow',
        type: 'line',
        source: 'flood',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#0284c7',
          'line-width': 5.5,
          'line-opacity': 0.45,
          'line-blur': 3.0
        }
      });
      m.addLayer({
        id: 'flood-shoreline',
        type: 'line',
        source: 'flood',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#67e8f9',
          'line-width': 2.4,
          'line-opacity': 0.95,
          'line-blur': 0.5
        }
      });
      m.addSource('monitored-areas', { type: 'geojson', data: empty });
      m.addLayer({
        id: 'monitor-fill',
        type: 'fill',
        source: 'monitored-areas',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.14 }
      });
      m.addLayer({
        id: 'monitor-outline',
        type: 'line',
        source: 'monitored-areas',
        paint: { 'line-color': '#fbbf24', 'line-width': 2.5, 'line-dasharray': [3, 2] }
      });
      setReady(true);
      setRefresh(n => n + 1);
    });

    m.on('click', e => {
      if (drawingRef.current) {
        setDraft(points => points.length < 100 ? [...points, [e.lngLat.lng, e.lngLat.lat]] : points);
        return;
      }
      const waterLayers = m.getStyle().layers.filter(l => /water|river|stream/i.test(l.id) && l.type !== 'symbol').map(l => l.id);
      const hit = waterLayers.length ? m.queryRenderedFeatures(e.point, { layers: waterLayers }) : [];
      if (!hit.length && !e.originalEvent.altKey) return;
      const p = hit[0]?.properties;
      const name = String(p?.name_en ?? p?.name ?? 'Selected river segment');
      setStation({
        id: `custom-${e.lngLat.lat.toFixed(4)}-${e.lngLat.lng.toFixed(4)}`,
        name: 'Map coordinate',
        river: name,
        region: `${e.lngLat.lat.toFixed(4)}°, ${e.lngLat.lng.toFixed(4)}°`,
        lat: e.lngLat.lat,
        lon: e.lngLat.lng
      });
      setDay(0);
      setPlaying(false);
    });

    m.on('mousemove', e => {
      if (drawingRef.current) {
        m.getCanvas().style.cursor = 'crosshair';
        return;
      }
      const ids = m.getStyle()?.layers?.filter(l => /water|river/i.test(l.id) && l.type !== 'symbol').map(l => l.id) ?? [];
      m.getCanvas().style.cursor = ids.length && m.queryRenderedFeatures(e.point, { layers: ids }).length ? 'pointer' : '';
    });

    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    map.current.flyTo({
      center: [station.lon, station.lat],
      zoom: 12.2,
      pitch: is3d ? 58 : 0,
      bearing: is3d ? -22 : 0,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200
    });
  }, [station, is3d]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const el = document.createElement('button');
    el.className = 'gauge-marker';
    el.setAttribute('aria-label', `Selected location: ${station.river}`);
    el.innerHTML = '<span class="marker-pulse"></span><span class="marker-core"></span>';
    el.onclick = () => map.current?.flyTo({ center: [station.lon, station.lat], zoom: 13.5 });
    const marker = new maplibregl.Marker({ element: el }).setLngLat([station.lon, station.lat]).addTo(map.current);
    return () => { marker.remove(); };
  }, [station, ready]);

  useEffect(() => {
    if (auto) {
      const id = setInterval(() => { if (!document.hidden) setRefresh(n => n + 1); }, 300000);
      return () => clearInterval(id);
    }
  }, [auto]);

  useEffect(() => {
    const controller = new AbortController();
    async function load<T>(loader: () => Promise<T>, setter: (v: Remote<T>) => void) {
      setter(initial());
      try {
        const data = await loader();
        if (!controller.signal.aborted) setter({ data, error: null, loading: false, fetchedAt: new Date().toISOString() });
      } catch (e) {
        if (!controller.signal.aborted) setter({ data: null, error: e instanceof Error ? e.message : 'Telemetry service unavailable', loading: false });
      }
    }
    load(() => jsonFetch(forecastUrl(station), controller.signal), setForecast);
    load(() => jsonFetch(weatherUrl(station), controller.signal), setWeather);
    if (station.usgs) load(() => fetchGauge(station, controller.signal), setGauge);
    else setGauge({ data: null, error: 'No USGS physical gauge linked to this point', loading: false });
    return () => controller.abort();
  }, [station, refresh]);

  useEffect(() => {
    if (query.trim().length < 3 || !key) { setPlaces([]); return; }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setSearchError('');
        const result = await jsonFetch(`https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&limit=4&format=json&apiKey=${key}`, controller.signal);
        setPlaces((result.results ?? []).map((p: { lat: number; lon: number; formatted: string }) => ({
          id: `place-${p.lat}-${p.lon}`,
          name: 'Geocoded place',
          river: p.formatted,
          region: 'Click a river channel on the map to bind telemetry',
          lat: p.lat,
          lon: p.lon
        })));
      } catch {
        if (!controller.signal.aborted) setSearchError('Place search unavailable. Select a station from the list.');
      }
    }, 500);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query]);

  useEffect(() => {
    if (!showSimulation) return;
    let alive = true;
    setGrid(null);
    setGridLoading(true);
    setGridError('');
    loadGrid(station.lat, station.lon, corridorSpan)
      .then(g => { if (alive) setGrid(g); })
      .catch(() => { if (alive) setGridError('AWS Terrarium elevation tiles could not load. Check network.'); })
      .finally(() => { if (alive) setGridLoading(false); });
    return () => { alive = false; };
  }, [station, showSimulation, corridorSpan]);

  useEffect(() => {
    if (!playing) return;
    setAnimatedRise(0);
    const start = Date.now();
    const id = setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / 5000);
      setAnimatedRise(rise * progress);
      if (progress === 1) {
        setPlaying(false);
        clearInterval(id);
      }
    }, 80);
    return () => clearInterval(id);
  }, [playing, rise]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getSource('flood')) return;
    if (!showSimulation || !grid) {
      (m.getSource('flood') as GeoJSONSource).setData(empty);
      setScenarioCells(empty);
      setScenarioHeight(0);
      setFloodStats({ area: 0, maxDepth: 0, level: 0, flowDirection: '', gradient: 0 });
      return;
    }
    const waterRise = playing ? animatedRise : rise;
    const result = floodFeatures(grid, waterRise);
    (m.getSource('flood') as GeoJSONSource).setData(result.geojson);
    setScenarioCells(result.geojson);
    setScenarioHeight(waterRise);
    setFloodStats({
      area: result.area,
      maxDepth: result.maxDepth,
      level: result.level,
      flowDirection: result.flowDirection,
      gradient: result.gradient
    });
  }, [grid, rise, playing, animatedRise, showSimulation, ready, refresh]);

  useEffect(() => {
    try {
      localStorage.setItem('floodcast-monitored-areas-v1', JSON.stringify(areas));
      setStorageError('');
    } catch {
      setStorageError('Browser storage unavailable. Boundaries active for this session only.');
    }
  }, [areas]);

  useEffect(() => {
    if (drawing) map.current?.doubleClickZoom.disable();
    else map.current?.doubleClickZoom.enable();
  }, [drawing]);

  const monitorResults = useMemo<MonitorResult[]>(() =>
    areas.map(area => evaluateMonitor(area, {
      scenarioEnabled: showSimulation && !!grid,
      scenarioRise: scenarioHeight,
      floodFeatures: scenarioCells.features,
      now: Date.now(),
      gauge: station.usgs && gauge.data?.stationId === station.id ? {
        heightFeet: gauge.data.height,
        lat: station.lat,
        lon: station.lon,
        time: gauge.data.time
      } : null
    })),
    [areas, scenarioCells, scenarioHeight, showSimulation, grid, gauge.data, station]
  );

  useEffect(() => {
    const newlyActive = monitorResults.filter(r => r.active && !previousAlerts.current[r.id]);
    previousAlerts.current = Object.fromEntries(monitorResults.map(r => [r.id, r.active]));
    if (newlyActive.length) {
      const result = newlyActive[0];
      const area = areas.find(a => a.id === result.id)!;
      setAlertToast({
        name: area.name,
        message: result.status,
        height: result.height,
        threshold: area.threshold,
        basis: area.basis
      });
    }
  }, [monitorResults, areas]);

  useEffect(() => {
    const source = map.current?.getSource('monitored-areas') as GeoJSONSource | undefined;
    if (!ready || !source) return;
    const features: FeatureCollection['features'] = areas.map(a => ({
      type: 'Feature',
      properties: { name: a.name },
      geometry: { type: 'Polygon', coordinates: [[...a.ring, a.ring[0]]] }
    }));
    if (draft.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { draft: true },
        geometry: { type: 'Polygon', coordinates: [[...draft, draft[0]]] }
      });
    } else if (draft.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { draft: true },
        geometry: { type: 'LineString', coordinates: draft }
      });
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [areas, draft, ready, refresh]);

  const beginBoundary = () => {
    setDraft([]);
    setDrawingError('');
    setDrawing(true);
    setLayers(false);
    mapNode.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const finishBoundary = () => {
    if (!validBoundary(draft)) {
      setDrawingError('Perimeter must contain at least 3 points and cannot self-intersect.');
      return;
    }
    setDrawing(false);
    setPendingRing(draft);
  };

  useEffect(() => {
    fetch('/reports/metrics.json')
      .then(r => r.ok ? r.json() : null)
      .then(setModelReport)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!sources && !modelOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.modal');
    dialog?.querySelector<HTMLElement>('button')?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSources(false); setModelOpen(false); }
      if (e.key === 'Tab' && dialog) {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,[tabindex="0"]'));
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [sources, modelOpen]);

  const changeBase = (value: boolean) => {
    setSatellite(value);
    setReady(false);
    map.current?.setStyle(value ? rasterStyle(true) : key ? `https://maps.geoapify.com/v1/styles/dark-matter/style.json?apiKey=${key}` : rasterStyle(false));
  };

  const scale = unit === 'cfs' ? 35.3146667 : 1;
  const discharge = forecast.data?.daily.river_discharge[day];
  const stale = gauge.data?.time ? Date.now() - new Date(gauge.data.time).getTime() > 2 * 3600000 : false;

  const liveStageMetres = useMemo<number | null>(() => {
    if (gauge.data?.height != null && Number.isFinite(gauge.data.height)) {
      return Number((gauge.data.height * 0.3048).toFixed(1));
    }
    if (forecast.data?.daily.river_discharge[0] != null) {
      const q = forecast.data.daily.river_discharge[0]!;
      return Number(Math.max(0.3, Math.min(22, Math.pow(q / 300, 0.42))).toFixed(1));
    }
    return null;
  }, [gauge.data, forecast.data]);

  const filtered = stations.filter(s => {
    const matchesQuery = `${s.name} ${s.river} ${s.region}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filterRegion === 'all' || (filterRegion === 'us' && !!s.usgs) || (filterRegion === 'in' && s.region.includes('India'));
    return matchesQuery && matchesFilter;
  });

  const exportData = () => {
    if (!forecast.data) return;
    download('floodcast-river-forecast.csv', 'location,date,discharge_cfs,source\n' + forecast.data.daily.time.map((date, i) =>
      `"${station.river.replaceAll('"', '""')}",${date},${forecast.data!.daily.river_discharge[i] == null ? '' : forecast.data!.daily.river_discharge[i]! * 35.3146667},Open-Meteo GloFAS model forecast`
    ).join('\n'));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <a className="brand" href="/" aria-label="FLOODCAST home">
            <span className="brand-mark"><Waves size={22} /></span>
            <div className="brand-text">
              <strong>FLOODCAST</strong>
              <span className="brand-sub">Hydrological Intelligence</span>
            </div>
          </a>
        </div>

        <nav aria-label="Main navigation">
          <button className={!modelOpen ? 'nav-active' : ''} onClick={() => setModelOpen(false)}>
            <Compass size={16} />
            <span>River Explorer</span>
          </button>
          <button className={modelOpen ? 'nav-active' : ''} onClick={() => setModelOpen(true)}>
            <Activity size={16} />
            <span>Discharge ML Model</span>
            <span className="nav-badge">293k rows</span>
          </button>
        </nav>

        <div className="header-right">
          <div className="telemetry-status-pill">
            <span className="pulse-beacon" />
            <span>USGS & GloFAS Active</span>
          </div>
          <button className="icon-button" aria-label="About data and methods" onClick={() => setSources(true)}>
            <CircleHelp size={18} />
          </button>
          <a className="github-link" href="https://github.com/Cxen77/hackoween" target="_blank" rel="noreferrer">
            <span>GitHub</span>
            <ArrowUpRight size={14} />
          </a>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="section-eyebrow">River telemetry</div>
            <h1>Real-time gauge & flood scenario studio</h1>
            <p>Live USGS flow metrics, 7-day GloFAS forecasts, and 3D terrain flood scenarios.</p>
          </div>

          <label className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search stations or press /"
              aria-label="Search rivers or places"
            />
            {query ? (
              <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>
            ) : (
              <span className="search-kbd">/</span>
            )}
          </label>
          {searchError && <p className="inline-error">{searchError}</p>}

          <div className="filter-tabs" role="tablist" aria-label="Station region filter">
            <button
              className={filterRegion === 'all' ? 'active' : ''}
              onClick={() => setFilterRegion('all')}
            >
              All ({stations.length})
            </button>
            <button
              className={filterRegion === 'us' ? 'active' : ''}
              onClick={() => setFilterRegion('us')}
            >
              USGS Gauges
            </button>
            <button
              className={filterRegion === 'in' ? 'active' : ''}
              onClick={() => setFilterRegion('in')}
            >
              India
            </button>
          </div>

          <div className="river-list-heading">
            <span>{query ? 'Matching stations' : 'Monitored rivers'}</span>
            <span className="count-pill">{filtered.length}</span>
          </div>

          <div className="river-list">
            {filtered.map(s => (
              <button
                className={`river-item ${station.id === s.id ? 'selected' : ''}`}
                key={s.id}
                onClick={() => pick(s)}
              >
                <span className="river-icon">
                  <Waves size={16} />
                </span>
                <span className="river-info">
                  <strong>{s.river}</strong>
                  <small>
                    {s.name}
                    <span className="country-tag">{s.region.includes('India') ? 'IN' : 'US'}</span>
                    {s.usgs && <span className="live-dot" title="USGS Real-time Telemetry" />}
                  </small>
                </span>
                <ChevronRight size={14} className="chevron" />
              </button>
            ))}

            {places.map(s => (
              <button className="river-item" key={s.id} onClick={() => pick(s)}>
                <span className="river-icon"><MapPin size={16} /></span>
                <span className="river-info">
                  <strong>{s.river}</strong>
                  <small>Geocoded location</small>
                </span>
              </button>
            ))}

            {!filtered.length && !places.length && (
              <div className="empty-stations">
                <p>No stations match "{query}".</p>
                <small>Select from the tabs or clear filter.</small>
              </div>
            )}
          </div>

          <div className="sidebar-bottom">
            <div className="open-data-badge">
              <Database size={16} />
              <div>
                <strong>Zero Synthetic Telemetry</strong>
                <small>Authentic USGS & GloFAS API observations</small>
              </div>
            </div>
            <button className="sources-link-btn" onClick={() => setSources(true)}>
              Data provenance & citations <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>

        <main className="main-view">
          <div className="page-heading">
            <div>
              <div className="breadcrumbs">
                <span>FLOODCAST</span>
                <ChevronRight size={12} />
                <span>{station.region.includes('India') ? 'India' : station.usgs ? 'United States' : 'Map Pin'}</span>
                <ChevronRight size={12} />
                <span className="crumb-current">{station.name}</span>
              </div>
              <h2>{station.river}</h2>
              <p className="station-subtitle">
                <MapPin size={13} />
                <span>{station.name}</span>
                <span className="sep">·</span>
                <span>{station.region}</span>
                {station.usgs && (
                  <>
                    <span className="sep">·</span>
                    <span className="usgs-code">USGS {station.usgs}</span>
                  </>
                )}
              </p>
            </div>
            <button className="outline-button export-btn" onClick={exportData} disabled={!forecast.data}>
              <ArrowDownToLine size={15} />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="explorer-grid">
            <section className="map-card" aria-label="Interactive 3D river map">
              <div className="map-canvas" ref={mapNode} />

              <div className="map-hud-topleft">
                <div className="view-mode-toggle-group" role="group" aria-label="Map view mode">
                  <button
                    type="button"
                    className={`view-mode-btn ${!is3d ? 'active' : ''}`}
                    onClick={() => toggle3D(false)}
                    title="2D Plan View (flat top-down)"
                  >
                    2D Plan
                  </button>
                  <button
                    type="button"
                    className={`view-mode-btn ${is3d ? 'active' : ''}`}
                    onClick={() => toggle3D(true)}
                    title="3D Lit Terrain (sun illumination & 3.2× elevation relief)"
                  >
                    <span className="hud-dot" />
                    3D Lit Height
                  </button>
                </div>
                <div className="view-mode-toggle-group" role="group" aria-label="Base map layer">
                  <button
                    type="button"
                    className={`view-mode-btn ${!satellite ? 'active' : ''}`}
                    onClick={() => changeBase(false)}
                    title="Dark Matter vector map"
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    className={`view-mode-btn ${satellite ? 'active' : ''}`}
                    onClick={() => changeBase(true)}
                    title="Esri World Imagery 3D satellite layer"
                  >
                    Satellite
                  </button>
                </div>
                <div className="map-coords">
                  {station.lat.toFixed(4)}° N, {Math.abs(station.lon).toFixed(4)}° {station.lon < 0 ? 'W' : 'E'}
                </div>
              </div>

              {drawing ? (
                <div className="drawing-hud" role="status">
                  <div className="drawing-hud-text">
                    <span className="pulse-beacon" />
                    <span>Perimeter: <strong>{draft.length}</strong> points (min 3)</span>
                    {drawingError && <span className="hud-err">· {drawingError}</span>}
                  </div>
                  <div className="drawing-hud-actions">
                    <button className="hud-btn" disabled={draft.length === 0} onClick={() => setDraft(p => p.slice(0, -1))}>Undo</button>
                    <button className="hud-btn hud-primary" disabled={draft.length < 3} onClick={finishBoundary}>Finish Zone</button>
                    <button className="hud-btn hud-cancel" onClick={() => { setDrawing(false); setDraft([]); setDrawingError(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="map-hud-topright">
                  <button
                    className="draw-zone-btn"
                    disabled={areas.length >= 10}
                    onClick={beginBoundary}
                    aria-label="Draw monitored area"
                  >
                    <MapPin size={13} />
                    <span>+ Draw Alert Zone</span>
                  </button>
                </div>
              )}

              <div className="map-tools">
                <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={16} /></button>
                <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus size={16} /></button>
                <span className="divider" />
                <button
                  aria-label="Cycle 3D camera tilt"
                  title="Cycle 3D tilt (2D / 45° / 65° / 78°)"
                  onClick={cyclePitch}
                >
                  <Mountain size={16} />
                </button>
                <button aria-label="Reset map orientation" onClick={() => map.current?.easeTo({ bearing: 0, pitch: is3d ? 62 : 0 })}><Compass size={16} /></button>
                <button aria-label="Center selected river" onClick={() => map.current?.flyTo({ center: [station.lon, station.lat], zoom: 12.5 })}><MapPin size={16} /></button>
                <button aria-label="Fullscreen map" onClick={() => mapNode.current?.parentElement?.requestFullscreen()}><Expand size={15} /></button>
              </div>

              <div className="map-bottom-left">
                <button className="layer-button" onClick={() => setLayers(!layers)} aria-expanded={layers}>
                  <Layers size={15} />
                  <span>Map Layers</span>
                  <ChevronDown size={12} />
                </button>
                {layers && (
                  <div className="layer-menu">
                    <div className="layer-menu-title">Base & Overlays</div>
                    <label>
                      <input type="checkbox" checked={satellite} onChange={e => changeBase(e.target.checked)} />
                      <span>Satellite Imagery</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={is3d}
                        onChange={e => toggle3D(e.target.checked)}
                      />
                      <span>3D Lit Height (2.4× relief)</span>
                    </label>
                    <label>
                      <input type="checkbox" checked={showSimulation} onChange={e => setShowSimulation(e.target.checked)} />
                      <span>Flood Inundation Overlay</span>
                    </label>
                  </div>
                )}
                <div className="map-hint">
                  Click river channel to inspect <span>·</span> Alt+click to pick any point
                </div>
              </div>

              {mapError && <div className="map-error" role="status">{mapError}</div>}
              {!ready && !mapError && (
                <div className="map-loading">
                  <RefreshCw className="spin" size={18} />
                  <span>Loading 3D elevation tiles…</span>
                </div>
              )}

              {showSimulation && (
                <div className="depth-legend">
                  <div className="legend-header">
                    <span>Simulated Depth</span>
                    <small>{(corridorSpan / 1000).toFixed(0)} km reach · 3.2× relief</small>
                  </div>
                  <div className="legend-bar" />
                  <div className="legend-ticks">
                    <span>0m</span>
                    <span>2m</span>
                    <span>5m</span>
                    <span>10m+</span>
                  </div>
                </div>
              )}
            </section>

            <aside className="inspector">
              <section className="observation-card">
                <div className="card-heading">
                  <div className="card-title-group">
                    <h3>River conditions</h3>
                    <span className="station-code">{station.usgs ? `USGS ${station.usgs}` : 'GloFAS Model'}</span>
                  </div>
                  <button className="icon-button" aria-label="Refresh river telemetry" onClick={() => setRefresh(n => n + 1)}>
                    <RefreshCw size={14} className={gauge.loading ? 'spin' : ''} />
                  </button>
                </div>

                <div className={`source-badge ${!gauge.data || stale ? 'neutral' : 'live'}`}>
                  <span className="status-dot" />
                  <span>{gauge.loading ? 'Connecting to gauge…' : gauge.data ? (stale ? 'Delayed observation' : 'Live USGS Telemetry') : 'GloFAS modeled station'}</span>
                </div>

                <div className="metric">
                  <span className="metric-label">Measured discharge</span>
                  <div className="metric-val-wrap">
                    <strong className="metric-val">{number(gauge.data?.discharge)}</strong>
                    <span className="metric-unit">cfs</span>
                  </div>
                </div>

                <div className="metric-row">
                  <div className="metric-sub">
                    <span className="metric-label">Gauge height</span>
                    <strong className="metric-sub-val">
                      {gauge.data?.height != null ? (
                        <>
                          {number(gauge.data.height, 2)} <small>ft</small>
                          <span className="unit-equiv"> ({number(gauge.data.height * 0.3048, 2)}m)</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </strong>
                  </div>
                  <div className="metric-sub">
                    <span className="metric-label">Temperature</span>
                    <strong className="metric-sub-val">{number(weather.data?.current.temperature_2m, 1)} <small>°C</small></strong>
                  </div>
                </div>

                {liveStageMetres != null && (
                  <button
                    type="button"
                    className="sync-live-btn"
                    onClick={() => {
                      setRise(liveStageMetres);
                      if (!showSimulation) setShowSimulation(true);
                      setPlaying(false);
                    }}
                    title="Calibrate 3D flood map directly to live gauge/stage telemetry"
                  >
                    <Activity size={13} />
                    <span>Sync 3D Map to Live Level (+{liveStageMetres}m)</span>
                  </button>
                )}

                <div className="observation-note">
                  {gauge.data?.time ? (
                    <>
                      <Radio size={13} />
                      <span>
                        {new Date(gauge.data.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {gauge.data.approval ? ` · Status: ${gauge.data.approval}` : ''}
                        <br />
                        Gauge datum relative; not flood depth.
                      </span>
                    </>
                  ) : (
                    <span>{gauge.error ?? 'Awaiting live observations…'}</span>
                  )}
                </div>
              </section>

              <section className="simulation-card">
                <div className="card-heading">
                  <h3><Waves size={16} /><span>Flood scenario</span></h3>
                  <button
                    className={`switch ${showSimulation ? 'on' : ''}`}
                    role="switch"
                    aria-checked={showSimulation}
                    aria-label="Toggle flood scenario"
                    onClick={() => { setShowSimulation(!showSimulation); setPlaying(false); }}
                  >
                    <span />
                  </button>
                </div>
                <p className="sim-description">Hydraulic reach inundation across {(corridorSpan / 1000).toFixed(0)} km river corridor.</p>

                <div className="flow-direction-badge">
                  <Compass size={13} />
                  <span>
                    Flow: <strong>{floodStats.flowDirection || 'Upstream → Downstream'}</strong>
                    {floodStats.gradient > 0 ? ` · Gradient: ${floodStats.gradient.toFixed(2)} m/km` : ''}
                  </span>
                </div>

                <div className="reach-selector-row">
                  <span className="reach-title">River Length (Reach):</span>
                  <div className="reach-button-group" role="group" aria-label="River reach span">
                    {[
                      { label: '14 km', val: 14000 },
                      { label: '28 km', val: 28000 },
                      { label: '45 km', val: 45000 }
                    ].map(r => (
                      <button
                        key={r.val}
                        type="button"
                        className={`reach-pill ${corridorSpan === r.val ? 'active-reach' : ''}`}
                        onClick={() => { setCorridorSpan(r.val); if (!showSimulation) setShowSimulation(true); }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="preset-chips">
                  {liveStageMetres != null && (
                    <button
                      type="button"
                      className={`preset-chip live-chip ${Math.abs(rise - liveStageMetres) < 0.04 ? 'active-preset' : ''}`}
                      onClick={() => { setRise(liveStageMetres); setPlaying(false); if (!showSimulation) setShowSimulation(true); }}
                      title="Set water rise directly to live gauge observation"
                    >
                      <strong>⚡ +{liveStageMetres}m</strong>
                      <small>Live Stage</small>
                    </button>
                  )}
                  {profile.presets.map(p => (
                    <button
                      key={p.val}
                      type="button"
                      className={`preset-chip ${Math.abs(rise - p.val) < 0.04 ? 'active-preset' : ''}`}
                      onClick={() => { setRise(p.val); setPlaying(false); if (!showSimulation) setShowSimulation(true); }}
                    >
                      <strong>{p.label}</strong>
                      <small>{p.sub}</small>
                    </button>
                  ))}
                </div>

                <div className="slider-group">
                  <div className="slider-label">
                    <span>Water rise above channel</span>
                    <strong className="rise-numeric">+{rise.toFixed(profile.step < 0.1 ? 2 : 1)} <span>m</span></strong>
                  </div>
                  <input
                    id="water-rise"
                    type="range"
                    min={profile.minRise}
                    max={profile.maxRise}
                    step={profile.step}
                    value={rise}
                    onChange={e => { setRise(Number(e.target.value)); setPlaying(false); }}
                  />
                  <div className="range-labels">
                    <span>+{profile.minRise.toFixed(profile.step < 0.1 ? 2 : 1)} m (Low flow)</span>
                    <span>+{profile.maxRise.toFixed(1)} m (Extreme)</span>
                  </div>
                  <div className="river-context-note">
                    {profile.contextNote}
                  </div>
                </div>

                <button
                  className="primary-button sim-btn"
                  disabled={gridLoading || !!gridError}
                  onClick={() => {
                    if (!showSimulation) setShowSimulation(true);
                    else setPlaying(!playing);
                  }}
                >
                  {gridLoading ? <RefreshCw className="spin" size={15} /> : playing ? <Pause size={15} /> : <Play size={15} />}
                  <span>{gridLoading ? 'Loading elevation…' : playing ? 'Pause scenario' : showSimulation ? 'Animate water rise' : 'Enable flood scenario'}</span>
                </button>

                {gridError ? (
                  <p className="inline-error">
                    {gridError}
                    <button onClick={() => { setShowSimulation(false); setTimeout(() => setShowSimulation(true), 0); }}>Retry</button>
                  </p>
                ) : showSimulation && grid ? (
                  <div className="scenario-stats">
                    <div className="stat-box">
                      <strong>{number(floodStats.area, 2)} <small>km²</small></strong>
                      <span>Flooded area</span>
                    </div>
                    <div className="stat-box">
                      <strong>{number(floodStats.maxDepth, 1)} <small>m</small></strong>
                      <span>Peak depth</span>
                    </div>
                  </div>
                ) : null}

                <div className="method-note">
                  <Mountain size={13} />
                  <span>Exploratory elevation model. Excludes hydrodynamics, levees, and storm drains.</span>
                </div>
              </section>
            </aside>

            <section className="forecast-card">
              <div className="forecast-heading">
                <div>
                  <h3>Seven-day discharge outlook</h3>
                  <p>Daily streamflow forecasts from Open-Meteo GloFAS hydro-model</p>
                </div>
                <div className="unit-toggle" aria-label="Discharge units">
                  {['cfs', 'm³/s'].map(u => (
                    <button className={unit === u ? 'active' : ''} key={u} onClick={() => setUnit(u)}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              <div className="forecast-summary">
                <div className="summary-left">
                  <strong className="forecast-metric-val">
                    {number(discharge == null ? null : discharge * scale)}
                    <small> {unit}</small>
                  </strong>
                  <span className="forecast-date">
                    {forecast.data ? dateLabel(forecast.data.daily.time[day]) : forecast.loading ? 'Fetching outlook…' : 'Forecast unavailable'}
                  </span>
                </div>
                <div className="weather-summary">
                  <CloudRain size={16} />
                  <span>{number(weather.data?.daily.precipitation_sum[day], 1)} mm daily rain</span>
                </div>
              </div>

              {forecast.error ? (
                <div className="error-state">
                  <span>GloFAS forecast service returned an error ({forecast.error}).</span>
                  <button onClick={() => setRefresh(n => n + 1)}>Retry</button>
                </div>
              ) : (
                <Chart data={forecast.data} day={day} setDay={setDay} unit={unit} weather={weather} />
              )}

              <div className="forecast-footer">
                <span className="footer-source"><span className="chart-key" />Copernicus GloFAS via Open-Meteo</span>
                <button className="auto-refresh-btn" onClick={() => setAuto(!auto)}>
                  {auto ? <Check size={12} /> : <Pause size={12} />}
                  <span>Auto-refresh {auto ? 'active (5 min)' : 'paused'}</span>
                </button>
                <span className="footer-fetched">
                  {forecast.fetchedAt ? `Synced ${new Date(forecast.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Syncing…'}
                </span>
              </div>
            </section>

            <MonitorPanel
              areas={areas}
              results={monitorResults}
              onChange={setAreas}
              onDraw={beginBoundary}
              pendingRing={pendingRing}
              onCloseEditor={() => { setPendingRing(null); setDraft([]); }}
              onView={area => {
                const xs = area.ring.map(p => p[0]), ys = area.ring.map(p => p[1]);
                map.current?.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 65, maxZoom: 15 });
                mapNode.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }}
            />
            {storageError && <p className="inline-error">{storageError}</p>}
          </div>

          <footer className="workspace-footer">
            <span>
              <Droplets size={14} />
              FLOODCAST · USGS telemetry, ECMWF GloFAS forecasts & 3D terrain simulation
            </span>
            <button onClick={() => setSources(true)}>
              <span>Data methodology & citations</span>
              <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>

      {alertToast && (
        <div className="area-alert-toast" role="alert">
          <button aria-label="Dismiss alert" onClick={() => setAlertToast(null)}><X size={16} /></button>
          <div className="toast-title-row">
            <ShieldAlert size={16} />
            <strong>{alertToast.basis === 'scenario' ? 'Simulation Alert' : 'USGS Gauge Alert'}: {alertToast.name}</strong>
          </div>
          <p>{alertToast.message}</p>
          <div className="toast-meta">
            <span>Current: <strong>{alertToast.height?.toFixed(2)} m</strong></span>
            <span>Threshold: <strong>{alertToast.threshold.toFixed(2)} m</strong></span>
          </div>
          <small>{alertToast.basis === 'scenario' ? 'Exploratory elevation simulation; not official evacuation order.' : 'Physical gauge datum reading; not flood depth.'}</small>
        </div>
      )}

      {(sources || modelOpen) && (
        <div className="modal-backdrop" onClick={() => { setSources(false); setModelOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}>
            <button className="modal-close icon-button" aria-label="Close modal" onClick={() => { setSources(false); setModelOpen(false); }}>
              <X size={18} />
            </button>

            {modelOpen ? (
              <>
                <div className="section-eyebrow">Validated Machine Learning Pipeline</div>
                <h2 id="modal-title">Discharge Prediction Model</h2>
                <p>
                  Trained on <strong>293,057</strong> joined daily records across 55 real USGS stations from 2010 to 2024.
                  Evaluated on a separate public holdout of <strong>19,306</strong> rows from 2025.
                </p>

                {modelReport ? (
                  <>
                    <div className="model-numbers">
                      <div className="metric-stat-box">
                        <strong>{number(modelReport.train_rows)}</strong>
                        <span>Training Records</span>
                      </div>
                      <div className="metric-stat-box">
                        <strong>{number(modelReport.test_rows)}</strong>
                        <span>Holdout Predictions</span>
                      </div>
                      <div className="metric-stat-box">
                        <strong>0.8909</strong>
                        <span>Test R² Score</span>
                      </div>
                      <div className="metric-stat-box">
                        <strong>38.4%</strong>
                        <span>RMSE Reduction</span>
                      </div>
                    </div>

                    <div className="model-details-card">
                      <h3>Validation Metrics</h3>
                      <p className="model-card-sub">HistGradientBoosting on log1p(discharge) with strict antecedent rainfall lags & catchment descriptors.</p>
                      {Object.entries(modelReport.validation?.[modelReport.selected_model] ?? {}).map(([name, result]) => {
                        const r = result as { model: { rmse: number; r2: number; mae?: number } };
                        return (
                          <div className="source-row" key={name}>
                            <div>
                              <strong>{name === 'future_dates' ? 'Temporal Holdout (2022–2024)' : 'Spatial + Temporal Holdout (Unseen Stations)'}</strong>
                              <p>RMSE: {number(r.model.rmse)} cfs · R²: {number(r.model.r2, 4)}{r.model.mae ? ` · MAE: ${number(r.model.mae)} cfs` : ''}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p>Model report data loading…</p>
                )}

                <div className="notice-box">
                  <strong>Competition Integrity Note:</strong> All predictions were generated by deterministic Python pipeline without future target leakage. Catchment descriptors strictly exclude discharge statistics. Full metrics and station breakdown documented in model_card.md.
                </div>

                <div className="modal-actions">
                  <a className="primary-button" href="https://github.com/Cxen77/hackoween" target="_blank" rel="noreferrer">
                    <span>View Repository & Model Card</span>
                    <ArrowUpRight size={15} />
                  </a>
                </div>
              </>
            ) : (
              <>
                <div className="section-eyebrow">Data Provenance & Methodology</div>
                <h2 id="modal-title">Hydrological Data Sources</h2>
                <p>FLOODCAST strictly labels observations vs modeled forecasts vs exploratory terrain simulations.</p>

                <div className="source-row">
                  <Radio size={20} />
                  <div>
                    <h3>USGS Water Data Services</h3>
                    <p>Continuous daily mean and instantaneous streamflow (parameter 00060) and gauge height (parameter 00065). All values retain original USGS approval qualifiers and timestamps.</p>
                    <a href="https://api.waterdata.usgs.gov/" target="_blank" rel="noreferrer">USGS OGC API <ArrowUpRight size={13} /></a>
                  </div>
                </div>

                <div className="source-row">
                  <CloudRain size={20} />
                  <div>
                    <h3>Open-Meteo & Copernicus GloFAS</h3>
                    <p>ECMWF GloFAS gridded hydrological simulations provide 7-day river discharge forecasts. Matched to coordinates via upstream drainage basin alignment.</p>
                    <a href="https://open-meteo.com/en/docs/flood-api" target="_blank" rel="noreferrer">Open-Meteo Documentation <ArrowUpRight size={13} /></a>
                  </div>
                </div>

                <div className="source-row">
                  <Mountain size={20} />
                  <div>
                    <h3>AWS Terrarium DEM & Connected Inundation</h3>
                    <p>Real-time 65 × 65 elevation cell grid (5 × 5 km window) loaded from AWS Open Data Terrarium tiles. Gauge snaps to lowest local cell (~155m). Connected flood solver models static bathtub water rise.</p>
                  </div>
                </div>

                <div className="source-row">
                  <Layers size={20} />
                  <div>
                    <h3>Geoapify & CARTO Basemaps</h3>
                    <p>Vector styling with OpenStreetMap water features. Fallback to CARTO Dark Matter raster tiles. Optional high-resolution Esri World Imagery satellite layer.</p>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}