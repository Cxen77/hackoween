// The files in test/ behave as test/README.md says: good files pass, each bad example is rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSubmission, scorePredictions, validateBasinshiftOutput } from '../src/modelMetrics.mjs';

const read = p => fs.readFileSync(new URL(`../test/${p}`, import.meta.url), 'utf8');

test('full FLOODCAST sample is valid and scores like the saved benchmark', () => {
  const v = validateSubmission(read('predictions.csv'), read('test.csv'));
  assert.equal(v.ok, true);
  assert.equal(v.rows, 19306);
  const s = scorePredictions(read('actuals.csv'), read('predictions.csv'));
  assert.equal(s.ok, true);
  assert.equal(Math.round(s.overall.rmse), 46543);
  assert.equal(Math.round(s.overall.mae), 14003);
  assert.equal(s.overall.r2.toFixed(4), '0.9149');
});

test('small FLOODCAST sample is valid', () => {
  const v = validateSubmission(read('small/predictions.csv'), read('small/test.csv'));
  assert.equal(v.ok, true);
});

for (const [file, needle] of [
  ['wrong_columns.csv', /columns/i],
  ['negative_and_duplicate.csv', /negative|duplicate/i],
  ['missing_10_rows.csv', /no prediction|row count/i],
  ['nan_value.csv', /blank|nan|finite/i],
]) {
  test(`bad FLOODCAST example is rejected: ${file}`, () => {
    const v = validateSubmission(read(`bad_examples/${file}`), read('small/test.csv'));
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), needle);
  });
}

test('BASINSHIFT valid records pass the output contract', () => {
  assert.equal(validateBasinshiftOutput(JSON.parse(read('basinshift/valid_record.json'))).ok, true);
  assert.equal(validateBasinshiftOutput(JSON.parse(read('basinshift/valid_records_array.json'))).ok, true);
});

for (const file of ['bad_probability_above_1', 'bad_interval_order', 'bad_unexpected_horizon', 'bad_negative_discharge']) {
  test(`BASINSHIFT bad example is rejected: ${file}`, () => {
    assert.equal(validateBasinshiftOutput(JSON.parse(read(`basinshift/${file}.json`))).ok, false);
  });
}
