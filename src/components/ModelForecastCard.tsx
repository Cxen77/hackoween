import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Download, Play, RefreshCw } from 'lucide-react';
import { toBasinshiftRecord } from '../modelMetrics.mjs';
import './model-forecast.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
const fmt = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (p: number) => (p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

/** Mini chart: last 30 observed days, then the 3 forecast points with their 90% band. */
function Spark({ d }: { d: Json }) {
  const W = 360, H = 96, L = 4, R = 4, T = 6, B = 14;
  const obs: { x: number; v: number }[] = d.recent.map((r: Json, i: number) => ({ x: i, v: r.cfs }));
  const n = obs.length;
  const base = new Date(d.origin_date + 'T12:00:00').getTime();
  const fut = d.horizons.map((h: Json) => ({ x: n - 1 + h.horizon_days, v: h.point_cfs, lo: h.lo_cfs ?? h.point_cfs, hi: h.hi_cfs ?? h.point_cfs }));
  const maxX = n - 1 + 7;
  const all = [...obs.map(o => o.v), ...fut.flatMap((f: Json) => [f.lo, f.hi]), d.threshold_q90_cfs * 0 + 1];
  const maxV = Math.max(...all) * 1.08, minV = Math.min(...all.filter(v => v > 0)) * 0.9;
  const x = (i: number) => L + (i / maxX) * (W - L - R);
  const y = (v: number) => T + (1 - (v - minV) / (maxV - minV || 1)) * (H - T - B);
  const line = obs.map((o, i) => `${i ? 'L' : 'M'}${x(o.x).toFixed(1)},${y(o.v).toFixed(1)}`).join('');
  const last = obs[obs.length - 1];
  const fpath = `M${x(last.x).toFixed(1)},${y(last.v).toFixed(1)}` + fut.map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.v).toFixed(1)}`).join('');
  const band = `M${x(last.x).toFixed(1)},${y(last.v).toFixed(1)}` + fut.map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.hi).toFixed(1)}`).join('')
    + [...fut].reverse().map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.lo).toFixed(1)}`).join('') + 'Z';
  const q90 = d.threshold_q90_cfs;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mf-spark" role="img" aria-label="Recent discharge and model forecast">
      {q90 > minV && q90 < maxV && <line x1={L} x2={W - R} y1={y(q90)} y2={y(q90)} className="mf-thr" />}
      <line x1={x(n - 1)} x2={x(n - 1)} y1={T} y2={H - B} className="mf-now" />
      <path d={band} className="mf-band" />
      <path d={line} className="mf-obs" fill="none" />
      <path d={fpath} className="mf-fc" fill="none" />
      {fut.map((f: Json, i: number) => <circle key={i} cx={x(f.x)} cy={y(f.v)} r="3" className="mf-dot" />)}
      <text x={L} y={H - 2} className="mf-axis">{new Date(base - (n - 1) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>
      <text x={x(n - 1)} y={H - 2} textAnchor="middle" className="mf-axis">latest data</text>
      <text x={W - R} y={H - 2} textAnchor="end" className="mf-axis">+7 days</text>
    </svg>
  );
}

export default function ModelForecastCard({ usgs, river, onSimulate }: { usgs?: string; river: string; onSimulate: (riseMetres: number, label: string) => void }) {
  const [state, setState] = useState<{ data: Json; error: string | null; offline: boolean; loading: boolean }>({ data: null, error: null, offline: false, loading: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!usgs) { setState({ data: null, error: null, offline: false, loading: false }); return; }
    const ctl = new AbortController();
    setState(s => ({ ...s, loading: true, error: null, offline: false }));
    fetch(`/api/live_forecast?station=${encodeURIComponent(usgs)}`, { signal: ctl.signal })
      .then(async r => {
        const text = await r.text();
        let body: Json = null;
        try { body = JSON.parse(text); } catch { /* not JSON: dev server had no proxy target */ }
        if (!body) throw Object.assign(new Error('offline'), { offline: true });
        if (!r.ok || body.error) throw new Error(body.error ?? `HTTP ${r.status}`);
        setState({ data: body, error: null, offline: false, loading: false });
      })
      .catch((e: Json) => { if (!ctl.signal.aborted) setState({ data: null, error: e.offline ? null : String(e.message ?? e), offline: !!e.offline || e instanceof TypeError, loading: false }); });
    return () => ctl.abort();
  }, [usgs, tick]);

  const exportJson = useCallback(() => {
    if (!state.data) return;
    const blob = new Blob([JSON.stringify(toBasinshiftRecord(state.data), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `basinshift-forecast-${state.data.station}.json`; a.click(); URL.revokeObjectURL(a.href);
  }, [state.data]);

  const d = state.data;
  return (
    <section className="mf-card" aria-label="Model forecast for the simulation">
      <div className="mf-head">
        <span className="mf-title"><Bot size={15} /> ML model forecast</span>
        {usgs && <button className="mf-icon" onClick={() => setTick(t => t + 1)} title="Refresh with the latest data" aria-label="Refresh forecast"><RefreshCw size={13} /></button>}
      </div>
      {!usgs && <p className="mf-muted">The discharge model was trained only on US USGS gauges, so it does not cover {river}. It needs that river's own discharge history before it can forecast.</p>}
      {usgs && state.loading && !d && <p className="mf-muted">Fetching live USGS discharge and weather, then running the model…</p>}
      {usgs && state.offline && (
        <div className="mf-offline">
          <AlertTriangle size={14} />
          <div><strong>Model server is not running.</strong> Start it in a second terminal, then press refresh:
            <code>python -m server.model_api</code></div>
        </div>)}
      {usgs && state.error && <div className="mf-offline"><AlertTriangle size={14} /><div><strong>Forecast unavailable.</strong> {state.error}</div></div>}
      {d && (<>
        <p className="mf-muted">Using real data up to <b>{d.origin_date}</b>: latest flow <b>{fmt(d.latest_observed_cfs)} cfs</b>. High-flow level (Q90) for this gauge is {fmt(d.threshold_q90_cfs)} cfs.</p>
        <Spark d={d} />
        <div className="mf-rows">
          {d.horizons.map((h: Json) => (
            <div key={h.horizon_days} className="mf-row">
              <div className="mf-row-main">
                <span className="mf-day">+{h.horizon_days}d</span>
                <span><b>{fmt(h.point_cfs)}</b> cfs <small>({h.lo_cfs === null ? 'no band' : `${fmt(h.lo_cfs)}–${fmt(h.hi_cfs)}`})</small></span>
              </div>
              <div className="mf-row-sub">
                <span title="Probability flow exceeds this gauge's 90th-percentile level">High flow {pct(h.p_high_flow)}</span>
                <span title="Probability flow exceeds this gauge's 99th-percentile level">Extreme {pct(h.p_extreme_flow)}</span>
                {h.rise_point_m !== undefined && (
                  <button className="mf-sim" onClick={() => onSimulate(h.rise_point_m, `Model +${h.horizon_days}d`)} title={`Set the 3D water rise to +${h.rise_point_m} m (${fmt(h.stage_point_ft, 1)} ft gauge height)`}>
                    <Play size={11} /> Simulate {h.rise_point_m.toFixed(1)} m{h.extrapolated ? '*' : ''}
                  </button>)}
              </div>
            </div>))}
        </div>
        <p className="mf-foot">
          {d.rating
            ? <>Flow → water level uses this gauge's own last 30 days ({fmt(d.rating.n)} readings, fit R² {d.rating.r2.toFixed(3)}, observed {fmt(d.rating.q_min)}–{fmt(d.rating.q_max)} cfs). {d.horizons.some((h: Json) => h.extrapolated) && '* = outside the observed range, so extrapolated.'}</>
            : 'No stage rating available for this gauge; showing discharge only.'}
        </p>
        {d.warnings?.map((w: string) => <p key={w} className="mf-warn"><AlertTriangle size={12} /> {w}</p>)}
        <div className="mf-actions">
          <button className="mf-btn" onClick={exportJson}><Download size={13} /> Export in BASINSHIFT format</button>
        </div>
        <p className="mf-foot">Research model, not a flood warning. Soil moisture comes from a forecast model and is approximate.</p>
      </>)}
    </section>
  );
}
