import React, { useState, useRef, useEffect } from 'react';
import { CloudRain, Check, Pause, RefreshCw, MoreHorizontal, Info } from 'lucide-react';
import type { Forecast, Weather, Station, Remote } from '../data';
import { number } from '../data';

interface HydrographOutlookProps {
  forecast: Remote<Forecast>;
  weather: Remote<Weather>;
  station: Station;
  day: number;
  setDay: (n: number) => void;
  unit: string;
  setUnit: (u: string) => void;
  auto: boolean;
  setAuto: (a: boolean) => void;
  setRefresh: React.Dispatch<React.SetStateAction<number>>;
  setSources: (s: boolean) => void;
  /** Live data from the FloodCast model server (observed flow + model forecast), or null when unavailable. */
  modelLive?: any;
}

const dateLabel = (v: string) => new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fullDateLabel = (v: string) => new Date(v + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const dayOfWeek = (v: string) => new Date(v + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });

function getCurvedPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 5;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 5;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 5;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 5;
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export default function HydrographOutlookCard({
  forecast,
  weather,
  station,
  day,
  setDay,
  unit,
  setUnit,
  auto,
  setAuto,
  setRefresh,
  setSources,
  modelLive,
}: HydrographOutlookProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [showMenu]);

  const rawValues = forecast.data?.daily.river_discharge ?? [];
  const valid = rawValues.filter((v): v is number => v != null && Number.isFinite(v));
  const scale = unit === 'cfs' ? 35.3146667 : 1;

  if (forecast.error) {
    return (
      <section className="forecast-card hydrograph-reference-card">
        <div className="forecast-heading">
          <div>
            <h3>River Discharge & Hydrograph Outlook</h3>
            <p>Seven-day multi-model streamflow projection & baseline telemetry</p>
          </div>
        </div>
        <div className="error-state">
          <span>GloFAS forecast service returned an error ({forecast.error}).</span>
          <button onClick={() => setRefresh(n => n + 1)}>Retry</button>
        </div>
      </section>
    );
  }

  if (!valid.length) {
    return (
      <section className="forecast-card hydrograph-reference-card">
        <div className="forecast-heading">
          <div>
            <h3>River Discharge & Hydrograph Outlook</h3>
            <p>Seven-day multi-model streamflow projection & baseline telemetry</p>
          </div>
        </div>
        <div className="empty-chart">
          <RefreshCw className="spin" size={18} />
          <span>Synchronizing multi-model streamflow predictions…</span>
        </div>
      </section>
    );
  }

  // Three series, all real:
  //  1. GloFAS: the global river model's forecast at the map point (Open-Meteo flood API).
  //  2. FloodCast model: our trained model's forecast from the gauge's own recent observed flow and the weather forecast,
  //     available on the days it predicts (+1, +3, +7 days after the latest reading), with its 90% interval.
  //  3. Latest observed flow held flat (the persistence baseline). Nothing is interpolated or invented.
  const times = forecast.data?.daily.time ?? [];
  const toUnit = unit === 'cfs' ? 1 : 1 / 35.3146667; // model and observed values arrive in cfs
  const fullGlofas = rawValues.map(v => (v == null ? 0 : v * scale));
  const fullMl: (number | null)[] = times.map(() => null);
  const fullLo: (number | null)[] = times.map(() => null);
  const fullHi: (number | null)[] = times.map(() => null);
  (modelLive?.horizons ?? []).forEach((h: any) => {
    const i = times.indexOf(h.target_date);
    if (i >= 0) {
      fullMl[i] = h.point_cfs * toUnit;
      fullLo[i] = h.lo_cfs == null ? null : h.lo_cfs * toUnit;
      fullHi[i] = h.hi_cfs == null ? null : h.hi_cfs * toUnit;
    }
  });
  const hasModel = fullMl.some(v => v !== null);
  // The model only forecasts +1, +3 and +7 days, so the chart shows only those days (no days it cannot predict).
  // `keep` holds the original day indices; the shared `day` state keeps using original indices.
  const keep = hasModel ? fullMl.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0) : fullGlofas.map((_, i) => i);
  const glofasSeries = keep.map(i => fullGlofas[i]);
  const mlVal = keep.map(i => fullMl[i]);
  const mlLo = keep.map(i => fullLo[i]);
  const mlHi = keep.map(i => fullHi[i]);
  const horizonOf = (i: number): number | null => (modelLive?.horizons ?? []).find((h: any) => h.target_date === times[i])?.horizon_days ?? null;
  const observedNow: number | null = modelLive?.latest_observed_cfs != null ? modelLive.latest_observed_cfs * toUnit : null;
  // Scale to the forecast lines, not the long upper tail of the 90% band (the band is clipped at the top of the chart).
  // GloFAS reads a grid cell that is sometimes not the gauged channel (e.g. 20 cfs next to 130,000 cfs observed). A line
  // that far off is not a forecast of this river, so it is hidden instead of drawn flat along the bottom.
  const glofasMean = glofasSeries.reduce((a, b) => a + b, 0) / Math.max(1, glofasSeries.length);
  const glofasOff = hasModel && observedNow !== null && observedNow > 0 && (glofasMean < observedNow / 5 || glofasMean > observedNow * 5);
  const allVals = [...(glofasOff ? [] : glofasSeries), ...mlVal, ...(observedNow !== null ? [observedNow] : [])].filter((v): v is number => v !== null && Number.isFinite(v));
  const peakVal = Math.max(...allVals) * 1.15 || 1;

  // Chart Geometry (viewBox: 800 x 280)
  const chartW = 800;
  const chartH = 280;
  const padLeft = 70;
  const padRight = 45;
  const padTop = 30;
  const padBottom = 65;
  const plotW = chartW - padLeft - padRight;
  const plotH = chartH - padTop - padBottom;

  const count = keep.length;
  const getX = (i: number) => padLeft + (i * plotW) / Math.max(1, count - 1);
  const getY = (val: number) => padTop + plotH - (val / peakVal) * plotH;

  const ptsGlofas: [number, number][] = glofasSeries.map((v, i) => [getX(i), getY(v)]);
  const mlIdx = mlVal.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
  const ptsML: [number, number][] = mlIdx.map(i => [getX(i), getY(mlVal[i] as number)]);
  const line = (pts: [number, number][]) => pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const bandIdx = mlIdx.filter(i => mlLo[i] !== null && mlHi[i] !== null);
  const pathBand = bandIdx.length > 1
    ? `${line(bandIdx.map(i => [getX(i), Math.max(padTop, getY(mlHi[i] as number))] as [number, number]))} ${[...bandIdx].reverse().map(i => `L${getX(i).toFixed(1)},${getY(mlLo[i] as number).toFixed(1)}`).join(' ')} Z`
    : '';
  const pathGlofas = getCurvedPath(ptsGlofas);
  const pathML = ptsML.length > 1 ? line(ptsML) : '';
  const pathBaseline = observedNow !== null ? `M${getX(0).toFixed(1)},${getY(observedNow).toFixed(1)} L${getX(count - 1).toFixed(1)},${getY(observedNow).toFixed(1)}` : '';

  // Active or hovered day
  const dayPos = Math.max(0, keep.indexOf(day));
  const activeIdx = hoverIndex !== null && hoverIndex < count ? hoverIndex : dayPos;
  const activeX = getX(activeIdx);
  const activeDateStr = forecast.data?.daily.time[keep[activeIdx]] ?? '';
  const activeRain = weather.data?.daily.precipitation_sum?.[keep[activeIdx]];

  // Grid levels (5 horizontal grid lines)
  const gridLevels = [1, 0.75, 0.5, 0.25, 0];

  return (
    <section className="forecast-card hydrograph-reference-card">
      {/* Header Row */}
      <div className="forecast-heading">
        <div>
          <h3>River Discharge & Hydrograph Outlook</h3>
          <p>{hasModel ? 'Forecast at +1, +3 and +7 days: FloodCast model vs GloFAS, with the latest observed flow' : 'Seven-day multi-model streamflow projection & baseline comparison'}</p>
        </div>
        <div className="forecast-header-actions" ref={menuRef}>
          <div className="unit-toggle" aria-label="Discharge units">
            {['cfs', 'm³/s'].map(u => (
              <button
                key={u}
                className={unit === u ? 'active' : ''}
                onClick={() => setUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="card-menu-btn"
            onClick={() => setShowMenu(!showMenu)}
            title="Options & Data Methodology"
            aria-label="Options"
          >
            <MoreHorizontal size={18} />
          </button>
          {showMenu && (
            <div className="card-dropdown-menu">
              <button onClick={() => { setSources(true); setShowMenu(false); }}>
                <Info size={14} /> Methodology & Sources
              </button>
              <button onClick={() => { setRefresh(n => n + 1); setShowMenu(false); }}>
                <RefreshCw size={14} /> Refresh Forecast
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Metric Banner */}
      <div className="forecast-summary">
        <div className="summary-left">
          <strong className="forecast-metric-val">
            {number(mlVal[dayPos] !== null ? (mlVal[dayPos] as number) : glofasSeries[dayPos])}
            <small> {unit}</small>
          </strong>
          <span className="forecast-date">
            {activeDateStr ? fullDateLabel(activeDateStr) : 'Today'} · {mlVal[dayPos] !== null ? 'FloodCast model' : 'GloFAS'}
          </span>
        </div>
        <div className="weather-summary">
          <CloudRain size={16} />
          <span>{number(activeRain, 1)} mm daily precipitation</span>
        </div>
      </div>

      {/* Modern Multi-Series Chart Container */}
      <div className="hydrograph-chart-container">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="hydrograph-svg"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Subtle Horizontal Dashed Gridlines */}
          {gridLevels.map((lvl, idx) => {
            const y = padTop + plotH * (1 - lvl);
            const val = peakVal * lvl;
            return (
              <g key={idx} className="chart-grid-line-group">
                <text
                  x={padLeft - 12}
                  y={y + 4}
                  textAnchor="end"
                  className="chart-axis-tick-text"
                >
                  {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : Math.round(val)}
                </text>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={chartW - padRight}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              </g>
            );
          })}

          {/* 3 Spline Curves matching the Reference Image */}
          {/* 1. Latest observed flow held flat (persistence baseline, dark slate) */}
          {pathBaseline && (
            <path d={pathBaseline} fill="none" stroke="#475569" strokeWidth="2" strokeDasharray="7 6" strokeLinecap="round" className="curve-baseline" />
          )}

          {/* 2. FloodCast model: 90% interval and forecast, drawn only where the model predicts */}
          {pathBand && <path d={pathBand} fill="rgba(249, 115, 22, 0.16)" stroke="none" />}
          {pathML && (
            <path d={pathML} fill="none" stroke="#f97316" strokeWidth="3.25" strokeLinecap="round" strokeLinejoin="round" className="curve-ml" />
          )}
          {ptsML.map((p, k) => (
            <circle key={k} cx={p[0]} cy={p[1]} r="4.5" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
          ))}

          {/* 3. GloFAS Forecast (River Cyan / Primary Blue) */}
          {!glofasOff && <path
            d={pathGlofas}
            fill="none"
            stroke="#0284c7"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="curve-glofas"
          />}

          {/* Vertical Dotted Guide Hairline at Hovered/Active Point */}
          <line
            x1={activeX}
            y1={padTop}
            x2={activeX}
            y2={padTop + plotH}
            stroke="#cbd5e1"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          {/* Circular Marker Rings at Active Point on Each Curve */}
          {/* FloodCast marker at the active day, only if the model predicts that day */}
          {mlVal[activeIdx] !== null && (
            <circle cx={activeX} cy={getY(mlVal[activeIdx] as number)} r="7" fill="none" stroke="#f97316" strokeWidth="2.5" />
          )}
          {/* GloFAS Marker */}
          {!glofasOff && <circle
            cx={activeX}
            cy={ptsGlofas[activeIdx][1]}
            r="6"
            fill="#ffffff"
            stroke="#0284c7"
            strokeWidth="3.5"
          />}

          {/* X-Axis Ticks (Dates / Days beneath the chart) */}
          {keep.map((orig, i) => {
            const d = times[orig];
            const x = getX(i);
            const isChosen = activeIdx === i;
            return (
              <g
                key={d}
                className={`chart-x-tick ${isChosen ? 'selected' : ''}`}
                onClick={() => setDay(orig)}
                onMouseEnter={() => setHoverIndex(i)}
                style={{ cursor: 'pointer' }}
              >
                <text
                  x={x}
                  y={chartH - 24}
                  textAnchor="middle"
                  className={`chart-date-label ${isChosen ? 'active-date' : ''}`}
                >
                  {orig === 0 ? 'Today' : `${dayOfWeek(d)} ${dateLabel(d).split(' ')[1]}`}
                  {horizonOf(orig) != null && <tspan x={x} dy="13" className="chart-horizon">+{horizonOf(orig)} day{horizonOf(orig) === 1 ? '' : 's'}</tspan>}
                </text>
                {/* Transparent click target column */}
                <rect
                  x={x - (plotW / Math.max(1, count - 1)) / 2}
                  y={padTop}
                  width={plotW / Math.max(1, count - 1)}
                  height={plotH + 30}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip Card Matching the Reference Image */}
        <div
          className={`hydrograph-floating-tooltip ${activeX > chartW / 2 ? 'tooltip-left' : 'tooltip-right'}`}
          style={{
            left: `${(activeX / chartW) * 100}%`,
          }}
        >
          <div className="tooltip-header">
            <strong>{activeDateStr ? fullDateLabel(activeDateStr) : 'Active Stage'}</strong>
          </div>
          <div className="tooltip-series-list">
            <div className="tooltip-row">
              <span className="tooltip-ring ring-blue" />
              <span className="tooltip-name">GloFAS Forecast:</span>
              <strong className="tooltip-val">{glofasOff ? 'off this river' : `${number(glofasSeries[activeIdx])} ${unit}`}</strong>
            </div>
            {hasModel && (
              <div className="tooltip-row">
                <span className="tooltip-ring ring-orange" />
                <span className="tooltip-name">FloodCast model:</span>
                <strong className="tooltip-val">
                  {mlVal[activeIdx] === null ? 'not predicted for this day' : `${number(mlVal[activeIdx] as number)} ${unit}`}
                </strong>
              </div>
            )}
            {hasModel && mlVal[activeIdx] !== null && mlLo[activeIdx] !== null && (
              <div className="tooltip-row">
                <span className="tooltip-name">90% range:</span>
                <strong className="tooltip-val">{number(mlLo[activeIdx] as number)}–{number(mlHi[activeIdx] as number)} {unit}</strong>
              </div>
            )}
            {observedNow !== null && (
              <div className="tooltip-row">
                <span className="tooltip-ring ring-slate" />
                <span className="tooltip-name">Latest observed:</span>
                <strong className="tooltip-val">{number(observedNow)} {unit}</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      {!hasModel && (
        <p className="hydro-note">
          {modelLive ? 'The FloodCast model predicts +1, +3 and +7 days after its latest reading; none of those days falls inside this chart.' : 'No FloodCast model data for this river yet (the model server may not be running, or the river has no live flow feed), so only GloFAS is shown.'}
        </p>
      )}

      {/* Centered Bottom Legend Matching the Reference Image */}
      <div className="hydrograph-legend-row">
        <div className="legend-item" onClick={() => setDay(keep[activeIdx])}>
          <span className="legend-ring ring-blue" />
          <span className="legend-label">GloFAS Forecast</span>
        </div>
        {hasModel && (
          <div className="legend-item" onClick={() => setDay(keep[activeIdx])}>
            <span className="legend-ring ring-orange" />
            <span className="legend-label">FloodCast Model</span>
          </div>
        )}
        {observedNow !== null && (
          <div className="legend-item" onClick={() => setDay(keep[activeIdx])}>
            <span className="legend-ring ring-slate" />
            <span className="legend-label">Latest Observed Flow</span>
          </div>
        )}
      </div>

      {/* Footer Attribution & Controls */}
      <div className="forecast-footer">
        <span className="footer-source">
          <span className="chart-key" />
          Copernicus GloFAS · FloodCast model on observed USGS / NWIC flow
        </span>
        <button
          type="button"
          className="auto-refresh-btn"
          onClick={() => setAuto(!auto)}
        >
          {auto ? <Check size={12} /> : <Pause size={12} />}
          <span>Auto-refresh {auto ? 'active (5 min)' : 'paused'}</span>
        </button>
        <span className="footer-fetched">
          {forecast.fetchedAt
            ? `Synced ${new Date(forecast.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Syncing…'}
        </span>
      </div>
    </section>
  );
}
