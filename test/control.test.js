import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { handleSetValue } from '../src/setValue.js';
import { handlePoll } from '../src/poll.js';
import { buildDevice } from '../src/tplink/model.js';
import { PARAMS, TRANSPORTS } from '../src/constants.js';
import { normalizeConfig } from '../src/config.js';
import { resetPublishedState } from '../src/statePublisher.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeTpLink, PLUG_SYSINFO, BULB_SYSINFO } from './helpers/fakeTpLink.js';

const config = normalizeConfig();

function buildPlug(gladys, host = '192.168.1.10') {
  return buildDevice(gladys, PLUG_SYSINFO, host, config).device;
}

// The publisher deduplicates through module-level state, so each test must
// start from a clean slate.
beforeEach(() => resetPublishedState());

// --- setValue ---------------------------------------------------------------

test('handleSetValue turns a plug ON and publishes the state read back', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 0 } } });
  const device = buildPlug(gladys);
  const feature = device.features[0];

  await handleSetValue(gladys, tpClient, { device, feature, value: 1 });

  assert.deepEqual(tpClient.powerCommands, [{ host: '192.168.1.10', on: true }]);
  assert.deepEqual(gladys.published, [{ featureExternalId: feature.external_id, state: 1 }]);
});

test('handleSetValue turns a plug OFF', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const device = buildPlug(gladys);
  const feature = device.features[0];

  await handleSetValue(gladys, tpClient, { device, feature, value: 0 });

  assert.deepEqual(tpClient.powerCommands, [{ host: '192.168.1.10', on: false }]);
  assert.equal(gladys.published[0].state, 0);
});

test('handleSetValue accepts a value handed back as a string', async () => {
  // A strict `value === 1` would read '1' as OFF: "turn on" would turn off.
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 0 } } });
  const device = buildPlug(gladys);

  await handleSetValue(gladys, tpClient, { device, feature: device.features[0], value: '1' });

  assert.deepEqual(tpClient.powerCommands, [{ host: '192.168.1.10', on: true }]);
});

test('handleSetValue rejects a value that is neither 0 nor 1 instead of turning off', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const device = buildPlug(gladys);

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device, feature: device.features[0], value: 42 }),
    /Unsupported value/,
  );
  assert.equal(tpClient.powerCommands.length, 0);
});

test('handleSetValue rejects a feature category it does not manage', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const device = buildPlug(gladys);
  const feature = { external_id: 'x', category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR };

  await assert.rejects(() => handleSetValue(gladys, tpClient, { device, feature, value: 1 }), /no On\/Off control/);
  assert.equal(tpClient.powerCommands.length, 0);
});

test('handleSetValue resolves the IP from getDevices() when the event device is lightweight', async () => {
  const gladys = createFakeGladys();
  const full = buildPlug(gladys, '192.168.1.55');
  gladys.devices = [full];
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.55': { ...PLUG_SYSINFO, relay_state: 0 } } });

  const lightweight = { external_id: full.external_id };

  await handleSetValue(gladys, tpClient, { device: lightweight, feature: full.features[0], value: 1 });
  assert.deepEqual(tpClient.powerCommands, [{ host: '192.168.1.55', on: true }]);
});

test('handleSetValue refuses to command an address now held by another device', async () => {
  // DHCP lease reassigned: without the serial check the user would switch a
  // completely different device, with no warning at all.
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': { ...PLUG_SYSINFO, deviceId: 'SOMEONE_ELSE' } },
  });

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device, feature: device.features[0], value: 1 }),
    /Another device now answers/,
  );
  assert.equal(tpClient.powerCommands.length, 0);
  assert.equal(gladys.published.length, 0);
});

test('handleSetValue replaces the raw driver error and flags the device unreachable', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  const tpClient = createFakeTpLink({ byHost: {} }); // nothing answers

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device, feature: device.features[0], value: 1 }),
    (err) => {
      assert.match(err.message, /unreachable at 192\.168\.1\.10/);
      assert.doesNotMatch(err.message, /TCP Timeout|get_sysinfo/); // no protocol noise
      return true;
    },
  );
  assert.deepEqual(gladys.transports, [{ external_id: device.external_id, transport: TRANSPORTS.UNREACHABLE }]);
});

test('handleSetValue still publishes the state when the transport badge cannot be published', async () => {
  // The command reached the device: a failed badge update must neither hide
  // the new state nor report the command as failed.
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 0 } } });
  const device = buildPlug(gladys);
  const feature = device.features[0];
  gladys.failNext('publishTransports');

  await handleSetValue(gladys, tpClient, { device, feature, value: 1 });

  assert.deepEqual(gladys.published, [{ featureExternalId: feature.external_id, state: 1 }]);
});

test('handleSetValue reports a device with no stored address', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  device.params = device.params.filter((p) => p.name !== PARAMS.IP_ADDRESS);
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device, feature: device.features[0], value: 1 }),
    /No address stored/,
  );
});

// --- poll -------------------------------------------------------------------

test('handlePoll publishes the plug relay_state to its ON/OFF feature', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 } } });
  const device = buildPlug(gladys);

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published.length, 1);
  assert.equal(gladys.published[0].featureExternalId, device.features[0].external_id);
  assert.equal(gladys.published[0].state, 1);
  assert.deepEqual(gladys.transports, [{ external_id: device.external_id, transport: TRANSPORTS.LOCAL }]);
});

test('handlePoll publishes the bulb light_state.on_off', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.11': { ...BULB_SYSINFO, light_state: { on_off: 1 } } } });
  const device = buildDevice(gladys, BULB_SYSINFO, '192.168.1.11', config).device;

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published[0].featureExternalId, device.features[0].external_id);
  assert.equal(gladys.published[0].state, 1);
});

test('handlePoll does not re-publish an unchanged state', async () => {
  // Gladys does not deduplicate: every published state writes a history row,
  // broadcasts a websocket event and re-evaluates every trigger, against a
  // 300 states/minute budget.
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 } } });
  const device = buildPlug(gladys);

  await handlePoll(gladys, tpClient, device);
  await handlePoll(gladys, tpClient, device);
  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published.length, 1);
  assert.equal(gladys.transports.length, 1); // the transport is deduplicated too
});

test('handlePoll publishes again once the state actually changes', async () => {
  const gladys = createFakeGladys();
  const byHost = { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 } };
  const tpClient = createFakeTpLink({ byHost });
  const device = buildPlug(gladys);

  await handlePoll(gladys, tpClient, device);
  byHost['192.168.1.10'] = { ...PLUG_SYSINFO, relay_state: 0 };
  await handlePoll(gladys, tpClient, device);

  assert.deepEqual(
    gladys.published.map((p) => p.state),
    [1, 0],
  );
});

test('handlePoll refuses to publish the state of another device answering at the address', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': { ...PLUG_SYSINFO, deviceId: 'SOMEONE_ELSE', relay_state: 1 } },
  });

  await assert.rejects(() => handlePoll(gladys, tpClient, device), /Another device now answers/);
  assert.equal(gladys.published.length, 0);
});

test('handlePoll flags an unreachable device and hides the raw driver error', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  const tpClient = createFakeTpLink({ byHost: {} });

  await assert.rejects(
    () => handlePoll(gladys, tpClient, device),
    (err) => {
      assert.match(err.message, /unreachable at 192\.168\.1\.10/);
      assert.doesNotMatch(err.message, /TCP Timeout/);
      return true;
    },
  );
  assert.deepEqual(gladys.transports, [{ external_id: device.external_id, transport: TRANSPORTS.UNREACHABLE }]);
});

test('handlePoll publishes nothing when the device carries no ON/OFF feature', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  device.features = [];
  gladys.devices = [device];
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published.length, 0);
});

test('handlePoll publishes nothing when the state cannot be read from the sysinfo', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  // Same device, but its type is no longer one we know how to read.
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': { deviceId: PLUG_SYSINFO.deviceId, model: 'KC120(EU)', type: 'IOT.IPCAMERA' } },
  });

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published.length, 0);
  assert.deepEqual(gladys.transports, [{ external_id: device.external_id, transport: TRANSPORTS.LOCAL }]);
});
