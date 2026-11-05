import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Play, RefreshCw, ShieldAlert, Waves } from 'lucide-react';
import './model-forecast.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
const fmt = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (p: number | null | undefined) => {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  if (p < 0.005) return '<1%';
  return `${Math.round(p * 100)}%`;
};

/** Last 14 observed days, then the forecast. The chart follows the selected forecast day: that day's point, band and
 *  date are highlighted and the rain after it is faded. */
function Spark({ d, active }: { d: Json; active: number }) {
  const W = 360, H = 132, L = 4, R = 4, T = 14, CH = 78, RB = 100; // chart area ends at CH; rain bars sit between CH+6 and RB
  const obs: { x: number; v: number }[] = d.recent.slice(-14).map((r: Json, i: number) => ({ x: i, v: r.cfs }));
  const n = obs.length;
  const base = new Date(d.origin_date + 'T12:00:00').getTime();
  const fut = d.horizons.map((h: Json) => ({
    x: n - 1 + h.horizon_days,
    d: h.horizon_days,
    v: h.point_cfs,
    lo: h.lo_cfs ?? h.point_cfs,
    hi: h.hi_cfs ?? h.point_cfs,
  }));
  const maxX = n - 1 + 7;
  const vals = [...obs.map((o) => o.v), ...fut.flatMap((f: Json) => [f.lo, f.hi])];
  const span = Math.max(...vals) - Math.min(...vals);
  const pad = Math.max(span * 0.12, Math.max(...vals) * 0.01);
  const maxV = Math.max(...vals) + pad,
    minV = Math.max(0, Math.min(...vals) - pad);
  const x = (i: number) => L + (i / maxX) * (W - L - R);
  const y = (v: number) => T + (1 - (v - minV) / (maxV - minV || 1)) * (CH - T);
  const last = obs[obs.length - 1];
  const ai = Math.max(0, fut.findIndex((f: Json) => f.d === active));
  const upTo = fut.slice(0, ai + 1);
  const act = fut[ai];
  const pt = (o: { x: number; v: number }, first: boolean) =>
    `${first ? 'M' : 'L'}${x(o.x).toFixed(1)},${y(o.v).toFixed(1)}`;
  const line = obs.map((o, i) => pt(o, i === 0)).join('');
  const fullF =
    `M${x(last.x).toFixed(1)},${y(last.v).toFixed(1)}` +
    fut.map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.v).toFixed(1)}`).join('');
  const activeF =
    `M${x(last.x).toFixed(1)},${y(last.v).toFixed(1)}` +
    upTo.map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.v).toFixed(1)}`).join('');
  const band =
    `M${x(last.x).toFixed(1)},${y(last.v).toFixed(1)}` +
    upTo.map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.hi).toFixed(1)}`).join('') +
    [...upTo].reverse().map((f: Json) => `L${x(f.x).toFixed(1)},${y(f.lo).toFixed(1)}`).join('') +
    'Z';
  const q90 = d.threshold_q90_cfs;
  const rain: { x: number; mm: number; day: number }[] = (d.rain_forecast ?? []).map(
    (r: Json, i: number) => ({ x: n + i, mm: r.mm ?? 0, day: i + 1 })
  );
  const rmax = Math.max(10, ...rain.map((r) => r.mm));
  const bw = ((W - L - R) / maxX) * 0.62;
  const target = new Date(base + act.d * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const labelX = Math.min(W - 52, Math.max(L + 52, x(act.x)));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mf-spark"
      role="img"
      aria-label={`Recent discharge and the model forecast for day +${act.d}`}
    >
      {q90 > minV && q90 < maxV && <line x1={L} x2={W - R} y1={y(q90)} y2={y(q90)} className="mf-thr" />}
      <line x1={x(n - 1)} x2={x(n - 1)} y1={T} y2={RB} className="mf-now" />
      <line x1={x(act.x)} x2={x(act.x)} y1={T} y2={RB} className="mf-target" />
      <path d={band} className="mf-band" />
      <path d={line} className="mf-obs" fill="none" />
      <path d={fullF} className="mf-fc mf-faded" fill="none" />
      <path d={activeF} className="mf-fc" fill="none" />
      {fut.map(
        (f: Json, i: number) =>
          i !== ai && <circle key={i} cx={x(f.x)} cy={y(f.v)} r="2.5" className="mf-dot mf-faded" />
      )}
      <circle cx={x(act.x)} cy={y(act.v)} r="6" className="mf-dot-ring" />
      <circle cx={x(act.x)} cy={y(act.v)} r="3.6" className="mf-dot" />
      <text x={labelX} y={T - 3} textAnchor="middle" className="mf-label">
        {`+${act.d}d · ${Math.round(act.v).toLocaleString('en-US')} cfs`}
      </text>
      {rain.map(
        (r, i) =>
          r.mm > 0 && (
            <rect
              key={i}
              x={x(r.x) - bw / 2}
              y={RB - (r.mm / rmax) * (RB - CH - 6)}
              width={bw}
              height={(r.mm / rmax) * (RB - CH - 6)}
              className="mf-rainbar"
              style={{ opacity: r.day <= act.d ? 0.9 : 0.25 }}
            >
              <title>{`${d.rain_forecast[i].date}: ${r.mm.toFixed(1)} mm`}</title>
            </rect>
          )
      )}
      <line x1={L} x2={W - R} y1={RB} y2={RB} className="mf-rainbase" />
      <text x={L} y={H - 4} className="mf-axis">
        {new Date(base - (n - 1) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </text>
      <text x={x(n - 1)} y={H - 4} textAnchor="middle" className="mf-axis">
        latest data
      </text>
      <text x={Math.min(W - 24, Math.max(L + 24, x(act.x)))} y={H - 4} textAnchor="middle" className="mf-axis mf-axis-strong">
        {target}
      </text>
      <text x={L + 2} y={RB - (RB - CH - 6) - 1} className="mf-axis mf-raintext">
        rain forecast
      </text>
    </svg>
  );
}

/** Model forecasts replayed over the last 30 observed days and scored against what NWIC actually recorded. */
function Hindcast({ h }: { h: Json }) {
  const [hz, setHz] = useState('1');
  const ser = h.series[hz];
  const W = 360, H = 90, L = 4, R = 4, T = 6, B = 4;
  const all: number[] = ser ? [...ser.observed, ...ser.model] : [1];
  const max = Math.max(...all) * 1.05, min = Math.min(...all) * 0.95;
  const x = (i: number) => L + (i / Math.max(1, ser.observed.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const path = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div className="mf-hind">
      <div className="mf-hind-head">
        <strong>Model vs what NWIC recorded</strong>
        <span className="mf-seg">
          {Object.keys(h.horizons).map((k) => (
            <button key={k} className={hz === k ? 'on' : ''} onClick={() => setHz(k)}>
              {k}d
            </button>
          ))}
        </span>
      </div>
      {ser && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mf-spark" role="img" aria-label="Observed vs model over the last 30 days">
          <path d={path(ser.persistence)} className="mf-pers" fill="none" />
          <path d={path(ser.observed)} className="mf-obs" fill="none" />
          <path d={path(ser.model)} className="mf-fc" fill="none" />
        </svg>
      )}
      <div className="mf-legend">
        <i className="o" /> observed <i className="m" /> model <i className="p" /> persistence
      </div>
      <p className="mf-muted">
        {h.window_days}-day replay, forecasts made {hz} day{hz === '1' ? '' : 's'} ahead using only data available at the
        time. Error (RMSE): model <b>{fmt(h.horizons[hz].rmse_model)}</b> cfs vs persistence{' '}
        <b>{fmt(h.horizons[hz].rmse_persistence)}</b> cfs ({fmt(h.horizons[hz].rmse_ratio, 2)}×, below 1 is better).
      </p>
    </div>
  );
}

export default function ModelForecastCard({
  usgs,
  nwic,
  river,
  onSimulate,
  onData,
}: {
  usgs?: string;
  nwic?: string;
  river: string;
  onSimulate: (riseMetres: number, label: string) => void;
  onData?: (d: Json | null) => void;
}) {
  const [state, setState] = useState<{ data: Json; error: string | null; offline: boolean; loading: boolean }>({
    data: null,
    error: null,
    offline: false,
    loading: false,
  });
  const [tick, setTick] = useState(0);
  const [activeHorizon, setActiveHorizon] = useState<number>(1);

  useEffect(() => {
    const query = usgs ? `station=${encodeURIComponent(usgs)}` : nwic ? `india=${encodeURIComponent(nwic)}` : null;
    onData?.(null);
    if (!query) {
      setState({ data: null, error: null, offline: false, loading: false });
      return;
    }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null, offline: false }));
    fetch(`/api/live_forecast?${query}`, { signal: ctl.signal })
      .then(async (r) => {
        const text = await r.text();
        let body: Json = null;
        try {
          body = JSON.parse(text);
        } catch {
          /* not JSON: dev server had no proxy target */
        }
        if (!body) throw Object.assign(new Error('offline'), { offline: true });
        if (!r.ok || body.error) throw new Error(body.error ?? `HTTP ${r.status}`);
        setState({ data: body, error: null, offline: false, loading: false });
        onData?.(body);
      })
      .catch((e: Json) => {
        if (!ctl.signal.aborted)
          setState({
            data: null,
            error: e.offline ? null : String(e.message ?? e),
            offline: !!e.offline || e instanceof TypeError,
            loading: false,
          });
      });
    return () => ctl.abort();
  }, [usgs, nwic, tick]);

  const d = state.data;
  const activeH = d?.horizons?.find((h: Json) => h.horizon_days === activeHorizon) || d?.horizons?.[0];

  return (
    <section className="mf-card" aria-label="Model forecast for the simulation">
      <div className="mf-head">
        <span className="mf-title">
          <Bot size={15} /> ML model forecast
        </span>
        {(usgs || nwic) && (
          <button
            className="mf-icon"
            onClick={() => setTick((t) => t + 1)}
            title="Refresh with the latest data"
            aria-label="Refresh forecast"
          >
            <RefreshCw size={13} className={state.loading ? 'spin' : ''} />
          </button>
        )}
      </div>

      {!usgs && !nwic && (
        <div className="mf-empty-state">
          <Waves size={20} className="mf-empty-icon" />
          <p className="mf-muted">
            No live USGS/NWIC discharge telemetry feed is linked to <b>{river}</b>. The BASINSHIFT ML model requires recent
            observed discharge to produce auto-regressive multi-horizon forecasts.
          </p>
        </div>
      )}

      {(usgs || nwic) && state.loading && !d && (
        <div className="mf-loading-state">
          <RefreshCw size={15} className="spin" />
          <span>Fetching live telemetry and evaluating BASINSHIFT model…</span>
        </div>
      )}

      {(usgs || nwic) && state.offline && (
        <div className="mf-offline">
          <AlertTriangle size={14} />
          <div>
            <strong>Model server is not running.</strong> Start it in a second terminal:
            <code>python -m server.model_api</code>
          </div>
        </div>
      )}

      {(usgs || nwic) && state.error && (
        <div className="mf-offline">
          <AlertTriangle size={14} />
          <div>
            <strong>Forecast unavailable.</strong> {state.error}
          </div>
        </div>
      )}

      {d && (
        <>
          {d.new_river && (
            <p className="mf-newriver">
              <b>New river</b>: Not in training data. Live observed flow from India's NWIC portal.
            </p>
          )}

          {/* Quick Telemetry Chips */}
          <div className="mf-telemetry-chips">
            <div className="mf-chip">
              <span className="mf-chip-lbl">Latest Observed</span>
              <strong className="mf-chip-val">{fmt(d.latest_observed_cfs)} cfs</strong>
            </div>
            <div className="mf-chip">
              <span className="mf-chip-lbl">High Flow (Q90)</span>
              <strong className="mf-chip-val">{fmt(d.threshold_q90_cfs)} cfs</strong>
            </div>
          </div>

          {/* Sparkline Visual */}
          <Spark d={d} active={activeHorizon} />

          {Array.isArray(d.rain_forecast) && d.rain_forecast.length > 0 && (() => {
            const mm = d.rain_forecast.map((r: Json) => r.mm ?? 0);
            const tot = mm.reduce((a: number, b: number) => a + b, 0);
            return (
              <p className="mf-rainnote">
                Rain forecast, next 7 days: <b>{tot.toFixed(0)} mm</b>
                {tot < 3 ? ' (dry week, steady flow expected)' : ` (peak ${Math.max(...mm).toFixed(0)} mm/day)`}.
              </p>
            );
          })()}

          {/* Days Pills Menu */}
          <div className="mf-days-pills-row">
            <span className="mf-days-label">Horizon:</span>
            <div className="mf-days-pills" role="tablist" aria-label="Forecast horizons">
              {d.horizons.map((h: Json) => (
                <button
                  key={h.horizon_days}
                  type="button"
                  role="tab"
                  aria-selected={activeHorizon === h.horizon_days}
                  className={`mf-day-pill ${activeHorizon === h.horizon_days ? 'active' : ''}`}
                  onClick={() => {
                    setActiveHorizon(h.horizon_days);
                    if (h.rise_point_m !== undefined) {
                      onSimulate(h.rise_point_m, `Assumed rise +${h.horizon_days}d`);
                    }
                  }}
                  title={`+${h.horizon_days}d: ${fmt(h.point_cfs)} cfs${
                    h.rise_point_m !== undefined ? ` · Explore +${h.rise_point_m.toFixed(1)}m` : ''
                  }`}
                >
                  +{h.horizon_days}d
                </button>
              ))}
            </div>

            {d.model && (
              <span className="mf-model-badge">
                {d.model}
              </span>
            )}
          </div>

          {/* Detailed Horizon Stat Box */}
          {activeH && (
            <div className="mf-horizon-card">
              <div className="mf-horizon-header">
                <div>
                  <span className="mf-horizon-title">+{activeH.horizon_days}-Day Forecast</span>
                  <div className="mf-horizon-flow">
                    <strong>{fmt(activeH.point_cfs)}</strong>
                    <span>cfs</span>
                    {activeH.rise_point_m !== undefined && (
                      <span className="mf-horizon-rise-badge">+{activeH.rise_point_m.toFixed(1)}m rise</span>
                    )}
                  </div>
                </div>

                {activeH.rise_point_m !== undefined && (
                  <button
                    type="button"
                    className="mf-simulate-btn"
                    onClick={() => onSimulate(activeH.rise_point_m, `Forecast +${activeH.horizon_days}d`)}
                    title={`Simulate +${activeH.rise_point_m.toFixed(1)}m water rise on 3D map`}
                  >
                    <Play size={12} />
                    <span>Apply Rise</span>
                  </button>
                )}
              </div>

              <div className="mf-horizon-metrics-grid">
                <div className="mf-submetric">
                  <span className="lbl">90% Range</span>
                  <span className="val">
                    {activeH.lo_cfs != null && activeH.hi_cfs != null
                      ? `${fmt(activeH.lo_cfs)} – ${fmt(activeH.hi_cfs)}`
                      : '—'}
                  </span>
                </div>
                <div className="mf-submetric">
                  <span className="lbl">Flood Risk (Q90)</span>
                  <span className={`val ${activeH.p_high_flow >= 0.2 ? 'risk-high' : 'risk-normal'}`}>
                    {pct(activeH.p_high_flow)}
                  </span>
                </div>
                <div className="mf-submetric">
                  <span className="lbl">Extreme (Q99)</span>
                  <span className="val">{pct(activeH.p_extreme_flow)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Hindcast for Indian NWIC stations */}
          {d.hindcast && Object.keys(d.hindcast.horizons).length > 0 && (
            <div className="mf-details-scroll">
              <Hindcast h={d.hindcast} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
