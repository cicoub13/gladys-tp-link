import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { classify, buildDevice } from '../src/tplink/model.js';
import { DEVICE_KINDS, PARAMS, FEATURE_KEYS } from '../src/constants.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { PLUG_SYSINFO, BULB_SYSINFO, UNKNOWN_SYSINFO } from './helpers/fakeTpLink.js';

const gladys = createFakeGladys();
const config = normalizeConfig({ poll_frequency: 30 });

test('classify maps TP-Link types (type and legacy mic_type) to a kind', () => {
  assert.equal(classify({ type: 'IOT.SMARTPLUGSWITCH' }), DEVICE_KINDS.PLUG);
  assert.equal(classify({ type: 'IOT.RANGEEXTENDER.SMARTPLUG' }), DEVICE_KINDS.PLUG);
  assert.equal(classify({ mic_type: 'IOT.SMARTBULB' }), DEVICE_KINDS.BULB);
  assert.equal(classify({ type: 'IOT.IPCAMERA' }), DEVICE_KINDS.UNKNOWN);
});

test('buildDevice(plug) produces a SWITCH/binary controllable feature', () => {
  const { kind, device } = buildDevice(gladys, PLUG_SYSINFO, '192.168.1.10', config);
  assert.equal(kind, DEVICE_KINDS.PLUG);
  assert.equal(device.name, 'Office plug');
  assert.equal(device.external_id, `ext:test:plug:${PLUG_SYSINFO.deviceId}`);
  // Gladys core requires poll_frequency in milliseconds, from a closed set —
  // buildDevice converts the (already-snapped) seconds value from config.
  assert.equal(device.poll_frequency, 30000);

  const feature = device.features[0];
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(feature.external_id, `${device.external_id}:${FEATURE_KEYS.ON_OFF}`);
  assert.equal(feature.read_only, false);
});

test('buildDevice(plug) carries the IP, serial and model as params', () => {
  const { device } = buildDevice(gladys, PLUG_SYSINFO, '192.168.1.10', config);
  const byName = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(byName[PARAMS.IP_ADDRESS], '192.168.1.10');
  assert.equal(byName[PARAMS.SERIAL_NUMBER], PLUG_SYSINFO.deviceId);
  assert.equal(byName[PARAMS.MODEL], PLUG_SYSINFO.model);
});

test('buildDevice(bulb) produces a LIGHT/binary controllable feature', () => {
  const { kind, device } = buildDevice(gladys, BULB_SYSINFO, '192.168.1.11', config);
  assert.equal(kind, DEVICE_KINDS.BULB);
  const feature = device.features[0];
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.LIGHT);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.LIGHT.BINARY);
});

test('buildDevice(unknown) returns no payload so the caller can skip it', () => {
  const { kind, device } = buildDevice(gladys, UNKNOWN_SYSINFO, '192.168.1.12', config);
  assert.equal(kind, DEVICE_KINDS.UNKNOWN);
  assert.equal(device, null);
});
