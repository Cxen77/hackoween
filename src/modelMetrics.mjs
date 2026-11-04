// In-browser CSV parsing, submission validation and scoring for the Discharge ML Model page.
// Scoring matches the FLOODCAST brief: overall RMSE, RMSE on each station's top-10% actual days, MAE, R².

export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() ?? [];
  return { header, rows };
}

const REQUIRED = ['station_id', 'date', 'discharge_cfs'];
const keyOf = (s, d) => `${s}|${d}`;

// Pandas-compatible linear-interpolated quantile.
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function toRecords(parsed, errors, label, valueColumn = 'discharge_cfs') {
  const idx = Object.fromEntries(parsed.header.map((h, i) => [h.trim(), i]));
  const out = [];
  parsed.rows.forEach((r, n) => {
    const raw = r[idx[valueColumn]];
    const value = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    out.push({ station: (r[idx.station_id] ?? '').trim(), date: (r[idx.date] ?? '').trim(), value, line: n + 2 });
  });
  return out;
}

/** Validate a predictions CSV (and, when supplied, check it covers every key of a test CSV). */
/** @param {string} predictionsText @param {string | null} [testText] */
export function validateSubmission(predictionsText, testText = /** @type {string | null} */ (null)) {
  const errors = [], warnings = [];
  const preds = parseCsv(predictionsText);
  const header = preds.header.map(h => h.trim());
  if (header.length !== 3 || header.some((h, i) => h !== REQUIRED[i])) {
    errors.push(`Columns must be exactly station_id,date,discharge_cfs in that order (found: ${header.join(',') || 'none'}).`);
    return { ok: false, errors, warnings, rows: preds.rows.length };
  }
  const records = toRecords(preds, errors, 'predictions');
  const seen = new Map();
  let bad = 0, negative = 0, duplicates = 0, firstBad = null;
  for (const r of records) {
    if (!Number.isFinite(r.value)) { bad++; firstBad ??= r; }
    else if (r.value < 0) negative++;
    const k = keyOf(r.station, r.date);
    if (seen.has(k)) duplicates++; else seen.set(k, r);
  }
  if (bad) errors.push(`${bad} prediction(s) are blank, NaN or not finite numbers (first at line ${firstBad.line}).`);
  if (negative) errors.push(`${negative} prediction(s) are negative; discharge must be non-negative.`);
  if (duplicates) errors.push(`${duplicates} duplicate station_id/date pair(s).`);
  if (!records.length) errors.push('The file has no data rows.');
  if (testText) {
    const test = parseCsv(testText);
    const tIdx = Object.fromEntries(test.header.map((h, i) => [h.trim(), i]));
    if (tIdx.station_id === undefined || tIdx.date === undefined) errors.push('test.csv needs station_id and date columns.');
    else {
      const tkeys = test.rows.map(r => keyOf((r[tIdx.station_id] ?? '').trim(), (r[tIdx.date] ?? '').trim()));
      const tset = new Set(tkeys);
      const missing = tkeys.filter(k => !seen.has(k)).length;
      const extra = [...seen.keys()].filter(k => !tset.has(k)).length;
      if (records.length !== tkeys.length) errors.push(`Row count differs: predictions ${records.length}, test ${tkeys.length}.`);
      if (missing) errors.push(`${missing} test row(s) have no prediction.`);
      if (extra) errors.push(`${extra} prediction row(s) are not in test.csv.`);
      if (!errors.length) {
        const inOrder = tkeys.every((k, i) => keyOf(records[i].station, records[i].date) === k);
        if (!inOrder) warnings.push('Rows are not in the same order as test.csv (allowed, but keeping order is safest).');
      }
    }
  } else warnings.push('No test.csv supplied: row coverage against the test set was not checked.');
  return { ok: errors.length === 0, errors, warnings, rows: records.length };
}

/** Score predictions against actuals. Joins on station_id+date. */
export function scorePredictions(actualsText, predictionsText) {
  const a = parseCsv(actualsText), p = parseCsv(predictionsText);
  const aHeader = a.header.map(h => h.trim());
  const valueCol = aHeader.includes('discharge_cfs') ? 'discharge_cfs' : aHeader.includes('discharge_cfs_actual') ? 'discharge_cfs_actual' : null;
  if (!valueCol || !aHeader.includes('station_id') || !aHeader.includes('date')) {
    return { ok: false, error: 'Actuals file needs station_id, date and discharge_cfs (or discharge_cfs_actual) columns.' };
  }
  const actual = toRecords(a, [], 'actuals', valueCol);
  const predicted = new Map(toRecords(p, [], 'predictions').map(r => [keyOf(r.station, r.date), r.value]));
  const joined = [];
  let unmatched = 0;
  for (const r of actual) {
    const v = predicted.get(keyOf(r.station, r.date));
    if (v === undefined || !Number.isFinite(v) || !Number.isFinite(r.value)) { unmatched++; continue; }
    joined.push({ station: r.station, y: r.value, p: v });
  }
  if (!joined.length) return { ok: false, error: 'No rows matched between actuals and predictions.' };
  const byStation = new Map();
  joined.forEach(r => { if (!byStation.has(r.station)) byStation.set(r.station, []); byStation.get(r.station).push(r); });
  const sq = r => (r.y - r.p) ** 2;
  const metricsFor = rows => {
    const sorted = rows.map(r => r.y).sort((x, z) => x - z), thr = quantile(sorted, 0.9);
    const ext = rows.filter(r => r.y >= thr);
    const mean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
    const sse = rows.reduce((s, r) => s + sq(r), 0), sst = rows.reduce((s, r) => s + (r.y - mean) ** 2, 0);
    return { rows: rows.length, rmse: Math.sqrt(sse / rows.length), mae: rows.reduce((s, r) => s + Math.abs(r.y - r.p), 0) / rows.length,
             r2: sst > 0 ? 1 - sse / sst : NaN, extremeRows: ext.length, extremeRmse: ext.length ? Math.sqrt(ext.reduce((s, r) => s + sq(r), 0) / ext.length) : NaN };
  };
  // Overall extreme set = union of each station's own top-10% days, as in the brief.
  const extremeAll = [];
  byStation.forEach(rows => {
    const thr = quantile(rows.map(r => r.y).sort((x, z) => x - z), 0.9);
    rows.forEach(r => { if (r.y >= thr) extremeAll.push(r); });
  });
  const overall = metricsFor(joined);
  overall.extremeRows = extremeAll.length;
  overall.extremeRmse = Math.sqrt(extremeAll.reduce((s, r) => s + sq(r), 0) / extremeAll.length);
  const stations = [...byStation.entries()].map(([id, rows]) => ({ id, ...metricsFor(rows) })).sort((x, z) => z.rmse - x.rmse);
  return { ok: true, overall, stations, matched: joined.length, unmatched };
}
