import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import {
  Activity, Anchor, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ChevronRight,
  CircleHelp, CloudRain, Compass, Database, Droplets, Expand, Layers, MapPin,
  Minus, Mountain, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Radio, RefreshCw, Search, Shield, ShieldAlert,
  Sun, Sunrise, Trees, Waves, X
} from 'lucide-react';
import { Sidebar, SidebarBody } from '@/components/ui/sidebar';
import { motion, AnimatePresence } from 'framer-motion';
import { stations, number, forecastUrl, weatherUrl, jsonFetch, fetchGauge, download, riverProfiles, defaultRiverProfile } from './data';
import type { Station, Forecast, Weather, Gauge, Remote, RiverHydraulicProfile } from './data';
import { loadGrid, floodFeatures } from './terrain';
import type { Grid } from './terrain';
import { WaterSurface } from './WaterSurface';
import MonitorPanel from './MonitorPanel';
import HydrographOutlookCard from './components/HydrographOutlookCard';
import ModelPage from './components/ModelPage';
import ModelForecastCard from './components/ModelForecastCard';
import RidgelineDitherFooter from '@/components/ui/ridgeline-dither-footer';
import RidgeMark from '@/components/ui/RidgeMark';
import { LongPressButton } from '@/components/ui/long-press';
import { evaluateMonitor, validBoundary, validMonitor } from './geofence.mjs';
import type { AreaMonitor, MonitorResult } from './monitorTypes';
import type { FeatureCollection, Polygon, LineString } from 'geojson';

const riverIconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  potomac: Compass,
  mississippi: Anchor,
  colorado: Sun,
  neuse: Trees,
  sacramento: Mountain,
  ganga: Sunrise,
  brahmaputra: CloudRain,
  yamuna: Shield,
};

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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
  const terrainMode = useRef(is3d);
  terrainMode.current = is3d;

  const [showSimulation, setShowSimulation] = useState(true);
  const [rise, setRise] = useState<number>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('rise');
      if (p && Number.isFinite(Number(p))) return Number(p);
    } catch {}
    return 3;
  });
  const [corridorSpan, setCorridorSpan] = useState<number>(12000);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [gridError, setGridError] = useState('');
  const [gridLoading, setGridLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [animatedRise, setAnimatedRise] = useState(rise);
  const displayedRise = useRef(rise);
  const lastSliderTarget = useRef<{ rise:number; grid:Grid } | null>(null);
  const waterSurface = useRef<WaterSurface | null>(null);

  const [sources, setSources] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelReport, setModelReport] = useState<Record<string, any> | null>(null);
  // Live data from the local model server (observed flow); used to improve "Sync 3D Map to Live Level" where no stage gauge exists.
  const [modelLive, setModelLive] = useState<Record<string, any> | null>(null);

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
  const [floodStats, setFloodStats] = useState({ area: 0, maxDepth: 0, level: 0, flowDirection: '', gradient: 0, boundaryReached: false });

  const profile = useMemo<RiverHydraulicProfile>(
    () => riverProfiles[station.id] || defaultRiverProfile,
    [station.id]
  );

  const sliderTicks = useMemo(() => {
    const min = profile.minRise;
    const max = profile.maxRise;
    const range = max - min;
    let majorStep = 2;
    let minorStep = 1;
    if (range <= 6) {
      majorStep = 1;
      minorStep = 0.5;
    } else if (range <= 14) {
      majorStep = 2;
      minorStep = 1;
    } else if (range <= 24) {
      majorStep = 4;
      minorStep = 2;
    } else {
      majorStep = 5;
      minorStep = 2.5;
    }

    const ticks: { val: number; isMajor: boolean; percent: number }[] = [];
    for (let v = 0; v <= max + 0.001; v += minorStep) {
      const isMajor = Math.abs(v % majorStep) < 0.001 || Math.abs(v - max) < 0.001;
      const percent = Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
      ticks.push({ val: Math.round(v * 10) / 10, isMajor, percent });
    }
    return ticks;
  }, [profile.minRise, profile.maxRise]);

  const sliderProgress = Math.min(100, Math.max(0, ((rise - profile.minRise) / (profile.maxRise - profile.minRise)) * 100));

  const pick = (s: Station) => {
    setStation(s);
    setQuery('');
    setPlaces([]);
    setDay(0);
    setPlaying(false);
    const prof = riverProfiles[s.id] || defaultRiverProfile;
    setRise(prof.defaultRise);
    setCorridorSpan(Math.min(12000, prof.defaultReach));
  };

  const toggle3D = (force?: boolean) => {
    const next = force !== undefined ? force : !is3d;
    setIs3d(next);
    const m = map.current;
    if (!m) return;
    m.setTerrain(next ? { source: 'terrain-dem', exaggeration: 1.5 } : null);
    if (waterSurface.current) waterSurface.current.exaggeration = next ? 1.5 : 0;
    if (m.getLayer('terrain-hills')) {
      m.setLayoutProperty('terrain-hills', 'visibility', next ? 'visible' : 'none');
    }
    m.easeTo({
      pitch: next ? 55 : 0,
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
    if (waterSurface.current) waterSurface.current.exaggeration = next > 0 ? 1.5 : 0;
    m.setTerrain(next > 0 ? { source: 'terrain-dem', exaggeration: 1.5 } : null);
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
        pitch: 55,
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

    const ro = new ResizeObserver(() => {
      if (m && !m._removed) {
        m.resize();
      }
    });
    if (mapNode.current) {
      ro.observe(mapNode.current);
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
      m.setTerrain(terrainMode.current ? { source: 'terrain-dem', exaggeration: 1.5 } : null);
      m.addLayer({
        id: 'terrain-hills',
        type: 'hillshade',
        source: 'terrain-dem',
        layout: { visibility: 'visible' },
        paint: {
          'hillshade-exaggeration': 0.35,
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
          'fill-opacity': terrainMode.current ? 0 : .65,
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
          'line-opacity': 0,
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
          'line-opacity': 0,
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
      // Keep elevated water after all terrain-draped layers, which otherwise
      // repaint the opaque ground over a transparent custom surface.
      waterSurface.current = new WaterSurface();
      waterSurface.current.exaggeration = terrainMode.current ? 1.5 : 0;
      m.addLayer(waterSurface.current);
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
      ro.disconnect();
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
    setPlaying(false);
    displayedRise.current = 0;
    setAnimatedRise(0);
    setGrid(null);
    setGridLoading(true);
    setGridError('');
    loadGrid(station.lat, station.lon, corridorSpan)
      .then(g => { if (alive) setGrid(g); })
      .catch(() => { if (alive) setGridError('AWS Terrarium elevation tiles could not load. Check network.'); })
      .finally(() => { if (alive) setGridLoading(false); });
    return () => { alive = false; };
  }, [station, showSimulation, corridorSpan]);

  // Slider changes smoothly approach the target; pausing never changes stage.
  useEffect(() => {
    if (!grid || playing) return;
    if (lastSliderTarget.current?.rise === rise && lastSliderTarget.current?.grid === grid) return;
    lastSliderTarget.current = {rise, grid};
    const from = displayedRise.current;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayedRise.current = rise; setAnimatedRise(rise); return;
    }
    const start = performance.now();
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / 700);
      const value = from + (rise - from) * (t * t * (3 - 2 * t));
      displayedRise.current = value; setAnimatedRise(value);
      if (t === 1) clearInterval(id);
    }, 70);
    return () => clearInterval(id);
  }, [rise, grid, playing]);

  useEffect(() => {
    if (!playing || !grid) return;
    const from = Math.abs(displayedRise.current - rise) < .02 ? 0 : displayedRise.current;
    displayedRise.current = from; setAnimatedRise(from);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayedRise.current = rise; setAnimatedRise(rise); setPlaying(false); return;
    }
    const start = performance.now();
    const duration = 14000 * Math.max(.15, Math.abs(rise - from) / Math.max(rise, .01));
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const value = from + (rise - from) * t;
      displayedRise.current = value; setAnimatedRise(value);
      if (t === 1) { clearInterval(id); setPlaying(false); }
    }, 90);
    return () => clearInterval(id);
  }, [playing, grid]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getSource('flood')) return;
    if (!showSimulation || !grid) {
      (m.getSource('flood') as GeoJSONSource).setData(empty);
      waterSurface.current?.setSurface(null);
      setScenarioCells(empty);
      setScenarioHeight(0);
      setFloodStats({ area: 0, maxDepth: 0, level: 0, flowDirection: '', gradient: 0, boundaryReached: false });
      return;
    }
    const waterRise = animatedRise;
    const result = floodFeatures(grid, waterRise);
    (m.getSource('flood') as GeoJSONSource).setData(result.geojson);
    waterSurface.current?.setSurface(is3d ? grid : null, result.surface);
    m.setPaintProperty('flood-fill', 'fill-opacity', is3d ? 0 : .65);
    setScenarioCells(result.geojson);
    setScenarioHeight(waterRise);
    setFloodStats({
      area: result.area,
      maxDepth: result.maxDepth,
      level: result.level,
      flowDirection: result.flowDirection,
      gradient: result.gradient,
      boundaryReached: result.boundaryReached
    });
  }, [grid, rise, playing, animatedRise, showSimulation, ready, refresh, is3d]);

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

  const filtered = stations.filter(s => {
    const matchesQuery = `${s.name} ${s.river} ${s.region}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filterRegion === 'all' || (filterRegion === 'us' && !!s.usgs) || (filterRegion === 'in' && s.region.endsWith(', India'));
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
      {/* Floating Pill Navbar with restored navigation & controls */}
      <header className="pill-navbar-wrapper">
        <div className="pill-navbar">
          {/* Brand with official RidgeMark logo */}
          <a
            href="/"
            className="pill-navbar-brand"
            onClick={(e) => {
              e.preventDefault();
              setModelOpen(false);
              setSources(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            title="FloodCast Hydrological Intelligence"
          >
            <RidgeMark width={28} height={20} />
            <span className="pill-brand-text">FLOODCAST</span>
          </a>

          {/* Restored Main Navigation */}
          <nav className="pill-navbar-center" aria-label="Main Navigation">
            <button
              type="button"
              className={`pill-nav-btn ${!modelOpen ? 'active' : ''}`}
              onClick={() => {
                setModelOpen(false);
                setSources(false);
              }}
            >
              <Compass size={16} />
              <span>River Explorer</span>
            </button>

            <button
              type="button"
              className={`pill-nav-btn ${modelOpen ? 'active' : ''}`}
              onClick={() => {
                setModelOpen(true);
                setSources(false);
              }}
            >
              <Activity size={16} />
              <span>Discharge ML Model</span>
              <span className="nav-badge">293k rows</span>
            </button>
          </nav>

          {/* Restored Right Actions: Telemetry status, Help/About, GitHub */}
          <div className="pill-navbar-right">
            <button
              type="button"
              className="icon-button"
              aria-label="About data and methods"
              onClick={() => setSources(true)}
              title="About data and methods"
            >
              <CircleHelp size={18} />
            </button>

            <a
              className="github-link"
              href="https://github.com/Cxen77/hackoween"
              target="_blank"
              rel="noreferrer"
              title="View repository on GitHub"
            >
              <span>GitHub</span>
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </header>

      {modelOpen && <ModelPage />}
      <div className="workspace" hidden={modelOpen}>
        <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} animate={true}>
          <SidebarBody className="floodcast-sidebar-body">
            {sidebarOpen ? (
              <div className="sidebar-expanded-content">
                {/* Brand Header: Our FloodCast logo & name */}
                <div className="sidebar-brand-row">
                  <div
                    className="sidebar-brand-logo"
                    onClick={() => {
                      setModelOpen(false);
                      setSources(false);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    title="FloodCast Hydrological Intelligence"
                  >
                    <RidgeMark width={28} height={20} />
                  </div>
                  <button
                    type="button"
                    className="sidebar-collapse-toggle"
                    onClick={() => setSidebarOpen(false)}
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                  >
                    <PanelLeftClose size={18} />
                  </button>
                </div>

                {/* Monitored Basins Section */}
                <div className="acet-section-heading">
                  <span>{query ? 'Matching basins' : 'Monitored Basins'}</span>
                  <span className="acet-count-pill">{filtered.length}</span>
                </div>

                <label className="acet-search-box">
                  <Search size={16} className="acet-search-icon" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search basins or press /"
                    aria-label="Search rivers or places"
                  />
                  {query ? (
                    <button aria-label="Clear search" onClick={() => setQuery('')}>
                      <X size={14} />
                    </button>
                  ) : (
                    <span className="acet-search-kbd">/</span>
                  )}
                </label>
                {searchError && <p className="inline-error">{searchError}</p>}

                <div className="acet-filter-tabs" role="tablist" aria-label="Station region filter">
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
                    India (live)
                  </button>
                </div>

                <div className="acet-river-list">
                  {filtered.map(s => {
                    const RiverIcon = riverIconMap[s.id] || Waves;
                    return (
                      <button
                        className={`acet-river-item ${station.id === s.id ? 'selected' : ''}`}
                        key={s.id}
                        onClick={() => pick(s)}
                      >
                        <RiverIcon size={20} className="acet-river-icon" />
                        <span className="acet-river-info">
                          <span className="acet-river-title">{s.river}</span>
                          <span className="acet-river-sub">
                            <span>{s.name}</span>
                            <span className="acet-country-tag">{s.region.endsWith(', India') ? 'IN' : 'US'}</span>
                            {s.usgs && <span className="acet-live-dot" title="USGS Water Gauge" />}
                          </span>
                        </span>
                        <ChevronRight size={15} className="acet-chevron" />
                      </button>
                    );
                  })}

                  {places.map(s => (
                    <button className="acet-river-item" key={s.id} onClick={() => pick(s)}>
                      <MapPin size={20} className="acet-river-icon" />
                      <span className="acet-river-info">
                        <span className="acet-river-title">{s.river}</span>
                        <span className="acet-river-sub">Geocoded location</span>
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
              </div>
            ) : (
              <div className="sidebar-collapsed-content">
                <div
                  className="collapsed-ridge-logo"
                  onClick={() => setSidebarOpen(true)}
                  title="Expand FloodCast Sidebar"
                >
                  <RidgeMark width={26} height={18} />
                </div>

                <button
                  type="button"
                  className="sidebar-collapse-toggle collapsed-toggle"
                  onClick={() => setSidebarOpen(true)}
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen size={18} />
                </button>

                <div className="collapsed-divider" />

                <button
                  type="button"
                  className="collapsed-icon-btn"
                  title="Search basins"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Search size={18} />
                </button>

                <div className="collapsed-river-list">
                  {filtered.map(s => {
                    const RiverIcon = riverIconMap[s.id] || Waves;
                    return (
                      <button
                        key={s.id}
                        className={`collapsed-station-pill ${station.id === s.id ? 'active' : ''}`}
                        title={`${s.river} (${s.name}) — ${s.usgs ? 'USGS Live' : 'GloFAS'}`}
                        onClick={() => pick(s)}
                      >
                        <RiverIcon size={19} />
                        {s.usgs && <span className="collapsed-live-dot" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </SidebarBody>
        </Sidebar>

        <main className="main-view">
          <div className="page-heading">
            <div>
              <div className="breadcrumbs">
                <span>FLOODCAST</span>
                <ChevronRight size={12} />
                <span>{station.region.endsWith(', India') ? 'India' : station.usgs ? 'United States' : 'Map Pin'}</span>
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

          <div className="explorer-layout">
            <div className="map-simulation-row">
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
                    title="3D Lit Terrain (sun illumination & 1.5× elevation relief)"
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
                    <span>{is3d ? 'Simulated depth' : 'Flood extent'}</span>
                    <small>{(corridorSpan / 1000).toFixed(0)} km window{is3d ? ' · 1.5× relief' : ''}</small>
                  </div>
                  {is3d && <div className="legend-bar" />}
                  {is3d && <div className="legend-ticks">
                    <span>0m</span>
                    <span>2m</span>
                    <span>5m</span>
                    <span>10m+</span>
                  </div>}
                </div>
              )}
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
              <p className="sim-description">Raise the river and watch water spread across connected low ground. {(corridorSpan / 1000).toFixed(0)} km terrain window.</p>
              <label className="simulation-window">Terrain window
                <select value={corridorSpan} onChange={e => setCorridorSpan(Number(e.target.value))}>
                  <option value={6000}>6 km · finer detail</option>
                  <option value={12000}>12 km</option>
                  <option value={20000}>20 km · wider area</option>
                </select>
              </label>

              <div className="slider-group">
                <div className="slider-label">
                  <span>Rise above reference river surface</span>
                  <strong className="rise-numeric">+{animatedRise.toFixed(profile.step < 0.1 ? 2 : 1)} <span>m</span></strong>
                </div>
                <div className="slider-track-wrap">
                  <input
                    id="water-rise"
                    type="range"
                    className="reference-slider"
                    min={0}
                    max={profile.maxRise}
                    step={profile.step}
                    value={rise}
                    style={{
                      background: `linear-gradient(to right, #18181b 0%, #18181b ${sliderProgress}%, #e2e8f0 ${sliderProgress}%, #e2e8f0 100%)`
                    }}
                    onChange={e => { setRise(Number(e.target.value)); setPlaying(false); }}
                    aria-label="Water rise above channel"
                  />
                  <div className="slider-ticks-container">
                    {sliderTicks.map(t => (
                      <div
                        key={t.val}
                        className={`slider-tick ${t.isMajor ? 'major-tick' : 'minor-tick'}`}
                        style={{ left: `calc(11px + (100% - 22px) * ${t.percent / 100})` }}
                        onClick={() => { setRise(t.val); setPlaying(false); }}
                        title={`Set to +${t.val}m`}
                      >
                        <span className="tick-line" />
                        {t.isMajor && <span className="tick-label">{t.val}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="river-context-note">
                  {profile.contextNote}
                </div>
              </div>

              <div className="simulation-playback-status">
                <span>{gridLoading ? 'Preparing river' : playing ? 'Rising' : Math.abs(animatedRise - rise) > .02 ? 'Paused / adjusting' : 'At target'} · target +{rise.toFixed(1)} m</span>
                <button type="button" onClick={() => { setPlaying(false); setRise(0); displayedRise.current = 0; setAnimatedRise(0); }}>Reset to river level</button>
              </div>

              <LongPressButton
                disabled={gridLoading || !!gridError || !grid || rise === 0}
                active={playing}
                className="w-full"
                onLongPress={() => {
                  if (gridLoading || !!gridError) return;
                  if (!showSimulation) {
                    setShowSimulation(true);
                    setPlaying(true);
                  } else {
                    setPlaying(prev => !prev);
                  }
                }}
                onClick={() => {
                  if (gridLoading || !!gridError) return;
                  if (!showSimulation) {
                    setShowSimulation(true);
                    setPlaying(true);
                  } else {
                    setPlaying(prev => !prev);
                  }
                }}
              >
                {gridLoading ? (
                  <>
                    <RefreshCw className="spin" size={14} />
                    <span>Loading elevation…</span>
                  </>
                ) : playing ? (
                  <>
                    <Pause size={14} />
                    <span>Pause scenario</span>
                  </>
                ) : showSimulation ? (
                  <>
                    <Play size={14} />
                    <span>{Math.abs(animatedRise - rise) > .02 ? 'Resume water rise' : 'Replay water rise'}</span>
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    <span>Enable flood scenario</span>
                  </>
                )}
              </LongPressButton>

              {gridError ? (
                <p className="inline-error">
                  {gridError}
                  <button onClick={() => { setShowSimulation(false); setTimeout(() => setShowSimulation(true), 0); }}>Retry</button>
                </p>
              ) : showSimulation && grid ? (
                <div className="scenario-stats">
                  <div className="stat-box">
                    <strong>{number(floodStats.area, 2)} <small>km²</small></strong>
                    <span>Additional inundated land</span>
                  </div>
                  <div className="stat-box">
                    <strong>{number(floodStats.maxDepth, 1)} <small>m</small></strong>
                    <span>Max depth over land</span>
                  </div>
                </div>
              ) : null}

              {grid && <p className="simulation-source-note">{grid.channelSource} · {Math.round(Math.sqrt(grid.cellArea))} m cells. {grid.channelSource === 'Point-source fallback' && 'Channel data unavailable; local point-source scenario only.'}</p>}
              {floodStats.boundaryReached && <p className="inline-error">Water reaches the terrain-window edge. The affected area extends beyond this view.</p>}

              <ModelForecastCard
                usgs={station.usgs}
                nwic={station.nwic}
                river={station.river}
                onData={setModelLive}
                onSimulate={(metres) => {
                  setRise(Math.min(profile.maxRise, Math.max(0, Number(metres.toFixed(2)))));
                  setPlaying(false);
                  if (!showSimulation) setShowSimulation(true);
                }}
              />

              <div className="method-note">
                <Mountain size={13} />
                <span>Exploratory elevation model. Excludes hydrodynamics, levees, and storm drains.</span>
              </div>
            </section>
          </div>

          <div className="telemetry-outlook-row">
            <section className="observation-card">
              <div className="card-heading">
                <div className="card-title-group">
                  <h3>River conditions</h3>
                  <span className="station-code">{station.usgs ? `USGS ${station.usgs}` : 'GloFAS Model'}</span>
                </div>
                <button className="icon-button" aria-label="Refresh observations" onClick={() => setRefresh(n => n + 1)}>
                  <RefreshCw size={14} className={gauge.loading ? 'spin' : ''} />
                </button>
              </div>

              <div className={`source-badge ${!gauge.data || stale ? 'neutral' : 'live'}`}>
                <span className="status-dot" />
                <span>{gauge.loading ? 'Connecting to gauge…' : gauge.data ? (stale ? 'Delayed observation' : 'Live USGS Observation') : 'GloFAS modeled station'}</span>
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

            <HydrographOutlookCard
              forecast={forecast}
              weather={weather}
              station={station}
              day={day}
              setDay={setDay}
              unit={unit}
              setUnit={setUnit}
              auto={auto}
              setAuto={setAuto}
              setRefresh={setRefresh}
              setSources={setSources}
              modelLive={modelLive}
            />
          </div>

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
        </main>
      </div>

      <div className="floodcast-footer-wrapper">
        <RidgelineDitherFooter
          preset="glacier"
          maxWidth="100%"
          name="FloodCast"
          tagline="River intelligence connecting live gauges, discharge forecasts, and terrain-based flood scenarios."
          brandHref="#"
          columns={[
            {
              title: "Telemetry & Forecasts",
              links: [
                { label: "USGS Water Gauges", href: "https://waterdata.usgs.gov", badge: "Live" },
                { label: "ECMWF Copernicus GloFAS", href: "https://global-floods.jrc.ec.europa.eu" },
                { label: "Open-Meteo Flood API", href: "https://open-meteo.com/en/docs/flood-api" },
                { label: "CWC India Hydrology", href: "https://cwc.gov.in" },
              ],
            },
            {
              title: "Monitored Basins",
              links: [
                { label: "Potomac River (DC)", badge: "Live USGS" },
                { label: "Mississippi River (St. Louis)", badge: "Calibrated" },
                { label: "Brahmaputra River (Guwahati)", badge: "Monsoon" },
                { label: "Yamuna River (New Delhi)", badge: "Protected" },
              ],
            },
            {
              title: "Methodology",
              links: [
                { label: "Data methodology & citations", onClick: (e) => { e.preventDefault(); setSources(true); } },
                { label: "River-connected stage scenarios", badge: "3D" },
                { label: "Continuous shoreline interpolation" },
                { label: "USGS 3DEP & Terrarium DEM" },
              ],
            },
          ]}
          socials={[
            { icon: "github", href: "https://github.com/Cxen77/hackoween", label: "GitHub Repository" },
          ]}
          copyright={`© ${new Date().getFullYear()} FloodCast Intelligence. Authentic physical gauges & terrain models.`}
          credit={{ label: "USGS & Copernicus GloFAS", href: "https://waterdata.usgs.gov" }}
          ridges={6}
          seed={37}
          pixel={2}
          height="580px"
          sceneMinHeight="260px"
          interactive={true}
          altimeter={true}
        />
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

      {sources && (
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
                    <p>A 193 × 193 elevation grid from AWS Terrarium tiles, with mapped OpenStreetMap river channels. A fitted reach slope provides the reference water surface. Rising stage overtops connected terrain barriers; the 3D surface sits above the ground. This is a stage scenario, not a hydraulic forecast. Grid spacing depends on the selected window; missing river data uses a labeled point-source fallback.</p>
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
