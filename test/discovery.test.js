import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, handleScanRequest } from '../src/discovery.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  discoveryReply,
  PLUG_SYSINFO,
  BULB_SYSINFO,
  UNKNOWN_SYSINFO,
  POWER_STRIP_SYSINFO,
} from './helpers/fakeTpLink.js';

const config = normalizeConfig();

test('scan decodes the active-broadcast replies and builds one payload per supported device', async () => {
  const gladys = createFakeGladys({
    scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO), discoveryReply('192.168.1.11', BULB_SYSINFO)],
  });

  const devices = await scan(gladys, config);
  assert.equal(devices.length, 2);
  const ids = devices.map((d) => d.external_id).sort();
  assert.deepEqual(ids, [`ext:test:bulb:${BULB_SYSINFO.deviceId}`, `ext:test:plug:${PLUG_SYSINFO.deviceId}`]);
});

test('scan requests an udp-active-broadcast on the Kasa port', async () => {
  const gladys = createFakeGladys({ scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO)] });

  await scan(gladys, config);
  assert.equal(gladys.scanCalls.length, 1);
  assert.equal(gladys.scanCalls[0].type, 'udp-active-broadcast');
  assert.equal(gladys.scanCalls[0].options.port, 9999);
  assert.ok(gladys.scanCalls[0].options.payload); // the forged discovery request
});

test('scan carries the reply source IP as the device address param', async () => {
  const gladys = createFakeGladys({ scanReplies: [discoveryReply('192.168.1.42', PLUG_SYSINFO)] });

  const [device] = await scan(gladys, config);
  const ip = device.params.find((p) => p.name === 'TP_LINK_IP_ADDRESS')?.value;
  assert.equal(ip, '192.168.1.42');
});

test('scan skips unsupported device types', async () => {
  const gladys = createFakeGladys({
    scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO), discoveryReply('192.168.1.12', UNKNOWN_SYSINFO)],
  });

  const devices = await scan(gladys, config);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, `ext:test:plug:${PLUG_SYSINFO.deviceId}`);
});

test('scan de-duplicates a device answering more than one datagram', async () => {
  const gladys = createFakeGladys({
    scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO), discoveryReply('192.168.1.10', PLUG_SYSINFO)],
  });

  const devices = await scan(gladys, config);
  assert.equal(devices.length, 1);
});

test('scan tolerates an unreadable reply without failing the whole scan', async () => {
  const gladys = createFakeGladys({
    scanReplies: [
      discoveryReply('192.168.1.10', PLUG_SYSINFO),
      { source_ip: '192.168.1.99', source_port: 9999, payload_base64: 'bm90LWthc2E=' }, // "not-kasa"
    ],
  });

  const devices = await scan(gladys, config);
  assert.equal(devices.length, 1);
});

test('scan keeps the last address of a device answering from two interfaces', async () => {
  // Multi-homed device: without the warning, which address gets stored would
  // silently depend on datagram arrival order.
  const gladys = createFakeGladys({
    scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO), discoveryReply('10.0.0.10', PLUG_SYSINFO)],
  });

  const devices = await scan(gladys, config);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].params.find((p) => p.name === 'TP_LINK_IP_ADDRESS')?.value, '10.0.0.10');
});

test('scan skips a multi-outlet strip instead of publishing it as a plug', async () => {
  const gladys = createFakeGladys({
    scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO), discoveryReply('192.168.1.13', POWER_STRIP_SYSINFO)],
  });

  const devices = await scan(gladys, config);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, `ext:test:plug:${PLUG_SYSINFO.deviceId}`);
});

// --- handleScanRequest: the reporting wrapper -------------------------------
// onScanRequest is unacked and the SDK swallows what it throws, so a failure
// that is not reported here is invisible to the user AND absent from the logs.

test('handleScanRequest publishes the discovered devices and confirms the connection', async () => {
  const gladys = createFakeGladys({ scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO)] });

  await handleScanRequest(gladys, config);

  assert.equal(gladys.discovered.length, 1);
  assert.deepEqual(gladys.connectionStatuses, [{ connected: true, message: undefined }]);
});

test('handleScanRequest reports a rate-limited scan to the user instead of failing silently', async () => {
  // Double-clicking "scan": the core allows one active scan per 10 seconds.
  const rateLimited = Object.assign(new Error('RATE_LIMIT_EXCEEDED'), { status: 429 });
  const gladys = createFakeGladys({ scanError: rateLimited });

  await handleScanRequest(gladys, config); // must not throw

  assert.equal(gladys.connectionStatuses.length, 1);
  const [{ connected, message }] = gladys.connectionStatuses;
  assert.equal(connected, false);
  assert.match(message.en, /wait about 10 seconds/);
  assert.match(message.fr, /patientez/);
});

test('handleScanRequest reports a refused capture with its own message', async () => {
  const forbidden = Object.assign(new Error('FORBIDDEN'), { status: 403 });
  const gladys = createFakeGladys({ scanError: forbidden });

  await handleScanRequest(gladys, config);

  assert.match(gladys.connectionStatuses[0].message.en, /refused the network scan/);
});

test('handleScanRequest reports any other scan failure with the generic message', async () => {
  const gladys = createFakeGladys({ scanError: new Error('socket hang up') });

  await handleScanRequest(gladys, config);

  assert.equal(gladys.connectionStatuses[0].connected, false);
  assert.match(gladys.connectionStatuses[0].message.en, /Device scan failed/);
});

test('handleScanRequest reports a rejected publish too', async () => {
  const gladys = createFakeGladys({
    scanReplies: [discoveryReply('192.168.1.10', PLUG_SYSINFO)],
    publishError: new Error('payload rejected'),
  });

  await handleScanRequest(gladys, config);

  assert.equal(gladys.connectionStatuses[0].connected, false);
  assert.equal(gladys.discovered.length, 0);
});
