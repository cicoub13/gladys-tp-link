import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/discovery.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { discoveryReply, PLUG_SYSINFO, BULB_SYSINFO, UNKNOWN_SYSINFO } from './helpers/fakeTpLink.js';

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
