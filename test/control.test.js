import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { handleSetValue } from '../src/setValue.js';
import { handlePoll, readOnOff } from '../src/poll.js';
import { testDevice } from '../src/actions.js';
import { buildDevice } from '../src/tplink/model.js';
import { DEVICE_KINDS } from '../src/constants.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeTpLink, PLUG_SYSINFO, BULB_SYSINFO } from './helpers/fakeTpLink.js';

const config = normalizeConfig();

function buildPlug(gladys, host = '192.168.1.10') {
  return buildDevice(gladys, PLUG_SYSINFO, host, config).device;
}

// --- setValue ---------------------------------------------------------------

test('handleSetValue turns a plug ON and publishes the confirmed state', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
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

test('handleSetValue rejects a feature category it does not manage', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const device = buildPlug(gladys);
  const feature = { external_id: 'x', category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR };

  await assert.rejects(() => handleSetValue(gladys, tpClient, { device, feature, value: 1 }), /not managed/);
  assert.equal(tpClient.powerCommands.length, 0);
});

test('handleSetValue resolves the IP from getDevices() when the event device is lightweight', async () => {
  const gladys = createFakeGladys();
  const full = buildPlug(gladys, '192.168.1.55');
  gladys.devices = [full];
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.55': PLUG_SYSINFO } });

  const lightweight = { external_id: full.external_id };
  const feature = full.features[0];

  await handleSetValue(gladys, tpClient, { device: lightweight, feature, value: 1 });
  assert.deepEqual(tpClient.powerCommands, [{ host: '192.168.1.55', on: true }]);
});

// --- poll -------------------------------------------------------------------

test('readOnOff reads relay_state for a plug and light_state.on_off for a bulb', () => {
  assert.equal(readOnOff(DEVICE_KINDS.PLUG, { relay_state: 1 }), 1);
  assert.equal(readOnOff(DEVICE_KINDS.BULB, { light_state: { on_off: 0 } }), 0);
  assert.equal(readOnOff(DEVICE_KINDS.UNKNOWN, {}), undefined);
});

test('handlePoll publishes the plug relay_state to its ON/OFF feature', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 } } });
  const device = buildPlug(gladys);

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published.length, 1);
  assert.equal(gladys.published[0].featureExternalId, device.features[0].external_id);
  assert.equal(gladys.published[0].state, 1);
});

test('handlePoll publishes the bulb light_state.on_off', async () => {
  const gladys = createFakeGladys();
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.11': { ...BULB_SYSINFO, light_state: { on_off: 1 } } } });
  const device = buildDevice(gladys, BULB_SYSINFO, '192.168.1.11', config).device;

  await handlePoll(gladys, tpClient, device);

  assert.equal(gladys.published[0].featureExternalId, device.features[0].external_id);
  assert.equal(gladys.published[0].state, 1);
});

// --- actions ----------------------------------------------------------------

test('testDevice reports a reachable, supported device', async () => {
  const tpClient = createFakeTpLink({ byHost: { '192.168.1.10': PLUG_SYSINFO } });
  const message = await testDevice(tpClient, { ip: '192.168.1.10' });
  assert.match(message.en, /Office plug/);
  assert.match(message.en, new RegExp(DEVICE_KINDS.PLUG));
});

test('testDevice reports an unreachable device', async () => {
  const tpClient = createFakeTpLink({ byHost: {} });
  const message = await testDevice(tpClient, { ip: '192.168.1.99' });
  assert.match(message.en, /Could not reach/);
});

test('testDevice guards an empty IP', async () => {
  const tpClient = createFakeTpLink({ byHost: {} });
  const message = await testDevice(tpClient, {});
  assert.match(message.en, /provide an IP/);
});
