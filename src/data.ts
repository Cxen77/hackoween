import { datasetStations } from './datasetStations';
import { indiaStations } from './indiaStations';
export type Station = { id: string; name: string; river: string; region: string; lat: number; lon: number; usgs?: string; nwic?: string; newRiver?: boolean };
// Monitored basins = the 55 US gauges the model was trained on (scripts/export_dataset_stations.py) plus Indian gauges with a LIVE NWIC
// discharge feed (scripts/export_india_stations.py). The Indian ones are new rivers: not in the training data.
export const stations: Station[] = [...datasetStations, ...indiaStations];

export type RiverHydraulicProfile = {
  minRise: number;
  maxRise: number;
  step: number;
  defaultRise: number;
  defaultReach: number;
  presets: { label: string; sub: string; val: number }[];
  contextNote: string;
};

export const riverProfiles: Record<string, RiverHydraulicProfile> = {
  yamuna: {
    minRise: 0.05,
    maxRise: 6.0,
    step: 0.05,
    defaultRise: 0.4,
    defaultReach: 14000,
    presets: [
      { label: '+0.1m', sub: 'Low Channel', val: 0.1 },
      { label: '+0.4m', sub: 'Baseflow', val: 0.4 },
      { label: '+0.8m', sub: 'Warning (204.5m)', val: 0.8 },
      { label: '+1.6m', sub: 'Danger (205.3m)', val: 1.6 },
      { label: '+3.2m', sub: '2023 Flood', val: 3.2 },
      { label: '+5.5m', sub: 'Extreme', val: 5.5 }
    ],
    contextNote: 'Flat alluvial plain. Highly sensitive to sub-metre rises above Old Railway Bridge datum.'
  },
  brahmaputra: {
    minRise: 0.2,
    maxRise: 22.0,
    step: 0.2,
    defaultRise: 2.0,
    defaultReach: 28000,
    presets: [
      { label: '+0.5m', sub: 'Winter Low', val: 0.5 },
      { label: '+2.0m', sub: 'Bankfull', val: 2.0 },
      { label: '+5.0m', sub: 'Warning (49.6m)', val: 5.0 },
      { label: '+8.0m', sub: 'Danger (50.5m)', val: 8.0 },
      { label: '+14.0m', sub: 'Monsoon High', val: 14.0 },
      { label: '+20.0m', sub: 'Historic Peak', val: 20.0 }
    ],
    contextNote: 'Himalayan braided river system with 15m+ seasonal monsoon stage variation.'
  },
  ganga: {
    minRise: 0.1,
    maxRise: 16.0,
    step: 0.1,
    defaultRise: 1.5,
    defaultReach: 22000,
    presets: [
      { label: '+0.3m', sub: 'Dry Season', val: 0.3 },
      { label: '+1.5m', sub: 'Normal Flow', val: 1.5 },
      { label: '+4.0m', sub: 'Warning (70.2m)', val: 4.0 },
      { label: '+7.0m', sub: 'Danger (71.2m)', val: 7.0 },
      { label: '+11.0m', sub: 'Ghat Inundation', val: 11.0 },
      { label: '+15.0m', sub: '1978 Historic', val: 15.0 }
    ],
    contextNote: 'Broad river basin with steep western masonry ghats and low eastern floodplains.'
  },
  mississippi: {
    minRise: 0.2,
    maxRise: 15.0,
    step: 0.2,
    defaultRise: 2.0,
    defaultReach: 28000,
    presets: [
      { label: '+0.5m', sub: 'Low Flow', val: 0.5 },
      { label: '+2.0m', sub: 'Action Stage', val: 2.0 },
      { label: '+4.5m', sub: 'Flood (30 ft)', val: 4.5 },
      { label: '+7.5m', sub: 'Moderate (35 ft)', val: 7.5 },
      { label: '+10.5m', sub: 'Major (40 ft)', val: 10.5 },
      { label: '+14.0m', sub: '1993 Great Flood', val: 14.0 }
    ],
    contextNote: 'Major continental drainage with extensive urban floodwall and levee containment.'
  },
  potomac: {
    minRise: 0.1,
    maxRise: 8.0,
    step: 0.1,
    defaultRise: 1.0,
    defaultReach: 18000,
    presets: [
      { label: '+0.3m', sub: 'Baseflow', val: 0.3 },
      { label: '+1.0m', sub: 'Action (5 ft)', val: 1.0 },
      { label: '+2.5m', sub: 'Flood (10 ft)', val: 2.5 },
      { label: '+4.0m', sub: 'Moderate (14 ft)', val: 4.0 },
      { label: '+6.0m', sub: 'Major (18 ft)', val: 6.0 },
      { label: '+8.0m', sub: 'Agnes Record', val: 8.0 }
    ],
    contextNote: 'Rocky gorge at Washington DC fall line with steep confining river valley walls.'
  },
  colorado: {
    minRise: 0.1,
    maxRise: 10.0,
    step: 0.1,
    defaultRise: 1.0,
    defaultReach: 18000,
    presets: [
      { label: '+0.2m', sub: 'Basepool', val: 0.2 },
      { label: '+1.0m', sub: 'Bankfull', val: 1.0 },
      { label: '+3.0m', sub: 'Action (21 ft)', val: 3.0 },
      { label: '+5.5m', sub: 'Flood (28 ft)', val: 5.5 },
      { label: '+8.0m', sub: 'Major (34 ft)', val: 8.0 },
      { label: '+10.0m', sub: 'Spillway High', val: 10.0 }
    ],
    contextNote: 'Regulated Texas highland chain reservoir system.'
  },
  neuse: {
    minRise: 0.1,
    maxRise: 8.0,
    step: 0.1,
    defaultRise: 1.0,
    defaultReach: 18000,
    presets: [
      { label: '+0.2m', sub: 'Baseflow', val: 0.2 },
      { label: '+1.0m', sub: 'Bankfull', val: 1.0 },
      { label: '+2.5m', sub: 'Action (9 ft)', val: 2.5 },
      { label: '+4.5m', sub: 'Flood (14 ft)', val: 4.5 },
      { label: '+6.5m', sub: 'Major (20 ft)', val: 6.5 },
      { label: '+8.0m', sub: 'Matthew Peak', val: 8.0 }
    ],
    contextNote: 'Gentle coastal plain drainage with broad low-lying swamp floodplains.'
  },
  sacramento: {
    minRise: 0.1,
    maxRise: 12.0,
    step: 0.1,
    defaultRise: 1.5,
    defaultReach: 22000,
    presets: [
      { label: '+0.3m', sub: 'Summer Low', val: 0.3 },
      { label: '+1.5m', sub: 'Monitor (28 ft)', val: 1.5 },
      { label: '+3.5m', sub: 'Weir Spill (33 ft)', val: 3.5 },
      { label: '+6.0m', sub: 'Flood (38 ft)', val: 6.0 },
      { label: '+9.0m', sub: 'Major (41 ft)', val: 9.0 },
      { label: '+12.0m', sub: '1997 Historic', val: 12.0 }
    ],
    contextNote: 'Agricultural flood bypass system with active weir diversion channels.'
  }
};

export const defaultRiverProfile: RiverHydraulicProfile = {
  minRise: 0.1,
  maxRise: 12.0,
  step: 0.1,
  defaultRise: 1.5,
  defaultReach: 20000,
  presets: [
    { label: '+0.3m', sub: 'Low Flow', val: 0.3 },
    { label: '+1.0m', sub: 'Bankfull', val: 1.0 },
    { label: '+3.0m', sub: 'Moderate', val: 3.0 },
    { label: '+6.0m', sub: 'Major', val: 6.0 },
    { label: '+10.0m', sub: 'Severe', val: 10.0 }
  ],
  contextNote: 'Standard river channel elevation and hydraulic stage model.'
};
export type Forecast = { daily: { time:string[]; river_discharge:(number|null)[]; river_discharge_mean?:(number|null)[]; river_discharge_min?:(number|null)[]; river_discharge_max?:(number|null)[] } };
export type Weather = { current: { time:string; temperature_2m:number; precipitation:number }; daily:{ time:string[]; precipitation_sum:(number|null)[]; temperature_2m_max:(number|null)[]; temperature_2m_min:(number|null)[] } };
export type Gauge = { discharge?:number; height?:number; time?:string; approval?:string; stationId?:string };
export type Remote<T> = { data:T|null; error:string|null; loading:boolean; fetchedAt?:string };
export async function jsonFetch(url:string, signal?:AbortSignal) {
  const response = await fetch(url, {signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)});
  if(!response.ok) throw new Error(`Service returned ${response.status}`);
  return response.json();
}
export const forecastUrl = (s:Station) => `https://flood-api.open-meteo.com/v1/flood?latitude=${s.lat}&longitude=${s.lon}&daily=river_discharge,river_discharge_mean,river_discharge_min,river_discharge_max&forecast_days=7&timezone=auto`;
export const weatherUrl = (s:Station) => `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&current=temperature_2m,precipitation&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto`;
export async function fetchGauge(s:Station, signal:AbortSignal):Promise<Gauge> {
  if(!s.usgs) throw new Error('No USGS gauge at this location');
  // Modern API first. The legacy adapter is retained for continuity during migration.
  try {
    const data = await jsonFetch(`https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-${s.usgs}&parameter_code=00060,00065&limit=20`,signal);
    const gauge:Gauge = {stationId:s.id};
    for(const f of data.features ?? []) {
      const p = f.properties;
      if(p.value === null || !Number.isFinite(Number(p.value)) || Number(p.value)<0) continue;
      if(p.parameter_code==='00060') { gauge.discharge=Number(p.value); gauge.time=p.time; gauge.approval=p.approval_status; }
      if(p.parameter_code==='00065') gauge.height=Number(p.value);
    }
    if(gauge.discharge != null) return gauge;
  } catch(e) { if(signal.aborted) throw e; }
  const data = await jsonFetch(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${s.usgs}&parameterCd=00060,00065&period=P1D`,signal);
  const gauge:Gauge = {stationId:s.id};
  for(const series of data.value?.timeSeries ?? []) {
    const values = series.values?.flatMap((v:{value:unknown[]})=>v.value) ?? [];
    const latest = values.filter((v:{value:string})=>Number(v.value)>=0).at(-1);
    if(!latest) continue;
    const code = series.variable.variableCode[0].value;
    if(code==='00060') {gauge.discharge=Number(latest.value);gauge.time=latest.dateTime;gauge.approval=latest.qualifiers?.join(', ');}
    if(code==='00065') gauge.height=Number(latest.value);
  }
  if(gauge.discharge==null) throw new Error('No recent discharge observation');
  return gauge;
}
export const number = (n:number|null|undefined, digits=0) => n==null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US',{maximumFractionDigits:digits}).format(n);
export function download(name:string, content:string, type='text/csv') { const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
