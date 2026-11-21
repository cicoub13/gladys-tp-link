import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES, GladysApiError } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { scan, handleScanRequest } from '../src/discovery.js';
import {
  discoveryReply,
  PLUG_SYSINFO,
  BULB_SYSINFO,
  UNKNOWN_SYSINFO,
  POWER_STRIP_SYSINFO,
} from './helpers/fakeTpLink.js';

// The raw replies Gladys relays for an active broadcast scan.
function withReplies(replies) {
  return createFakeGladys({ scanResults: { 'udp-active-broadcast': replies } });
}

test('scan decodes the active-broadcast replies and builds one payload per supported device', async () => {
  const gladys = withReplies([
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
    discoveryReply('192.168.1.11', BULB_SYSINFO),
  ]);

  const devices = await scan(gladys);
  assert.equal(devices.length, 2);
  const ids = devices.map((d) => d.external_id).sort();
  assert.deepEqual(ids, [
    `ext:test-integration:bulb:${BULB_SYSINFO.deviceId}`,
    `ext:test-integration:plug:${PLUG_SYSINFO.deviceId}`,
  ]);
});

test('scan requests an udp-active-broadcast on the Kasa port', async () => {
  const gladys = withReplies([discoveryReply('192.168.1.10', PLUG_SYSINFO)]);

  await scan(gladys);
  assert.equal(gladys.fake.scans.length, 1);
  assert.equal(gladys.fake.scans[0].type, 'udp-active-broadcast');
  assert.equal(gladys.fake.scans[0].port, 9999);
  assert.ok(gladys.fake.scans[0].payload_base64); // the forged discovery request
});

test('scan carries the reply source IP as the device address param', async () => {
  const gladys = withReplies([discoveryReply('192.168.1.42', PLUG_SYSINFO)]);

  const [device] = await scan(gladys);
  const ip = device.params.find((p) => p.name === 'TP_LINK_IP_ADDRESS')?.value;
  assert.equal(ip, '192.168.1.42');
});

test('scan skips unsupported device types', async () => {
  const gladys = withReplies([
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
    discoveryReply('192.168.1.12', UNKNOWN_SYSINFO),
  ]);

  const devices = await scan(gladys);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, `ext:test-integration:plug:${PLUG_SYSINFO.deviceId}`);
});

test('scan de-duplicates a device answering more than one datagram', async () => {
  const gladys = withReplies([
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
  ]);

  const devices = await scan(gladys);
  assert.equal(devices.length, 1);
});

test('scan tolerates an unreadable reply without failing the whole scan', async () => {
  const gladys = withReplies([
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
    { source_ip: '192.168.1.99', source_port: 9999, payload_base64: 'bm90LWthc2E=' }, // "not-kasa"
  ]);

  const devices = await scan(gladys);
  assert.equal(devices.length, 1);
});

test('scan keeps the last address of a device answering from two interfaces', async () => {
  // Multi-homed device: without the warning, which address gets stored would
  // silently depend on datagram arrival order.
  const gladys = withReplies([discoveryReply('192.168.1.10', PLUG_SYSINFO), discoveryReply('10.0.0.10', PLUG_SYSINFO)]);

  const devices = await scan(gladys);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].params.find((p) => p.name === 'TP_LINK_IP_ADDRESS')?.value, '10.0.0.10');
});

test('a scan publishes one switch device per strip outlet, next to unchanged plugs and bulbs', async (t) => {
  const warnings = [];
  t.mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));
  const gladys = withReplies([
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
    discoveryReply('192.168.1.11', BULB_SYSINFO),
    discoveryReply('192.168.1.13', POWER_STRIP_SYSINFO),
  ]);
  const singles = withReplies([
    discoveryReply('192.168.1.10', PLUG_SYSINFO),
    discoveryReply('192.168.1.11', BULB_SYSINFO),
  ]);

  await handleScanRequest(gladys);
  await handleScanRequest(singles);

  const published = gladys.fake.discoveredDevices;
  const outlets = published.filter((d) => d.external_id.includes(':outlet:'));
  // FR-001: one device per outlet.
  assert.deepEqual(
    outlets.map((d) => d.external_id),
    [
      'ext:test-integration:outlet:STRIP00100',
      'ext:test-integration:outlet:STRIP00101',
      'ext:test-integration:outlet:STRIP00102',
    ],
  );
  // FR-004: the outlet name, else the strip name and the outlet position.
  assert.deepEqual(
    outlets.map((d) => d.name),
    ['Lamp', 'TV', 'Desk strip – Outlet 3'],
  );
  // FR-002: exactly one On/Off switch each.
  for (const outlet of outlets) {
    assert.equal(outlet.features.length, 1);
    assert.equal(outlet.features[0].category, DEVICE_FEATURE_CATEGORIES.SWITCH);
    assert.equal(outlet.features[0].type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
    assert.equal(outlet.features[0].read_only, false);
  }
  // FR-010: the plug and the bulb are published exactly as without the strip.
  assert.deepEqual(
    published.filter((d) => !d.external_id.includes(':outlet:')),
    singles.fake.discoveredDevices,
  );
  // FR-011: no "not supported" line any more.
  assert.ok(!warnings.some((w) => /not supported/.test(w)), warnings.join('\n'));
});

test('a rescan finds the same outlets again, even at a new address', async () => {
  // FR-003: the outlet identity is the strip serial and the outlet id, not the
  // address, so the devices users created are recognised.
  const first = withReplies([discoveryReply('192.168.1.13', POWER_STRIP_SYSINFO)]);
  const second = withReplies([discoveryReply('192.168.1.77', POWER_STRIP_SYSINFO)]);

  await handleScanRequest(first);
  await handleScanRequest(second);

  const ids = (gladys) => gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.deepEqual(ids(second), ids(first));
  const address = second.fake.discoveredDevices[0].params.find((p) => p.name === 'TP_LINK_IP_ADDRESS').value;
  assert.equal(address, '192.168.1.77');
});

// --- handleScanRequest: the reporting wrapper -------------------------------
// onScanRequest is unacked and the SDK swallows what it throws, so a failure
// that is not reported here is invisible to the user AND absent from the logs.

test('handleScanRequest publishes the discovered devices and confirms the connection', async () => {
  const gladys = withReplies([discoveryReply('192.168.1.10', PLUG_SYSINFO)]);

  await handleScanRequest(gladys);

  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.deepEqual(gladys.fake.connectionStatuses, [{ connected: true }]);
});

test('handleScanRequest reports a rate-limited scan to the user instead of failing silently', async (t) => {
  // Double-clicking "scan": the core allows one active scan per 10 seconds.
  const gladys = createFakeGladys();
  t.mock.method(gladys, 'scanNetwork', async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'RATE_LIMIT_EXCEEDED');
  });

  await handleScanRequest(gladys); // must not throw

  assert.equal(gladys.fake.connectionStatuses.length, 1);
  const [{ connected, message }] = gladys.fake.connectionStatuses;
  assert.equal(connected, false);
  assert.match(message.en, /wait about 10 seconds/);
  assert.match(message.fr, /patientez/);
});

test('handleScanRequest reports a refused capture with its own message', async (t) => {
  const gladys = createFakeGladys();
  t.mock.method(gladys, 'scanNetwork', async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'FORBIDDEN');
  });

  await handleScanRequest(gladys);

  assert.match(gladys.fake.connectionStatuses[0].message.en, /refused the network scan/);
});

test('handleScanRequest reports any other scan failure with the generic message', async (t) => {
  const gladys = createFakeGladys();
  t.mock.method(gladys, 'scanNetwork', async () => {
    throw new Error('socket hang up');
  });

  await handleScanRequest(gladys);

  assert.equal(gladys.fake.connectionStatuses[0].connected, false);
  assert.match(gladys.fake.connectionStatuses[0].message.en, /Device scan failed/);
});

test('handleScanRequest reports a rejected publish too', async (t) => {
  const gladys = withReplies([discoveryReply('192.168.1.10', PLUG_SYSINFO)]);
  t.mock.method(gladys, 'publishDiscoveredDevices', async () => {
    throw new GladysApiError(400, 'BAD_REQUEST', 'payload rejected');
  });

  await handleScanRequest(gladys);

  assert.equal(gladys.fake.connectionStatuses[0].connected, false);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
});
