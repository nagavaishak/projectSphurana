/**
 * Unit tests for the pure SLO-breach decision (`decide.mjs`).
 *
 * Uses Node's built-in test runner (no deps — the load-tests package has no test
 * tooling). Run: `node --test apps/load-tests/guardrail/decide.test.mjs`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MIN_SAMPLE_SIZE, decideBreach } from './decide.mjs';

const thresholds = {
  maxErrorRate: 0.05,
  maxP95Ms: 2000,
  minConversion: 0.2,
  minSampleSize: 100,
};

test('ok when every metric is within bounds', () => {
  const r = decideBreach(
    { errorRate: 0.01, p95Ms: 800, conversion: 0.4, sampleSize: 500 },
    thresholds
  );
  assert.equal(r.decision, 'ok');
  assert.deepEqual(r.reasons, []);
});

test('breach on error rate over the ceiling', () => {
  const r = decideBreach(
    { errorRate: 0.2, p95Ms: 800, conversion: 0.4, sampleSize: 500 },
    thresholds
  );
  assert.equal(r.decision, 'breach');
  assert.equal(r.reasons.length, 1);
  assert.equal(r.reasons[0].metric, 'errorRate');
});

test('breach on p95 over the ceiling', () => {
  const r = decideBreach({ p95Ms: 5000, sampleSize: 500 }, thresholds);
  assert.equal(r.decision, 'breach');
  assert.equal(r.reasons[0].metric, 'p95Ms');
});

test('breach when conversion falls BELOW the floor', () => {
  const r = decideBreach({ conversion: 0.05, sampleSize: 500 }, thresholds);
  assert.equal(r.decision, 'breach');
  assert.equal(r.reasons[0].metric, 'conversion');
});

test('multiple breaches are all reported', () => {
  const r = decideBreach(
    { errorRate: 0.5, p95Ms: 9000, conversion: 0.01, sampleSize: 500 },
    thresholds
  );
  assert.equal(r.decision, 'breach');
  assert.equal(r.reasons.length, 3);
});

test('insufficient sample never breaches (avoids acting on noise)', () => {
  const r = decideBreach(
    { errorRate: 0.9, p95Ms: 99999, conversion: 0, sampleSize: 5 },
    thresholds
  );
  assert.equal(r.decision, 'insufficient-data');
  assert.deepEqual(r.reasons, []);
});

test('a missing metric is skipped, not treated as a breach', () => {
  // No errorRate / no conversion present; only p95, which is in-bounds.
  const r = decideBreach({ p95Ms: 800, sampleSize: 500 }, thresholds);
  assert.equal(r.decision, 'ok');
});

test('boundary: exactly at the threshold is NOT a breach (strict >)', () => {
  const r = decideBreach(
    { errorRate: 0.05, p95Ms: 2000, conversion: 0.2, sampleSize: 500 },
    thresholds
  );
  assert.equal(r.decision, 'ok');
});

test('default min sample size applies when threshold omits it', () => {
  const justUnder = decideBreach(
    { errorRate: 0.9, sampleSize: DEFAULT_MIN_SAMPLE_SIZE - 1 },
    { maxErrorRate: 0.05 }
  );
  assert.equal(justUnder.decision, 'insufficient-data');

  const atFloor = decideBreach(
    { errorRate: 0.9, sampleSize: DEFAULT_MIN_SAMPLE_SIZE },
    { maxErrorRate: 0.05 }
  );
  assert.equal(atFloor.decision, 'breach');
});

test('empty metrics / thresholds do not throw and do not breach', () => {
  assert.equal(decideBreach({}, {}).decision, 'insufficient-data');
  assert.equal(
    decideBreach(undefined, undefined).decision,
    'insufficient-data'
  );
});
