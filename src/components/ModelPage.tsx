import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Download, FileCheck2, FlaskConical, Gauge, LineChart, Play, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { scorePredictions, validateSubmission, validateBasinshiftOutput, toBasinshiftRecord } from '../modelMetrics.mjs';
import './model-page.css';

type Tab = 'results' | 'judge' | 'station' | 'score' | 'robust';
/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const fmt = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const useJson = (url: string) => {
  const [state, set] = useState<{ data: Json; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); })
      .then(d => live && set({ data: d, error: null })).catch(e => live && set({ data: null, error: String(e.message ?? e) }));
    return () => { live = false; };
  }, [url]);
  return state;
};

/* ---------- SVG time-series chart ---------- */
interface Line { name: string; color: string; values: (number | null)[]; dashed?: boolean }
function Chart({ dates, lines, band, logScale, refLines = [], height = 300 }: {
  dates: string[]; lines: Line[]; band?: { lo: (number | null)[]; hi: (number | null)[] }; logScale: boolean;
  refLines?: { label: string; value: number | null; color: string }[]; height?: number;
}) {
  const W = 900, H = height, L = 64, R = 16, T = 12, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const tf = (v: number) => (logScale ? Math.log10(Math.max(v, 1)) : v);
  const all = [...lines.flatMap(l => l.values), ...(band ? [...band.lo, ...band.hi] : []), ...refLines.map(r => r.value)]
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (!all.length || dates.length < 2) return <div className="mp-empty">No data in the selected range.</div>;
  const lo = logScale ? 0 : 0, hi = Math.max(...all.map(tf)) * 1.05 || 1;
  const x = (i: number) => L + (i / (dates.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (tf(v) - lo) / (hi - lo)) * (H - T - B);
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const bandPath = () => {
    if (!band) return '';
    const idx = dates.map((_, i) => i).filter(i => band.lo[i] !== null && band.hi[i] !== null);
    if (idx.length < 2) return '';
    return `M${idx.map(i => `${x(i).toFixed(1)},${y(band.hi[i] as number).toFixed(1)}`).join('L')}L${[...idx].reverse().map(i => `${x(i).toFixed(1)},${y(band.lo[i] as number).toFixed(1)}`).join('L')}Z`;
  };
  const ticks = logScale
    ? Array.from({ length: Math.floor(hi) + 1 }, (_, k) => k).map(k => ({ pos: k, label: fmt(10 ** k) }))
    : Array.from({ length: 5 }, (_, k) => ({ pos: (hi * k) / 4, label: fmt((hi * k) / 4) }));
  const xticks = dates.map((d, i) => ({ d, i })).filter(({ d }, i, a) => i === 0 || d.slice(0, 7) !== a[i - 1].d.slice(0, 7));
  const step = Math.max(1, Math.ceil(xticks.length / 8));
  return (
    <div className="mp-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="mp-chart" role="img" aria-label="Discharge time series"
        onMouseMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((px - L) / (W - L - R)) * (dates.length - 1)))));
        }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => { const yy = T + (1 - (t.pos - lo) / (hi - lo)) * (H - T - B); return (
          <g key={t.pos}><line x1={L} x2={W - R} y1={yy} y2={yy} className="mp-grid" /><text x={L - 8} y={yy + 4} textAnchor="end" className="mp-axis">{t.label}</text></g>); })}
        {xticks.filter((_, k) => k % step === 0).map(({ d, i }) => <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="mp-axis">{d.slice(0, 7)}</text>)}
        {refLines.filter(r => r.value !== null).map(r => (
          <g key={r.label}><line x1={L} x2={W - R} y1={y(r.value as number)} y2={y(r.value as number)} stroke={r.color} strokeDasharray="5 4" strokeWidth="1" />
            <text x={W - R - 4} y={y(r.value as number) - 4} textAnchor="end" className="mp-axis" fill={r.color}>{r.label}</text></g>))}
        {band && <path d={bandPath()} className="mp-band" />}
        {lines.map(l => <path key={l.name} d={path(l.values)} fill="none" stroke={l.color} strokeWidth="1.6" strokeDasharray={l.dashed ? '4 3' : undefined} />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="mp-cursor" />}
      </svg>
      {hover !== null && (
        <div className="mp-tooltip" style={{ left: `${Math.min(78, Math.max(2, ((x(hover) / W) * 100)))}%` }}>
          <strong>{dates[hover]}</strong>
          {lines.map(l => <div key={l.name}><i style={{ background: l.color }} />{l.name}: {fmt(l.values[hover])} cfs</div>)}
          {band && band.lo[hover] !== null && <div><i className="mp-band-swatch" />90% interval: {fmt(band.lo[hover])} – {fmt(band.hi[hover])}</div>}
        </div>)}
      <div className="mp-legend">
        {lines.map(l => <span key={l.name}><i style={{ background: l.color }} />{l.name}</span>)}
        {band && <span><i className="mp-band-swatch" />90% interval</span>}
      </div>
    </div>
  );
}

/* ---------- small helpers ---------- */
function seriesMetrics(actual: (number | null)[], pred: (number | null)[]) {
  const pairs = actual.map((a, i) => [a, pred[i]] as const).filter(([a, p]) => a !== null && p !== null && Number.isFinite(a) && Number.isFinite(p)) as [number, number][];
  if (pairs.length < 2) return null;
  const n = pairs.length, mean = pairs.reduce((s, [a]) => s + a, 0) / n;
  const sse = pairs.reduce((s, [a, p]) => s + (a - p) ** 2, 0), sst = pairs.reduce((s, [a]) => s + (a - mean) ** 2, 0);
  return { n, rmse: Math.sqrt(sse / n), mae: pairs.reduce((s, [a, p]) => s + Math.abs(a - p), 0) / n, bias: pairs.reduce((s, [a, p]) => s + (p - a), 0) / n, r2: sst > 0 ? 1 - sse / sst : NaN };
}
const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="mp-stat"><strong>{value}</strong><span>{label}</span>{hint && <small>{hint}</small>}</div>);
const toCsv = (rows: (string | number | null)[][]) => rows.map(r => r.map(v => (v === null ? '' : String(v))).join(',')).join('\n') + '\n';

/* ---------- tab: results ---------- */
function Results({ summary }: { summary: Json }) {
  const [set, setSet] = useState<'heldout' | 'caravan'>('caravan');
  const [h, setH] = useState('1');
  const f = summary.floodcast, b = summary.basinshift?.[set]?.horizons?.[h];
  const rows: [string, Json][] = b ? [['BASINSHIFT blend (this model)', b.blend], ['Persistence (yesterday\'s flow)', b.persistence], ['Seasonal climatology', b.climatology], ['Weather-only boosting', b.weather_only]] : [];
  const ev = (k: 'high_flow_q90' | 'extreme_flow_q99') => b?.[k];
  return (
    <div className="mp-grid2">
      <section className="mp-card">
        <div className="mp-eyebrow"><Gauge size={14} /> FLOODCAST submission model</div>
        <h3>Same-day discharge estimate</h3>
        <p className="mp-muted">{f.model}. Trained on {fmt(f.train_rows)} rows from {f.stations_trained} US gauges; scored on {fmt(f.test_rows)} rows from 2025.</p>
        <div className="mp-stats">
          <Stat label="RMSE (cfs)" value={fmt(f.overall.rmse)} hint={`median baseline ${fmt(f.median_baseline.rmse)}`} />
          <Stat label="Extreme RMSE (cfs)" value={fmt(f.overall.extreme_rmse)} hint={`median baseline ${fmt(f.median_baseline.extreme_rmse)}`} />
          <Stat label="MAE (cfs)" value={fmt(f.overall.mae)} hint={`median baseline ${fmt(f.median_baseline.mae)}`} />
          <Stat label="R²" value={fmt(f.overall.r2, 3)} hint="not an accuracy percentage" />
        </div>
        <p className="mp-note"><AlertTriangle size={13} /> {f.benchmark} Several stations score negative R²; the large Mississippi gauges dominate the error.</p>
      </section>

      <section className="mp-card">
        <div className="mp-eyebrow"><FlaskConical size={14} /> BASINSHIFT-style forecast system</div>
        <h3>Forecasts, intervals and exceedance probabilities</h3>
        <div className="mp-controls">
          <div className="mp-seg" role="tablist" aria-label="Test dataset">
            <button className={set === 'caravan' ? 'on' : ''} onClick={() => setSet('caravan')}>Caravan US basins</button>
            <button className={set === 'heldout' ? 'on' : ''} onClick={() => setSet('heldout')}>Held-out stations</button>
          </div>
          <div className="mp-seg" role="tablist" aria-label="Forecast horizon">
            {['1', '3', '7'].map(k => <button key={k} className={h === k ? 'on' : ''} onClick={() => setH(k)}>{k}-day</button>)}
          </div>
        </div>
        {b ? (<>
          <p className="mp-muted">{set === 'caravan'
            ? `Trained only on our 55 gauges; tested on ${fmt(summary.basinshift.caravan.stations)} independent small US basins from Caravan (2010–2020, ${fmt(summary.basinshift.caravan.rows)} days).`
            : `Trained without 11 gauges; tested on those unseen gauges for 2022–2024 (${fmt(summary.basinshift.heldout.rows)} days).`}</p>
          <table className="mp-table">
            <thead><tr><th>Method</th><th>RMSE</th><th>Extreme RMSE</th><th>MAE</th><th>Median NSE</th></tr></thead>
            <tbody>{rows.map(([name, m], i) => (
              <tr key={name} className={i === 0 ? 'hl' : ''}><td>{name}</td><td>{fmt(m.rmse)}</td><td>{fmt(m.extreme_rmse)}</td><td>{fmt(m.mae, 1)}</td><td>{fmt(m.median_basin_nse, 3)}</td></tr>))}</tbody>
          </table>
          <div className="mp-stats small">
            <Stat label="90% interval coverage" value={`${fmt(b.interval.coverage * 100, 1)}%`} hint="target 90%" />
            <Stat label="High-flow (Q90) AUPRC" value={fmt(ev('high_flow_q90').auprc, 3)} hint={`persistence ${fmt(ev('high_flow_q90').persistence_auprc, 3)}`} />
            <Stat label="Extreme (Q99) AUPRC" value={fmt(ev('extreme_flow_q99').auprc, 3)} hint={`persistence ${fmt(ev('extreme_flow_q99').persistence_auprc, 3)}`} />
            <Stat label="RMSE vs persistence" value={`${fmt(b.bootstrap.rmse_ratio_model_over_persistence_ci95[0], 3)}–${fmt(b.bootstrap.rmse_ratio_model_over_persistence_ci95[1], 3)}`} hint="95% CI by basin; below 1 is better" />
          </div>
          <p className="mp-note"><AlertTriangle size={13} /> NSE is computed per basin and the median is reported. Coverage below 90% means the intervals are too narrow on new catchments. Q99 detection is weak (rare events).</p>
        </>) : <div className="mp-empty">Results for this dataset are not available.</div>}
      </section>
    </div>
  );
}

/* ---------- tab: test a station ---------- */
function StationTest() {
  const prod = useJson('/reports/model/stations_2025.json');
  const bands = useJson('/reports/model/forecast_bands.json');
  const [mode, setMode] = useState<'prod' | 'forecast'>('forecast');
  const [id, setId] = useState('');
  const [h, setH] = useState('3');
  const [month, setMonth] = useState('all');
  const [logScale, setLogScale] = useState(false);
  const list: Json[] = (mode === 'prod' ? prod.data : bands.data) ?? [];
  useEffect(() => { if (list.length && !list.find(s => s.id === id)) setId(list[0].id); }, [mode, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = list.find(s => s.id === id);
  const sel = useMemo(() => {
    if (!st) return null;
    const keep = st.dates.map((d: string, i: number) => (month === 'all' || d.slice(5, 7) === month ? i : -1)).filter((i: number) => i >= 0);
    const pick = (a: Json[]) => keep.map((i: number) => a[i]);
    const hz = mode === 'forecast' ? st.horizons[h] : null;
    return { dates: pick(st.dates), actual: pick(st.actual), pred: pick(mode === 'prod' ? st.pred : hz.point), lo: hz && pick(hz.lo), hi: hz && pick(hz.hi),
             p90: hz && pick(hz.p90), p99: hz && pick(hz.p99), persistence: hz && pick(hz.persistence) };
  }, [st, mode, h, month]);
  const m = sel && seriesMetrics(sel.actual, sel.pred);
  const mp = sel && sel.persistence ? seriesMetrics(sel.actual, sel.persistence) : null;
  const cover = sel?.lo ? (() => { const v = sel.actual.map((a: number, i: number) => (sel.lo[i] === null ? null : a >= sel.lo[i] && a <= sel.hi[i])).filter((x: boolean | null) => x !== null); return v.length ? v.filter(Boolean).length / v.length : null; })() : null;
  const alerts = sel?.p90 ? (() => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    sel.actual.forEach((a: number, i: number) => { const e = a > st.threshold_q90, al = sel.p90[i] >= 0.5; if (e && al) tp++; else if (!e && al) fp++; else if (e && !al) fn++; else tn++; });
    return { tp, fp, fn, tn };
  })() : null;
  const worst = sel ? sel.dates.map((d: string, i: number) => ({ d, a: sel.actual[i], p: sel.pred[i], e: Math.abs(sel.actual[i] - sel.pred[i]) })).sort((x: Json, z: Json) => z.e - x.e).slice(0, 5) : [];
  const loading = mode === 'prod' ? prod.data === null && !prod.error : bands.data === null && !bands.error;
  const err = mode === 'prod' ? prod.error : bands.error;
  return (
    <section className="mp-card">
      <div className="mp-controls wrap">
        <div className="mp-seg" role="tablist" aria-label="Test mode">
          <button className={mode === 'forecast' ? 'on' : ''} onClick={() => setMode('forecast')}>Forecast + 90% band (unseen gauges, 2024)</button>
          <button className={mode === 'prod' ? 'on' : ''} onClick={() => setMode('prod')}>Production estimate (2025 benchmark)</button>
        </div>
        <label>Station <select value={id} onChange={e => setId(e.target.value)}>{list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {mode === 'forecast' && <label>Horizon <select value={h} onChange={e => setH(e.target.value)}>{['1', '3', '7'].map(k => <option key={k} value={k}>{k} day{k === '1' ? '' : 's'} ahead</option>)}</select></label>}
        <label>Month <select value={month} onChange={e => setMonth(e.target.value)}><option value="all">Whole year</option>
          {Array.from({ length: 12 }, (_, k) => String(k + 1).padStart(2, '0')).map(mm => <option key={mm} value={mm}>{new Date(2025, +mm - 1, 1).toLocaleString('en-US', { month: 'long' })}</option>)}</select></label>
        <label className="mp-check"><input type="checkbox" checked={logScale} onChange={e => setLogScale(e.target.checked)} /> Log scale</label>
      </div>
      {err && <div className="mp-error"><XCircle size={14} /> Could not load data: {err}</div>}
      {loading && <div className="mp-empty">Loading…</div>}
      {sel && st && (<>
        <p className="mp-muted">{mode === 'forecast'
          ? 'This gauge was held out of training. Each forecast uses only discharge known h days earlier, plus weather. Dashed grey = persistence (repeat the value from h days earlier).'
          : 'Production model: estimates the same-day flow from weather and catchment features, with no discharge input.'}</p>
        <Chart dates={sel.dates} logScale={logScale} height={320}
          lines={[{ name: 'Actual', color: '#0f172a', values: sel.actual }, { name: mode === 'forecast' ? `Forecast (${h}-day)` : 'Model estimate', color: '#0284c7', values: sel.pred },
            ...(sel.persistence ? [{ name: 'Persistence', color: '#94a3b8', values: sel.persistence, dashed: true }] : [])]}
          band={sel.lo ? { lo: sel.lo, hi: sel.hi } : undefined}
          refLines={mode === 'forecast' ? [{ label: 'High-flow threshold (Q90)', value: st.threshold_q90, color: '#d97706' }, { label: 'Extreme (Q99)', value: st.threshold_q99, color: '#e11d48' }] : []} />
        <div className="mp-stats small">
          <Stat label="RMSE (cfs)" value={fmt(m?.rmse)} hint={mp ? `persistence ${fmt(mp.rmse)}` : undefined} />
          <Stat label="MAE (cfs)" value={fmt(m?.mae)} hint={mp ? `persistence ${fmt(mp.mae)}` : undefined} />
          <Stat label="Bias (cfs)" value={fmt(m?.bias)} hint="positive = over-predicts" />
          <Stat label="R² (this selection)" value={fmt(m?.r2, 3)} hint={`${fmt(m?.n)} days`} />
          {cover !== null && <Stat label="Interval coverage" value={`${fmt(cover * 100, 1)}%`} hint="target 90%" />}
        </div>
        {alerts && (
          <div className="mp-alerts">
            <strong>High-flow alert test</strong> (alert when P(flow &gt; Q90) ≥ 0.5): caught <b>{alerts.tp}</b> of {alerts.tp + alerts.fn} high-flow days, <b>{alerts.fp}</b> false alarms, {fmt(alerts.tn)} correct quiet days.
            <div className="mp-prob">{sel.p90.map((p: number, i: number) => <i key={i} title={`${sel.dates[i]}: P=${p}`} style={{ height: `${Math.max(2, p * 100)}%`, opacity: sel.actual[i] > st.threshold_q90 ? 1 : 0.35 }} />)}</div>
            <small>Bars: forecast probability of exceeding the Q90 threshold each day; solid bars are days when it really happened.</small>
          </div>)}
        <h4>Five largest errors in this selection</h4>
        <table className="mp-table"><thead><tr><th>Date</th><th>Actual (cfs)</th><th>Model (cfs)</th><th>Error (cfs)</th></tr></thead>
          <tbody>{worst.map((w: Json) => <tr key={w.d}><td>{w.d}</td><td>{fmt(w.a)}</td><td>{fmt(w.p)}</td><td>{fmt(w.p - w.a)}</td></tr>)}</tbody></table>
      </>)}
    </section>
  );
}

/* ---------- tab: score your CSV ---------- */
function ScoreCsv() {
  const [files, setFiles] = useState<{ test: string | null; actuals: string | null; preds: string | null; names: Record<string, string> }>({ test: null, actuals: null, preds: null, names: {} });
  const [result, setResult] = useState<Json>(null);
  const [err, setErr] = useState<string | null>(null);
  const prod = useJson('/reports/model/stations_2025.json');
  const read = async (kind: 'test' | 'actuals' | 'preds', file: File | undefined) => {
    if (!file) return;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setFiles(f => ({ ...f, [kind]: text, names: { ...f.names, [kind]: file.name } })); setErr(null);
    } catch { setErr(`${file.name} is not valid UTF-8 text; the brief requires a UTF-8 CSV.`); }
  };
  const loadSample = () => {
    if (!prod.data) return;
    const act: (string | number | null)[][] = [['station_id', 'date', 'discharge_cfs']], pr = [['station_id', 'date', 'discharge_cfs']] as (string | number | null)[][], tst = [['station_id', 'date']] as (string | number | null)[][];
    (prod.data as Json[]).forEach(s => s.dates.forEach((d: string, i: number) => { act.push([s.id, d, s.actual[i]]); pr.push([s.id, d, s.pred[i]]); tst.push([s.id, d]); }));
    setFiles({ test: toCsv(tst), actuals: toCsv(act), preds: toCsv(pr), names: { test: 'sample test.csv', actuals: 'sample actuals.csv', preds: 'sample predictions.csv' } });
  };
  const run = () => {
    if (!files.preds) { setErr('Add a predictions CSV first.'); return; }
    const validation = validateSubmission(files.preds, files.test);
    const score = files.actuals ? scorePredictions(files.actuals, files.preds) : null;
    setResult({ validation, score }); setErr(null);
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'floodcast-test-report.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  const Pick = ({ kind, label, hint }: { kind: 'test' | 'actuals' | 'preds'; label: string; hint: string }) => (
    <label className="mp-drop"><Upload size={16} /><strong>{label}</strong><small>{hint}</small>
      <span className="mp-file">{files.names[kind] ?? 'Choose a .csv file'}</span>
      <input type="file" accept=".csv,text/csv" onChange={e => read(kind, e.target.files?.[0])} /></label>);
  const v = result?.validation, s = result?.score;
  return (
    <section className="mp-card">
      <div className="mp-eyebrow"><FileCheck2 size={14} /> Offline checker — nothing is uploaded; files are read in your browser</div>
      <h3>Validate and score a predictions file</h3>
      <p className="mp-muted">Applies the FLOODCAST submission rules (exact columns, one non-negative number per test row, no duplicates) and, if you add actuals, the four scoring metrics.</p>
      <div className="mp-drops">
        <Pick kind="preds" label="predictions.csv" hint="station_id,date,discharge_cfs" />
        <Pick kind="test" label="test.csv (optional)" hint="checks every test row is covered" />
        <Pick kind="actuals" label="actuals (optional)" hint="discharge_cfs or discharge_cfs_actual" />
      </div>
      <div className="mp-actions">
        <button className="mp-btn primary" onClick={run}><ShieldCheck size={15} /> Validate &amp; score</button>
        <button className="mp-btn" onClick={loadSample} disabled={!prod.data}>Load the 2025 benchmark sample</button>
        {result && <button className="mp-btn" onClick={download}><Download size={15} /> Download report</button>}
      </div>
      {err && <div className="mp-error"><XCircle size={14} /> {err}</div>}
      {v && (
        <div className="mp-result">
          <div className={`mp-verdict ${v.ok ? 'ok' : 'bad'}`}>{v.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {v.ok ? `Valid submission format — ${fmt(v.rows)} rows` : `Rejected — ${v.errors.length} problem${v.errors.length === 1 ? '' : 's'}`}</div>
          <ul className="mp-list">{v.errors.map((e: string) => <li key={e} className="bad">{e}</li>)}{v.warnings.map((w: string) => <li key={w} className="warn">{w}</li>)}</ul>
        </div>)}
      {s && !s.ok && <div className="mp-error"><XCircle size={14} /> {s.error}</div>}
      {s?.ok && (<>
        <div className="mp-stats">
          <Stat label="RMSE (cfs)" value={fmt(s.overall.rmse)} hint="40% of score" />
          <Stat label="Extreme RMSE (cfs)" value={fmt(s.overall.extremeRmse)} hint={`top 10% per station · ${fmt(s.overall.extremeRows)} rows · 30%`} />
          <Stat label="MAE (cfs)" value={fmt(s.overall.mae)} hint="20% of score" />
          <Stat label="R²" value={fmt(s.overall.r2, 4)} hint="10% of score" />
        </div>
        <p className="mp-muted">{fmt(s.matched)} rows matched{s.unmatched ? `, ${fmt(s.unmatched)} actual rows had no usable prediction` : ''}. The official score normalizes each metric across all teams, so this is not your leaderboard score.</p>
        <h4>Stations with the largest RMSE</h4>
        <table className="mp-table"><thead><tr><th>Station</th><th>Rows</th><th>RMSE</th><th>Extreme RMSE</th><th>MAE</th><th>R²</th></tr></thead>
          <tbody>{s.stations.slice(0, 10).map((x: Json) => <tr key={x.id}><td>{x.id}</td><td>{x.rows}</td><td>{fmt(x.rmse)}</td><td>{fmt(x.extremeRmse)}</td><td>{fmt(x.mae)}</td><td>{fmt(x.r2, 3)}</td></tr>)}</tbody></table>
      </>)}
    </section>
  );
}

/* ---------- tab: robustness ---------- */
function Robust({ summary }: { summary: Json }) {
  const [set, setSet] = useState<'heldout' | 'caravan'>('heldout');
  const stress = summary.stress?.[set];
  const label: Record<string, string> = { clean: 'Clean inputs', missing_10pct: '10% of inputs missing', missing_30pct: '30% of inputs missing', gaps_7day_blocks: '7-day gaps (~10% of days)', noise: 'Measurement noise', delay_1day: 'Discharge arrives 1 day late' };
  const shade = (r: number) => ({ background: `rgba(225, 29, 72, ${Math.min(0.55, Math.max(0, (r - 1) / 2.2))})` });
  const eff = summary.efficiency?.heldout;
  return (
    <section className="mp-card">
      <div className="mp-eyebrow"><Activity size={14} /> Test C style stress tests</div>
      <h3>How much do forecasts degrade when inputs are bad?</h3>
      <div className="mp-controls"><div className="mp-seg">
        <button className={set === 'heldout' ? 'on' : ''} onClick={() => setSet('heldout')}>Held-out stations</button>
        <button className={set === 'caravan' ? 'on' : ''} onClick={() => setSet('caravan')} disabled={!summary.stress?.caravan}>Caravan basins</button></div></div>
      {stress ? (<>
        <p className="mp-muted">Table shows RMSE as a multiple of the clean run ({fmt(stress.basins)} catchments; 1.00× = no change). Only inputs are damaged; targets stay true.</p>
        <table className="mp-table"><thead><tr><th>Scenario</th><th>1-day</th><th>3-day</th><th>7-day</th><th>90% coverage (1-day)</th></tr></thead>
          <tbody>{Object.entries(stress.scenarios).map(([k, v]: [string, Json]) => (
            <tr key={k}><td>{label[k] ?? k}</td>{['1', '3', '7'].map(hh => <td key={hh} style={shade(v[hh].rmse_ratio_vs_clean)}>{fmt(v[hh].rmse_ratio_vs_clean, 2)}×</td>)}<td>{fmt(v['1'].interval_coverage * 100, 1)}%</td></tr>))}</tbody></table>
        <p className="mp-note"><AlertTriangle size={13} /> The model leans on the latest observed discharge, so errors in that input pass straight through at 1 day. Longer horizons depend more on weather and hold up better. Intervals become overconfident under stress.</p>
      </>) : <div className="mp-empty">Stress results are not available for this dataset.</div>}
      {eff && (<><h4>Efficiency (CPU only)</h4><div className="mp-stats small">
        <Stat label="ms per 1,000 forecasts" value={fmt(eff.ms_per_1000_forecasts_all_heads_all_horizons, 0)} hint="3 horizons, all heads" />
        <Stat label="Model file (MB)" value={fmt(eff.model_file_mb, 1)} /><Stat label="Peak memory (MB)" value={fmt(eff.peak_process_rss_mb, 0)} />
        <Stat label="CPU threads" value={fmt(eff.cpu_threads)} /></div></>)}
    </section>
  );
}

/* ---------- tab: judge tests ---------- */
function JudgeTests({ summary }: { summary: Json }) {
  const judge = useJson('/reports/model/judge_tests.json');
  const jt = judge.data;
  const held = summary.basinshift?.heldout, car = summary.basinshift?.caravan;
  const skill = (m: Json) => (m ? m.blend.rmse / m.persistence.rmse : null);
  const status: [string, string, string, 'done' | 'partial' | 'no'][] = [
    ['Test A: temporal', '§7.1, 7.4', 'Later dates, catchments seen in training', jt ? 'done' : 'partial'],
    ['Test B: geographic', '§7.1, 7.3', 'Catchments completely excluded from training', held && car ? 'done' : 'partial'],
    ['Test C: stress', '§7.5', 'Missing data, gaps, noise, delayed inputs', summary.stress?.heldout ? 'done' : 'partial'],
    ['Output contract', '§8.3–8.4', 'Record layout, probabilities, interval order, no NaN or duplicates', 'done'],
    ['Live new-river test (India)', 'NWIC', 'Model vs live NWIC observations at gauges outside the training data', 'done'],
    ['H1: static attributes help transfer', '§4.3', 'Same model with and without catchment attributes', jt?.h1_static_attributes ? 'done' : 'partial'],
    ['H2: unseen-basin gap', '§4.3', 'Skill on seen vs unseen catchments', jt && held ? 'done' : 'partial'],
    ['H3: probabilistic forecasts', '§4.3', 'Brier skill, reliability error, interval coverage', 'done'],
    ['H4: robust training', '§4.3', 'Needs a model trained with corrupted inputs', 'no'],
    ['H5: hybrid or physics-informed', '§4.3', 'Not attempted', 'no'],
    ['Baselines', '§9.1', 'Persistence, seasonal climatology and gradient boosting done; sequence model and hybrid missing', 'partial'],
    ['Efficiency', '§10.1', 'CPU latency, memory, model size', summary.efficiency ? 'done' : 'partial'],
  ];
  const badge = { done: 'Run', partial: 'Partly', no: 'Not run' } as const;
  return (
    <div className="mp-stack">
      <section className="mp-card">
        <div className="mp-eyebrow"><ShieldCheck size={14} /> What the BASINSHIFT document says will be tested</div>
        <h3>Test checklist and where the evidence is</h3>
        <table className="mp-table mp-left"><thead><tr><th>Item</th><th>PDF</th><th>What it checks</th><th>Status</th></tr></thead>
          <tbody>{status.map(([a, b, c, st]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td><td><span className={`mp-badge ${st}`}>{badge[st]}</span></td></tr>)}</tbody></table>
        <p className="mp-note"><AlertTriangle size={13} /> The document says the exact horizons, thresholds, scoring formula and hidden stress seeds are not frozen. We use 1, 3 and 7 days, Q90 and Q99 thresholds from each catchment's own earlier reference period, and our own fixed seeds.</p>
      </section>

      <section className="mp-card">
        <div className="mp-eyebrow"><Gauge size={14} /> Test A and B side by side</div>
        <h3>Does the model keep its edge on catchments it never saw?</h3>
        <p className="mp-muted">Skill ratio = model RMSE divided by persistence RMSE (below 1.00 beats repeating the latest flow). Test A uses stations the model trained on, but only later dates. Test B uses stations it never saw.</p>
        {jt && held && car ? (
          <table className="mp-table"><thead><tr><th>Horizon</th><th>A: seen stations, later dates</th><th>B1: unseen gauges (2022–24)</th><th>B2: Caravan basins (2010–20)</th></tr></thead>
            <tbody>{['1', '3', '7'].map(h => {
              const a = jt.test_a_temporal.horizons[h], b = held.horizons[h], c = car.horizons[h];
              const cell = (m: Json) => `${fmt(skill(m), 3)}× · NSE ${fmt(m.blend.median_basin_nse, 2)} vs ${fmt(m.persistence.median_basin_nse, 2)}`;
              return <tr key={h}><td>{h}-day</td><td>{cell(a)}</td><td>{cell(b)}</td><td>{cell(c)}</td></tr>; })}</tbody></table>
        ) : <div className="mp-empty">{judge.error ? 'Test A results are not available yet.' : 'Loading…'}</div>}
        <p className="mp-muted">Each cell: skill ratio, then per-basin median NSE for the model vs persistence.</p>
      </section>

      <section className="mp-card">
        <div className="mp-eyebrow"><FlaskConical size={14} /> Hypothesis H1</div>
        <h3>Do static catchment attributes help on unseen catchments?</h3>
        {jt?.h1_static_attributes ? (<>
          <table className="mp-table"><thead><tr><th>Horizon</th><th>RMSE with</th><th>RMSE without</th><th>Median NSE with</th><th>Median NSE without</th></tr></thead>
            <tbody>{Object.entries(jt.h1_static_attributes.horizons).map(([h, v]: [string, Json]) => (
              <tr key={h}><td>{h}-day</td><td>{fmt(v.with_attributes.rmse)}</td><td>{fmt(v.without_attributes.rmse)}</td><td>{fmt(v.with_attributes.median_basin_nse, 3)}</td><td>{fmt(v.without_attributes.median_basin_nse, 3)}</td></tr>))}</tbody></table>
          <p className="mp-muted">Held-out stations: {jt.h1_static_attributes.heldout_stations}. Removed: drainage area, elevation, slope, forest and impervious cover, and the two features derived from area. One split only, so treat differences as indicative.</p>
        </>) : <div className="mp-empty">Not available yet.</div>}
      </section>

      <DailyHorizons summary={summary} />
      <IndiaLiveTest />
      <LiveCaravanTest />
      <ContractCheck />
    </div>
  );
}

function DailyHorizons({ summary }: { summary: Json }) {
  const d = summary.basinshift?.heldout_daily;
  if (!d) return null;
  const rows = Object.entries(d.horizons) as [string, Json][];
  return (
    <section className="mp-card">
      <div className="mp-eyebrow"><LineChart size={14} /> Every forecast day</div>
      <h3>Daily forecasts, +1 to +7 days, on gauges the model never saw</h3>
      <p className="mp-muted">The live model is trained for every day from +1 to +7, so the hydrograph is a predicted daily curve and not a drawing between three points. Held-out gauges, 2022–2024 ({fmt(d.stations)} gauges, {fmt(d.rows)} days). Ratio = model error ÷ persistence error (below 1.00 is better).</p>
      <table className="mp-table">
        <thead><tr><th>Day</th><th>Model RMSE</th><th>Persistence RMSE</th><th>Ratio</th><th>Median NSE (model / persist.)</th><th>90% coverage</th><th>High-flow AUPRC</th></tr></thead>
        <tbody>{rows.map(([h, v]) => (
          <tr key={h}><td>+{h}</td><td>{fmt(v.blend.rmse)}</td><td>{fmt(v.persistence.rmse)}</td><td><b>{fmt(v.blend.rmse / v.persistence.rmse, 3)}×</b></td>
            <td>{fmt(v.blend.median_basin_nse, 3)} / {fmt(v.persistence.median_basin_nse, 3)}</td><td>{fmt(v.interval.coverage * 100, 1)}%</td><td>{fmt(v.high_flow_q90.auprc, 3)}</td></tr>))}</tbody>
      </table>
    </section>
  );
}

function IndiaLiveTest() {
  const t = useJson('/reports/model/india_live_test.json');
  const d = t.data;
  const [sort, setSort] = useState<'ratio' | 'name'>('ratio');
  if (t.error) return null;
  const rows: Json[] = d ? [...d.stations].sort((a, b) => (sort === 'name' ? a.station.localeCompare(b.station) : (a.horizons['1']?.rmse_ratio ?? 9) - (b.horizons['1']?.rmse_ratio ?? 9))) : [];
  return (
    <section className="mp-card">
      <div className="mp-eyebrow"><Activity size={14} /> New rivers · India · live NWIC data</div>
      <h3>How does the model compare with what India's portal actually recorded?</h3>
      <p className="mp-muted">None of these gauges was in the training data. For each one, the model replays 1-, 3- and 7-day forecasts over the last 30 observed days using only data available at the time, and the result is scored against the NWIC reading. Units on the portal are m³/s; they are converted to cfs.</p>
      {!d && <div className="mp-empty">Loading…</div>}
      {d && (<>
        <table className="mp-table"><thead><tr><th>Horizon</th><th>Gauges</th><th>Median RMSE ratio (model ÷ persistence)</th><th>Gauges where model beats persistence</th><th>Middle half of gauges</th></tr></thead>
          <tbody>{Object.entries(d.summary).map(([h, s]: [string, Json]) => (
            <tr key={h}><td>{h}-day</td><td>{s.stations}</td><td><b>{fmt(s.median_rmse_ratio, 2)}×</b></td><td>{fmt(s.share_model_better_than_persistence * 100, 0)}%</td><td>{fmt(s.p25, 2)}–{fmt(s.p75, 2)}×</td></tr>))}</tbody></table>
        <p className="mp-note"><AlertTriangle size={13} /> Short window (30 days) at the end of the monsoon, when flows are mostly falling. Many of these rivers are dam-regulated, which the model knows nothing about. A ratio below 1.00 means better than repeating the latest reading; this is a transfer test, not a proof of skill.</p>
        <div className="mp-controls"><div className="mp-seg"><button className={sort === 'ratio' ? 'on' : ''} onClick={() => setSort('ratio')}>Best first</button><button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')}>By name</button></div></div>
        <table className="mp-table mp-left"><thead><tr><th>Gauge</th><th>River</th><th>State</th><th>Last reading</th><th>1-day ratio</th><th>3-day</th><th>7-day</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key}><td>{r.station}</td><td>{r.river}</td><td>{r.state}</td><td>{r.last_obs}</td>
              {['1', '3', '7'].map(h => <td key={h} style={{ color: (r.horizons[h]?.rmse_ratio ?? 1) < 1 ? 'var(--emerald)' : 'var(--rose)' }}>{r.horizons[h] ? `${fmt(r.horizons[h].rmse_ratio, 2)}×` : '—'}</td>)}</tr>))}</tbody></table>
        {d.failed?.length > 0 && <p className="mp-muted">{d.failed.length} gauge(s) could not be scored (no overlapping weather or too few readings).</p>}
      </>)}
    </section>
  );
}

function LiveCaravanTest() {
  const [n, setN] = useState(12);
  const [seed, setSeed] = useState(7);
  const [st, setSt] = useState<{ loading: boolean; data: Json; error: string | null }>({ loading: false, data: null, error: null });
  const run = async () => {
    setSt({ loading: true, data: null, error: null });
    try {
      const r = await fetch(`/api/run_test?dataset=caravan&n=${n}&seed=${seed}`);
      const text = await r.text();
      let body: Json = null;
      try { body = JSON.parse(text); } catch { /* proxy target down */ }
      if (!body) throw new Error('The model server is not running. Start it with: python -m server.model_api');
      if (!r.ok || body.error) throw new Error(body.error ?? `HTTP ${r.status}`);
      setSt({ loading: false, data: body, error: null });
    } catch (e: Json) { setSt({ loading: false, data: null, error: String(e.message ?? e) }); }
  };
  const d = st.data;
  return (
    <section className="mp-card">
      <div className="mp-eyebrow"><Activity size={14} /> Run it yourself</div>
      <h3>Test the model on random US basins it has never seen</h3>
      <p className="mp-muted">Picks basins at random from Caravan (an independent dataset with different gauges and weather), converts them to our format, cleans them, then forecasts 2010–2020 with the live model. Needs the model server.</p>
      <div className="mp-controls">
        <label>Basins <input type="number" min={3} max={30} value={n} onChange={e => setN(Math.max(3, Math.min(30, +e.target.value || 3)))} className="mp-num" /></label>
        <label>Random seed <input type="number" value={seed} onChange={e => setSeed(+e.target.value || 0)} className="mp-num" /></label>
        <button className="mp-btn primary" onClick={run} disabled={st.loading}><Play size={14} /> {st.loading ? 'Running… (about 30 s)' : 'Run test'}</button>
      </div>
      {st.error && <div className="mp-error"><XCircle size={14} /> {st.error}</div>}
      {d && (<>
        <p className="mp-muted">{d.basins} basins · cleaning removed {fmt(d.cleaning.rows_in - d.cleaning.rows_out)} rows.</p>
        <table className="mp-table"><thead><tr><th>Horizon</th><th>Rows</th><th>Model RMSE</th><th>Persistence</th><th>Climatology</th><th>Weather-only</th><th>Median NSE (model / persist.)</th><th>90% coverage</th><th>High-flow AUPRC</th></tr></thead>
          <tbody>{Object.entries(d.horizons).map(([h, v]: [string, Json]) => (
            <tr key={h}><td>{h}-day</td><td>{fmt(v.rows)}</td><td><b>{fmt(v.blend.rmse, 1)}</b></td><td>{fmt(v.persistence.rmse, 1)}</td><td>{fmt(v.climatology.rmse, 1)}</td><td>{fmt(v.weather_only.rmse, 1)}</td>
              <td>{fmt(v.blend.median_basin_nse, 3)} / {fmt(v.persistence.median_basin_nse, 3)}</td><td>{v.interval_coverage === null ? '—' : `${fmt(v.interval_coverage * 100, 1)}%`}</td><td>{fmt(v.high_flow_auprc, 3)}</td></tr>))}</tbody></table>
      </>)}
    </section>
  );
}

function ContractCheck() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Json>(null);
  const [live, setLive] = useState<string | null>(null);
  const check = (raw = text) => {
    try { setResult(validateBasinshiftOutput(JSON.parse(raw))); } catch (e: Json) { setResult({ ok: false, errors: [`Not valid JSON: ${e.message}`], records: 0 }); }
  };
  const sample = async () => {
    setLive(null);
    try {
      const r = await fetch('/api/live_forecast?station=01646500');
      const body = JSON.parse(await r.text());
      if (body.error) throw new Error(body.error);
      const rec = JSON.stringify(toBasinshiftRecord(body), null, 2);
      setText(rec); check(rec);
    } catch (e: Json) { setLive(`Could not get a live forecast (${String(e.message ?? e)}). Start the model server or paste your own JSON.`); }
  };
  return (
    <section className="mp-card">
      <div className="mp-eyebrow"><FileCheck2 size={14} /> Output contract</div>
      <h3>Check a forecast file against the PDF's output rules</h3>
      <p className="mp-muted">Paste one record, an array of records, or an object with a records array, using the layout in section 8.3. Checks horizons, NaN and infinity, probabilities, interval order, non-negative discharge and duplicates.</p>
      <textarea className="mp-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="Paste JSON here, or generate one from a live forecast" spellCheck={false} />
      <div className="mp-actions">
        <button className="mp-btn primary" onClick={() => check()}><ShieldCheck size={15} /> Check</button>
        <button className="mp-btn" onClick={sample}>Generate from a live forecast (Potomac)</button>
      </div>
      {live && <div className="mp-error"><XCircle size={14} /> {live}</div>}
      {result && (<div className="mp-result">
        <div className={`mp-verdict ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{result.ok ? `Valid: ${result.records} record(s)` : `${result.errors.length} problem(s)`}</div>
        <ul className="mp-list">{result.errors.map((e: string) => <li key={e} className="bad">{e}</li>)}</ul></div>)}
    </section>
  );
}

/* ---------- page ---------- */
export default function ModelPage() {
  const { data: summary, error } = useJson('/reports/model/summary.json');
  const [tab, setTab] = useState<Tab>('results');
  const top = useRef<HTMLElement>(null);
  useEffect(() => { window.scrollTo({ top: 0 }); }, []);
  const tabs: [Tab, string, ReactElement][] = [['results', 'Results', <Gauge size={15} key="r" />], ['judge', 'Judge tests', <ShieldCheck size={15} key="j" />], ['station', 'Test a station', <LineChart size={15} key="s" />],
    ['score', 'Score your CSV', <FileCheck2 size={15} key="c" />], ['robust', 'Robustness', <Activity size={15} key="b" />]];
  return (
    <main className="model-page" ref={top}>
      <header className="mp-head">
        <div className="mp-eyebrow"><FlaskConical size={14} /> Discharge ML Model</div>
        <h2>Test the river-discharge model</h2>
        <p className="mp-muted">Inspect results, replay forecasts against what actually happened, and score your own predictions file. All numbers come from saved evaluation runs; every dataset used for testing was kept out of training.</p>
      </header>
      <nav className="mp-tabs" role="tablist" aria-label="Model page sections">
        {tabs.map(([k, label, icon]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{icon}{label}</button>)}
      </nav>
      {error && <div className="mp-error"><XCircle size={14} /> Could not load results: {error}</div>}
      {tab === 'station' && <StationTest />}
      {tab === 'score' && <ScoreCsv />}
      {summary && tab === 'results' && <Results summary={summary} />}
      {summary && tab === 'judge' && <JudgeTests summary={summary} />}
      {summary && tab === 'robust' && <Robust summary={summary} />}
      {!summary && !error && tab !== 'station' && tab !== 'score' && <div className="mp-empty">Loading results…</div>}
      <p className="mp-foot">Research benchmark only. Not a certified flood warning; do not use for evacuation or emergency decisions.</p>
    </main>
  );
}
