import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, quantile, validateSubmission, scorePredictions } from '../src/modelMetrics.mjs';

// Expected values were computed independently in Python (numpy/pandas) from the same fixture.
const fixture = JSON.parse(readFileSync(new URL('./model_fixture.json', import.meta.url), 'utf8'));
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('parseCsv handles quotes, CRLF and a BOM, and keeps leading zeros', () => {
  const p = parseCsv('﻿station_id,date,note\r\n01646500,2025-01-01,"a, b"\r\n');
  assert.deepEqual(p.header, ['station_id', 'date', 'note']);
  assert.deepEqual(p.rows, [['01646500', '2025-01-01', 'a, b']]);
});

test('quantile matches pandas linear interpolation', () => {
  close(quantile([1, 2, 3, 4, 10], 0.9), 7.6);
  close(quantile([5], 0.9), 5);
});

test('scorePredictions reproduces the Python RMSE, per-station extreme RMSE, MAE and R2', () => {
  const s = scorePredictions(fixture.actuals, fixture.preds);
  assert.equal(s.ok, true);
  close(s.overall.rmse, fixture.exp.rmse);
  close(s.overall.extremeRmse, fixture.exp.extreme);
  close(s.overall.mae, fixture.exp.mae);
  close(s.overall.r2, fixture.exp.r2);
  assert.equal(s.overall.extremeRows, fixture.exp.ext_rows);
  assert.equal(s.stations.length, 2);
});

test('scorePredictions accepts the evaluation file column name and reports unmatched rows', () => {
  const actuals = 'station_id,date,discharge_cfs_actual\n01,2025-01-01,10\n01,2025-01-02,20\n';
  const preds = 'station_id,date,discharge_cfs\n01,2025-01-01,12\n';
  const s = scorePredictions(actuals, preds);
  assert.equal(s.matched, 1);
  assert.equal(s.unmatched, 1);
  close(s.overall.rmse, 2);
});

test('validateSubmission accepts a clean file that covers test.csv', () => {
  const test_ = 'station_id,date,x\n01,2025-01-01,1\n02,2025-01-01,1\n';
  const v = validateSubmission('station_id,date,discharge_cfs\n01,2025-01-01,5\n02,2025-01-01,0\n', test_);
  assert.equal(v.ok, true, v.errors.join(' | '));
});

test('validateSubmission rejects wrong columns, negatives, NaN, duplicates, and missing rows', () => {
  assert.equal(validateSubmission('date,station_id,discharge_cfs\n').ok, false);
  const test_ = 'station_id,date\n01,2025-01-01\n02,2025-01-01\n';
  const v = validateSubmission('station_id,date,discharge_cfs\n01,2025-01-01,-3\n01,2025-01-01,\n', test_);
  assert.equal(v.ok, false);
  const text = v.errors.join(' ');
  assert.match(text, /negative/);
  assert.match(text, /blank|NaN/);
  assert.match(text, /duplicate/);
  assert.match(text, /no prediction/);
});

test('validateSubmission flags extra rows not in test.csv', () => {
  const v = validateSubmission('station_id,date,discharge_cfs\n01,2025-01-01,1\n09,2025-01-01,1\n', 'station_id,date\n01,2025-01-01\n');
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /not in test\.csv/);
});

import { toBasinshiftRecord, validateBasinshiftOutput } from '../src/modelMetrics.mjs';
const live = { station: '01646500', origin_date: '2026-11-03', horizons: [
  { horizon_days: 1, point_cfs: 2064.06, lo_cfs: 1900.7, hi_cfs: 2245.4, p_high_flow: 0, p_extreme_flow: 0 },
  { horizon_days: 3, point_cfs: 2074.66, lo_cfs: 1812.4, hi_cfs: 2625.5, p_high_flow: 0.01, p_extreme_flow: 0 },
  { horizon_days: 7, point_cfs: 2160.73, lo_cfs: 1641.4, hi_cfs: 3415.9, p_high_flow: 0.02, p_extreme_flow: 0.01 }] };

test('toBasinshiftRecord produces a record that passes the PDF output rules', () => {
  const rec = toBasinshiftRecord(live);
  assert.deepEqual(rec.forecast_horizons_days, [1, 3, 7]);
  assert.equal(rec.forecast_origin, '2026-11-03T00:00:00Z');
  const v = validateBasinshiftOutput(rec, { knownIds: ['01646500'] });
  assert.equal(v.ok, true, v.errors.join(' | '));
});

test('validateBasinshiftOutput rejects each rule violation in section 8.4', () => {
  const base = toBasinshiftRecord(live);
  const bad = patch => validateBasinshiftOutput({ ...base, ...patch }, { knownIds: ['01646500'] });
  assert.match(bad({ catchment_id: 'X' }).errors.join(' '), /unknown catchment/);
  assert.match(bad({ forecast_horizons_days: [1, 3, 14] }).errors.join(' '), /unexpected horizon/);
  assert.match(bad({ predicted_discharge: [1, NaN, 3] }).errors.join(' '), /NaN/);
  assert.match(bad({ predicted_discharge: [-1, 2, 3] }).errors.join(' '), /non-negative/);
  assert.match(bad({ high_flow_probability: [0, 1.5, 0] }).errors.join(' '), /between 0 and 1/);
  assert.match(bad({ extreme_flow_probability: [0.5, 0.5, 0.5], high_flow_probability: [0.1, 0.1, 0.1] }).errors.join(' '), /cannot exceed/);
  assert.match(bad({ prediction_intervals: { lower: [5, 5, 5], upper: [1, 1, 1] } }).errors.join(' '), /lower bound exceeds upper/);
  assert.match(bad({ predicted_discharge: [1, 2] }).errors.join(' '), /one value per horizon/);
  assert.match(validateBasinshiftOutput([base, base]).errors.join(' '), /duplicate/);
  assert.equal(validateBasinshiftOutput(null).ok, false);
});
