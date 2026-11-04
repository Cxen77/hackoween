export type Station = { id: string; name: string; river: string; region: string; lat: number; lon: number; usgs?: string };
export const stations: Station[] = [
  { id:'potomac', name:'Little Falls', river:'Potomac River', region:'Maryland, United States', lat:38.9498, lon:-77.1276, usgs:'01646500' },
  { id:'mississippi', name:'St. Louis', river:'Mississippi River', region:'Missouri, United States', lat:38.6289, lon:-90.1797, usgs:'07010000' },
  { id:'colorado', name:'Austin', river:'Colorado River', region:'Texas, United States', lat:30.2447, lon:-97.6947, usgs:'08158000' },
  { id:'neuse', name:'Near Clayton', river:'Neuse River', region:'North Carolina, United States', lat:35.6472, lon:-78.4056, usgs:'02087500' },
  { id:'sacramento', name:'Verona', river:'Sacramento River', region:'California, United States', lat:38.774, lon:-121.598, usgs:'11425500' },
  { id:'ganga', name:'Varanasi', river:'Ganges River', region:'Uttar Pradesh, India', lat:25.306, lon:83.006 },
  { id:'brahmaputra', name:'Guwahati', river:'Brahmaputra River', region:'Assam, India', lat:26.195, lon:91.744 },
  { id:'yamuna', name:'New Delhi', river:'Yamuna River', region:'Delhi, India', lat:28.667, lon:77.244 },
];
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
