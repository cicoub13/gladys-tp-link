import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/discovery.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeTpLink, PLUG_SYSINFO, BULB_SYSINFO, UNKNOWN_SYSINFO } from './helpers/fakeTpLink.js';

test('scan probes the configured IPs and builds one payload per supported device', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': PLUG_SYSINFO, '192.168.1.11': BULB_SYSINFO },
  });
  const config = normalizeConfig({ device_ips: '192.168.1.10, 192.168.1.11' });

  const devices = await scan(gladys, tpClient, config);
  assert.equal(devices.length, 2);
  const ids = devices.map((d) => d.external_id).sort();
  assert.deepEqual(ids, [`ext:test:bulb:${BULB_SYSINFO.deviceId}`, `ext:test:plug:${PLUG_SYSINFO.deviceId}`]);
});

test('scan skips unsupported device types', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': PLUG_SYSINFO, '192.168.1.12': UNKNOWN_SYSINFO },
  });
  const config = normalizeConfig({ device_ips: '192.168.1.10, 192.168.1.12' });

  const devices = await scan(gladys, tpClient, config);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, `ext:test:plug:${PLUG_SYSINFO.deviceId}`);
});

test('scan tolerates an unreachable IP without failing the whole scan', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const config = normalizeConfig({ device_ips: '192.168.1.10, 192.168.1.99' });

  const devices = await scan(gladys, tpClient, config);
  assert.equal(devices.length, 1);
});
