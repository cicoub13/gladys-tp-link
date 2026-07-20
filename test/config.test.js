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
  assert.equal(config.broadcast_discovery, true);
  assert.equal(config.discovery_timeout, DEFAULT_CONFIG.discovery_timeout);
  assert.deepEqual(config.ips, []);
});

test('normalizeConfig coerces numbers coming as strings and derives ips', () => {
  const config = normalizeConfig({ poll_frequency: '30', discovery_timeout: '10', device_ips: '10.0.0.1, 10.0.0.2' });
  assert.equal(config.poll_frequency, 30);
  assert.equal(config.discovery_timeout, 10);
  assert.deepEqual(config.ips, ['10.0.0.1', '10.0.0.2']);
});

test('normalizeConfig treats only an explicit false as "no broadcast"', () => {
  assert.equal(normalizeConfig({ broadcast_discovery: false }).broadcast_discovery, false);
  assert.equal(normalizeConfig({ broadcast_discovery: true }).broadcast_discovery, true);
  assert.equal(normalizeConfig({}).broadcast_discovery, true);
});
