import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  classify,
  buildDevice,
  buildOutletDevices,
  normalizeChildId,
  readOnOff,
  assertExpectedDevice,
} from '../src/tplink/model.js';
import { DEVICE_KINDS, PARAMS, FEATURE_KEYS } from '../src/constants.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PLUG_SYSINFO, BULB_SYSINFO, UNKNOWN_SYSINFO, POWER_STRIP_SYSINFO } from './helpers/fakeTpLink.js';

const gladys = createFakeGladys();
test('classify maps TP-Link types (type and legacy mic_type) to a kind', () => {
  assert.equal(classify({ type: 'IOT.SMARTPLUGSWITCH' }), DEVICE_KINDS.PLUG);
  assert.equal(classify({ type: 'IOT.RANGEEXTENDER.SMARTPLUG' }), DEVICE_KINDS.PLUG);
  assert.equal(classify({ mic_type: 'IOT.SMARTBULB' }), DEVICE_KINDS.BULB);
  assert.equal(classify({ type: 'IOT.IPCAMERA' }), DEVICE_KINDS.UNKNOWN);
});

test('classify detects a multi-outlet strip announced as a plug', () => {
  // HS300/HS107/KP303: same type as a plug, but the state is in children[] and
  // a command without a childId would switch every outlet at once.
  assert.equal(classify(POWER_STRIP_SYSINFO), DEVICE_KINDS.POWER_STRIP);
});

test('buildDevice(power strip) returns no payload so the caller can skip it', () => {
  const { kind, device } = buildDevice(gladys, POWER_STRIP_SYSINFO, '192.168.1.13');
  assert.equal(kind, DEVICE_KINDS.POWER_STRIP);
  assert.equal(device, null);
});

test('readOnOff reads relay_state for a plug and light_state.on_off for a bulb', () => {
  assert.equal(readOnOff(DEVICE_KINDS.PLUG, { relay_state: 1 }), 1);
  assert.equal(readOnOff(DEVICE_KINDS.BULB, { light_state: { on_off: 0 } }), 0);
  assert.equal(readOnOff(DEVICE_KINDS.BULB, {}), undefined);
  assert.equal(readOnOff(DEVICE_KINDS.UNKNOWN, {}), undefined);
});

test('assertExpectedDevice rejects an address now held by another device', () => {
  assert.throws(
    () => assertExpectedDevice({ deviceId: 'OTHER' }, 'PLUG0001', '192.168.1.10'),
    /Another device now answers at 192\.168\.1\.10/,
  );
  // No stored serial (device created before this guard existed): no rejection.
  assert.doesNotThrow(() => assertExpectedDevice({ deviceId: 'OTHER' }, undefined, '192.168.1.10'));
  assert.doesNotThrow(() => assertExpectedDevice(PLUG_SYSINFO, PLUG_SYSINFO.deviceId, '192.168.1.10'));
});

test('buildDevice(plug) produces a SWITCH/binary controllable feature', () => {
  const { kind, device } = buildDevice(gladys, PLUG_SYSINFO, '192.168.1.10');
  assert.equal(kind, DEVICE_KINDS.PLUG);
  assert.equal(device.name, 'Office plug');
  assert.equal(device.external_id, `ext:test-integration:plug:${PLUG_SYSINFO.deviceId}`);
  // The integration polls on its own timer (src/poller.js): the payload asks
  // Gladys for no polling at all.
  assert.equal(device.poll_frequency, undefined);
  assert.equal(device.should_poll, undefined);

  const feature = device.features[0];
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(feature.external_id, `${device.external_id}:${FEATURE_KEYS.ON_OFF}`);
  assert.equal(feature.read_only, false);
});

test('buildDevice(plug) carries the IP, serial and model as params', () => {
  const { device } = buildDevice(gladys, PLUG_SYSINFO, '192.168.1.10');
  const byName = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(byName[PARAMS.IP_ADDRESS], '192.168.1.10');
  assert.equal(byName[PARAMS.SERIAL_NUMBER], PLUG_SYSINFO.deviceId);
  assert.equal(byName[PARAMS.MODEL], PLUG_SYSINFO.model);
});

test('buildDevice(bulb) produces a LIGHT/binary controllable feature', () => {
  const { kind, device } = buildDevice(gladys, BULB_SYSINFO, '192.168.1.11');
  assert.equal(kind, DEVICE_KINDS.BULB);
  const feature = device.features[0];
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.LIGHT);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.LIGHT.BINARY);
});

test('buildDevice(unknown) returns no payload so the caller can skip it', () => {
  const { kind, device } = buildDevice(gladys, UNKNOWN_SYSINFO, '192.168.1.12');
  assert.equal(kind, DEVICE_KINDS.UNKNOWN);
  assert.equal(device, null);
});

test('normalizeChildId expands a short outlet id with the strip serial', () => {
  assert.equal(normalizeChildId('STRIP001', '1'), 'STRIP00101');
  assert.equal(normalizeChildId('STRIP001', '01'), 'STRIP00101');
  assert.equal(normalizeChildId('STRIP001', 'STRIP00101'), 'STRIP00101');
});

test('buildOutletDevices builds one switch device per outlet, keyed by the outlet id', () => {
  const devices = buildOutletDevices(gladys, POWER_STRIP_SYSINFO, '192.168.1.13');

  assert.deepEqual(
    devices.map((d) => d.external_id),
    [
      'ext:test-integration:outlet:STRIP00100',
      'ext:test-integration:outlet:STRIP00101',
      'ext:test-integration:outlet:STRIP00102',
    ],
  );
  // Named after the outlet, else after the strip and the outlet position.
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Lamp', 'TV', 'Desk strip – Outlet 3'],
  );

  const [lamp] = devices;
  const byName = Object.fromEntries(lamp.params.map((p) => [p.name, p.value]));
  assert.deepEqual(byName, {
    [PARAMS.IP_ADDRESS]: '192.168.1.13',
    [PARAMS.SERIAL_NUMBER]: 'STRIP001',
    [PARAMS.MODEL]: 'HS300(US)',
    [PARAMS.CHILD_ID]: 'STRIP00100',
  });
  assert.equal(lamp.poll_frequency, undefined);
  assert.equal(lamp.should_poll, undefined);

  assert.equal(lamp.features.length, 1);
  const [feature] = lamp.features;
  assert.equal(feature.name, 'Lamp On/Off');
  assert.equal(feature.external_id, `${lamp.external_id}:${FEATURE_KEYS.ON_OFF}`);
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(feature.read_only, false);
  assert.equal(feature.has_feedback, true);
  assert.equal(feature.keep_history, true);
});

test('buildOutletDevices gives a short outlet id the same full id as the long form', () => {
  const short = { ...POWER_STRIP_SYSINFO, children: [{ id: '00', alias: 'Lamp', state: 1 }] };
  const [device] = buildOutletDevices(gladys, short, '192.168.1.13');
  assert.equal(device.external_id, 'ext:test-integration:outlet:STRIP00100');
});

test('readOnOff reads the state of one outlet, and nothing for an outlet the strip no longer reports', () => {
  assert.equal(readOnOff(DEVICE_KINDS.OUTLET, POWER_STRIP_SYSINFO, 'STRIP00100'), 1);
  assert.equal(readOnOff(DEVICE_KINDS.OUTLET, POWER_STRIP_SYSINFO, 'STRIP00101'), 0);
  assert.equal(readOnOff(DEVICE_KINDS.OUTLET, POWER_STRIP_SYSINFO, 'STRIP00199'), undefined);
  // A short id in children[] matches its full form.
  const short = { deviceId: 'STRIP001', children: [{ id: '01', state: 1 }] };
  assert.equal(readOnOff(DEVICE_KINDS.OUTLET, short, 'STRIP00101'), 1);
  // Plugs and bulbs ignore the child id.
  assert.equal(readOnOff(DEVICE_KINDS.PLUG, { relay_state: 1 }, 'STRIP00100'), 1);
  assert.equal(readOnOff(DEVICE_KINDS.BULB, { light_state: { on_off: 0 } }), 0);
});
