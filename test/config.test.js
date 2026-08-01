import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/config.js';

test('normalizeConfig applies the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
});

test('normalizeConfig coerces a poll_frequency coming as a string', () => {
  const config = normalizeConfig({ poll_frequency: '30' });
  assert.equal(config.poll_frequency, 30);
});

test('normalizeConfig falls back to the default on any unusable value', () => {
  // A non-numeric value must NOT reach the snapping reduce: every comparison
  // against NaN is false, so it would settle on the first candidate — 1 second,
  // the chattiest frequency of the set (60x the intended network, history and
  // trigger load), the exact opposite of a safe default.
  for (const value of ['', 'abc', 0, -5, NaN, {}, true, [], null, undefined]) {
    assert.equal(
      normalizeConfig({ poll_frequency: value }).poll_frequency,
      DEFAULT_CONFIG.poll_frequency,
      `poll_frequency: ${JSON.stringify(value)}`,
    );
  }
});

test('normalizeConfig tolerates a null configuration', () => {
  // getConfig() can hand back null; the `= {}` default would not cover it.
  assert.equal(normalizeConfig(null).poll_frequency, DEFAULT_CONFIG.poll_frequency);
});

test('normalizeConfig snaps poll_frequency to the closed set Gladys core accepts', () => {
  // Gladys core rejects (silently, on publishDiscoveredDevices) any
  // poll_frequency outside [1, 2, 10, 15, 30, 60] seconds — a stale value
  // saved before this restriction (e.g. a free-form 45 or 3600) must be
  // snapped to the nearest accepted one, never passed through as-is.
  assert.equal(normalizeConfig({ poll_frequency: 45 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 3600 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 12 }).poll_frequency, 10);
  assert.equal(normalizeConfig({ poll_frequency: 15 }).poll_frequency, 15);
});
