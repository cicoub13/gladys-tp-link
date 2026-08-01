// -----------------------------------------------------------------------------
// The manifest and the code state the same facts twice: the discovery port, the
// accepted poll frequencies, the default one, and the version. Nothing links
// them at runtime, and a divergence fails at the worst possible moment — the
// core rejects an undeclared port, or publishDiscoveredDevices rejects an
// out-of-set poll_frequency, both silently. These tests are that link.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISCOVERY_PORT } from '../src/tplink/protocol.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

const manifest = readJson('gladys-assistant-integration.json');
const pkg = readJson('package.json');

const pollFrequencyField = manifest.config_schema.find((field) => field.key === 'poll_frequency');

test('the manifest declares the discovery port the protocol broadcasts on', () => {
  // An undeclared port is a 403 from the core, and the scan fails.
  const activeScan = manifest.network_discovery.find((entry) => entry.type === 'udp-active-broadcast');
  assert.ok(activeScan, 'the manifest must declare an udp-active-broadcast capture');
  assert.ok(activeScan.ports.includes(DISCOVERY_PORT), `port ${DISCOVERY_PORT} must be declared`);
});

test('the poll_frequency options are exactly the values Gladys core accepts', () => {
  // Gladys validates poll_frequency in milliseconds against a closed set; an
  // option outside it would make publishDiscoveredDevices fail silently.
  const accepted = [1, 2, 10, 15, 30, 60];
  assert.deepEqual(
    pollFrequencyField.options.map((option) => Number(option.value)),
    accepted,
  );
});

test('the poll_frequency default matches the one the code falls back to', () => {
  assert.equal(Number(pollFrequencyField.default), DEFAULT_CONFIG.poll_frequency);
});

test('every poll_frequency option is translated', () => {
  for (const option of pollFrequencyField.options) {
    assert.ok(option.label.en, `option ${option.value} misses its English label`);
    assert.ok(option.label.fr, `option ${option.value} misses its French label`);
  }
});

test('the manifest version matches package.json and the image tag', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image ${manifest.docker_image} must be tagged ${manifest.version}`,
  );
});
