import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, GladysApiError } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { handleSetValue } from '../src/setValue.js';
import { handlePoll } from '../src/poll.js';
import { buildDevice, buildOutletDevices } from '../src/tplink/model.js';
import { PARAMS, TRANSPORTS } from '../src/constants.js';
import { resetPublishedState } from '../src/statePublisher.js';
import { createFakeTpLink, PLUG_SYSINFO, BULB_SYSINFO, POWER_STRIP_SYSINFO } from './helpers/fakeTpLink.js';

function buildPlug(gladys, host = '192.168.1.10') {
  return buildDevice(gladys, PLUG_SYSINFO, host).device;
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
  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: feature.external_id, state: 1 }]);
});

test('handleSetValue turns a plug OFF', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const device = buildPlug(gladys);
  const feature = device.features[0];

  await handleSetValue(gladys, tpClient, { device, feature, value: 0 });

  assert.deepEqual(tpClient.powerCommands, [{ host: '192.168.1.10', on: false }]);
  assert.equal(gladys.fake.states[0].state, 0);
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
  gladys.fake.devices = [full];
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
  assert.equal(gladys.fake.states.length, 0);
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
  assert.deepEqual(gladys.fake.transports, [
    { device_external_id: device.external_id, transport: TRANSPORTS.UNREACHABLE },
  ]);
});

test('handleSetValue still publishes the state when the transport badge cannot be published', async (t) => {
  // The command reached the device: a failed badge update must neither hide
  // the new state nor report the command as failed.
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 0 } } });
  const device = buildPlug(gladys);
  const feature = device.features[0];
  t.mock.method(gladys, 'publishTransports', async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'RATE_LIMIT_EXCEEDED');
  });

  await handleSetValue(gladys, tpClient, { device, feature, value: 1 });

  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: feature.external_id, state: 1 }]);
});

test('handleSetValue publishes the requested state when the device state could not be read back', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  const feature = device.features[0];
  // The command went through but the read-back ran out of time (see
  // src/tplink/client.js): the wrapper returns null instead of a sysinfo.
  const tpClient = { setPowerState: async () => null };

  await handleSetValue(gladys, tpClient, { device, feature, value: 1 });

  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: feature.external_id, state: 1 }]);
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

// --- setValue on a strip outlet ---------------------------------------------

const STRIP_HOST = '192.168.1.13';
const allOn = () => ({
  ...POWER_STRIP_SYSINFO,
  children: POWER_STRIP_SYSINFO.children.map((c) => ({ ...c, state: 1 })),
});

test('turning one outlet off leaves the other outlets of the strip on', async () => {
  // FR-005, SC-002.
  const gladys = createFakeGladys();
  const byHost = { [STRIP_HOST]: allOn() };
  const tpClient = createFakeTpLink({ byHost });
  const outlets = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, STRIP_HOST);
  const tv = outlets[1];

  await handleSetValue(gladys, tpClient, { device: tv, feature: tv.features[0], value: 0 });

  assert.deepEqual(tpClient.powerCommands, [{ host: STRIP_HOST, on: false, childId: 'STRIP00101' }]);
  assert.deepEqual(
    byHost[STRIP_HOST].children.map((c) => c.state),
    [1, 0, 1],
  );
  // FR-007: the state published is the one read back for that outlet only.
  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: tv.features[0].external_id, state: 0 }]);
});

test('two outlet commands in a row each land on their own outlet', async () => {
  const gladys = createFakeGladys();
  const byHost = { [STRIP_HOST]: allOn() };
  const tpClient = createFakeTpLink({ byHost });
  const [lamp, tv] = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, STRIP_HOST);

  await Promise.all([
    handleSetValue(gladys, tpClient, { device: lamp, feature: lamp.features[0], value: 0 }),
    handleSetValue(gladys, tpClient, { device: tv, feature: tv.features[0], value: 0 }),
  ]);

  assert.deepEqual(
    byHost[STRIP_HOST].children.map((c) => c.state),
    [0, 0, 1],
  );
});

test('an outlet command publishes the requested state when the read-back is missing', async () => {
  // FR-007: the command went through but the read-back failed or timed out.
  const gladys = createFakeGladys();
  const [lamp] = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, STRIP_HOST);
  const calls = [];
  const tpClient = {
    setPowerState: async (...args) => {
      calls.push(args);
      return null;
    },
  };

  await handleSetValue(gladys, tpClient, { device: lamp, feature: lamp.features[0], value: 0 });

  assert.deepEqual(calls, [[STRIP_HOST, false, { expectedDeviceId: 'STRIP001', childId: 'STRIP00100' }]]);
  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: lamp.features[0].external_id, state: 0 }]);
});

test('an outlet command the strip no longer reports asks for a new scan, without flagging the outlet unreachable', async () => {
  const gladys = createFakeGladys();
  const [lamp] = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, STRIP_HOST);
  const tpClient = createFakeTpLink({
    byHost: { [STRIP_HOST]: { ...POWER_STRIP_SYSINFO, children: POWER_STRIP_SYSINFO.children.slice(1) } },
  });

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device: lamp, feature: lamp.features[0], value: 1 }),
    /Outlet not found on the strip at 192\.168\.1\.13: run a new scan/,
  );
  assert.equal(tpClient.powerCommands.length, 0);
  assert.equal(gladys.fake.states.length, 0);
  assert.deepEqual(gladys.fake.transports, [{ device_external_id: lamp.external_id, transport: TRANSPORTS.LOCAL }]);
});

test('an outlet command sends nothing when another device answers at the strip address', async () => {
  // FR-006.
  const gladys = createFakeGladys();
  const [lamp] = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, STRIP_HOST);
  const tpClient = createFakeTpLink({ byHost: { [STRIP_HOST]: { ...POWER_STRIP_SYSINFO, deviceId: 'SOMEONE_ELSE' } } });

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device: lamp, feature: lamp.features[0], value: 0 }),
    /Another device now answers at 192\.168\.1\.13: run a new scan/,
  );
  assert.equal(tpClient.powerCommands.length, 0);
  assert.equal(gladys.fake.states.length, 0);
});

test('an outlet command on an unreachable strip fails readably and flags the outlet unreachable', async () => {
  const gladys = createFakeGladys();
  const [lamp] = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, STRIP_HOST);
  const tpClient = createFakeTpLink({ byHost: {} });

  await assert.rejects(
    () => handleSetValue(gladys, tpClient, { device: lamp, feature: lamp.features[0], value: 0 }),
    (err) => {
      assert.match(err.message, /unreachable at 192\.168\.1\.13/);
      assert.doesNotMatch(err.message, /TCP Timeout/);
      return true;
    },
  );
  assert.deepEqual(gladys.fake.transports, [
    { device_external_id: lamp.external_id, transport: TRANSPORTS.UNREACHABLE },
  ]);
});

// --- poll -------------------------------------------------------------------

test('handlePoll publishes the plug relay_state to its ON/OFF feature', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 } } });
  const device = buildPlug(gladys);

  await handlePoll(gladys, tpClient, device);

  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: device.features[0].external_id, state: 1 }]);
  assert.deepEqual(gladys.fake.transports, [{ device_external_id: device.external_id, transport: TRANSPORTS.LOCAL }]);
});

test('handlePoll publishes the bulb light_state.on_off', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.11': { ...BULB_SYSINFO, light_state: { on_off: 1 } } } });
  const device = buildDevice(gladys, BULB_SYSINFO, '192.168.1.11').device;

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.fake.lastState(device.features[0].external_id), 1);
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

  assert.equal(gladys.fake.states.length, 1);
  assert.equal(gladys.fake.transports.length, 1); // the transport is deduplicated too
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
    gladys.fake.states.map((s) => s.state),
    [1, 0],
  );
});

test('handlePoll publishes the state of a deleted then re-created device right away', async () => {
  // Gladys drops the states of a feature that does not exist: without
  // forgetting what was published, the re-created plug would stay blank
  // until it is switched.
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 } } });
  const device = buildPlug(gladys);

  await handlePoll(gladys, tpClient, device);
  await gladys.fake.deviceDeleted(device);
  await gladys.fake.deviceCreated(device);
  await handlePoll(gladys, tpClient, device);

  assert.deepEqual(
    gladys.fake.states.map((s) => s.state),
    [1, 1],
  );
});

test('handlePoll refuses to publish the state of another device answering at the address', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': { ...PLUG_SYSINFO, deviceId: 'SOMEONE_ELSE', relay_state: 1 } },
  });

  await assert.rejects(() => handlePoll(gladys, tpClient, device), /Another device now answers/);
  assert.equal(gladys.fake.states.length, 0);
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
  assert.deepEqual(gladys.fake.transports, [
    { device_external_id: device.external_id, transport: TRANSPORTS.UNREACHABLE },
  ]);
});

test('handlePoll publishes nothing when the device carries no ON/OFF feature', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  device.features = [];
  gladys.fake.devices = [device];
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.fake.states.length, 0);
});

test('handlePoll publishes nothing when the state cannot be read from the sysinfo', async () => {
  const gladys = createFakeGladys();
  const device = buildPlug(gladys);
  // Same device, but its type is no longer one we know how to read.
  const tpClient = createFakeTpLink({
    byHost: { '192.168.1.10': { deviceId: PLUG_SYSINFO.deviceId, model: 'KC120(EU)', type: 'IOT.IPCAMERA' } },
  });

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.fake.states.length, 0);
  assert.deepEqual(gladys.fake.transports, [{ device_external_id: device.external_id, transport: TRANSPORTS.LOCAL }]);
});
