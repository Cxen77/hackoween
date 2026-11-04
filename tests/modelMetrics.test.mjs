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
