import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseIpList, DEFAULT_CONFIG } from '../src/config.js';

test('parseIpList splits on commas, spaces, semicolons and newlines', () => {
  assert.deepEqual(parseIpList('192.168.1.10, 192.168.1.11'), ['192.168.1.10', '192.168.1.11']);
  assert.deepEqual(parseIpList('192.168.1.10 192.168.1.11'), ['192.168.1.10', '192.168.1.11']);
  assert.deepEqual(parseIpList('192.168.1.10;192.168.1.11\n192.168.1.12'), [
    '192.168.1.10',
    '192.168.1.11',
    '192.168.1.12',
  ]);
});

test('parseIpList trims, drops empties and de-duplicates', () => {
  assert.deepEqual(parseIpList('  192.168.1.10 ,, 192.168.1.10 '), ['192.168.1.10']);
  assert.deepEqual(parseIpList(''), []);
  assert.deepEqual(parseIpList(undefined), []);
});

test('normalizeConfig applies the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.deepEqual(config.ips, []);
});

test('normalizeConfig coerces numbers coming as strings and derives ips', () => {
  const config = normalizeConfig({ poll_frequency: '30', device_ips: '10.0.0.1, 10.0.0.2' });
  assert.equal(config.poll_frequency, 30);
  assert.deepEqual(config.ips, ['10.0.0.1', '10.0.0.2']);
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
