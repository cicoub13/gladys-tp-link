// -----------------------------------------------------------------------------
// Map a TP-Link `sysinfo` object to a Gladys discovery payload.
//
// Direct port of the core models (server/services/tp-link/lib/models):
//   - IOT.SMARTPLUGSWITCH / IOT.RANGEEXTENDER.SMARTPLUG -> plug  (SWITCH/binary)
//   - IOT.SMARTBULB                                     -> bulb  (LIGHT/binary)
//   - a `children[]` strip                              -> one outlet (SWITCH/binary)
//                                                          per child, see buildOutletDevices
//   - anything else                                     -> unsupported (skipped)
//
// The external ids are built with the SDK so they are namespaced with the
// integration selector; the IP address and serial number ride along as device
// `params`, the way the core carried TP_LINK_IP_ADDRESS / SERIAL_NUMBER.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { DEVICE_KINDS, FEATURE_KEYS, PARAMS, TP_LINK_DEVICE_TYPES } from '../constants.js';

/**
 * Classify a TP-Link device from its system info.
 * @param {object} sysInfo - The TP-Link `sysinfo` object.
 * @returns {string} One of DEVICE_KINDS (plug | bulb | power-strip | device).
 * @example
 * classify({ type: 'IOT.SMARTPLUGSWITCH' }); // 'plug'
 */
export function classify(sysInfo) {
  const type = sysInfo.type || sysInfo.mic_type;
  // Checked before the plug test: a strip announces itself as a plug type.
  if (Array.isArray(sysInfo.children) && sysInfo.children.length > 0) {
    return DEVICE_KINDS.POWER_STRIP;
  }
  if (TP_LINK_DEVICE_TYPES.PLUG.includes(type)) {
    return DEVICE_KINDS.PLUG;
  }
  if (TP_LINK_DEVICE_TYPES.BULB.includes(type)) {
    return DEVICE_KINDS.BULB;
  }
  return DEVICE_KINDS.UNKNOWN;
}

/**
 * Expand an outlet id to the full form, the way the driver does: some strips
 * report only the outlet index ('1' or '01'), others the strip serial plus it.
 * @param {string} deviceId - The strip serial.
 * @param {string} id - The outlet id as reported in `children[]`.
 * @returns {string} The full outlet id.
 * @example
 * normalizeChildId('STRIP001', '01'); // 'STRIP00101'
 */
export function normalizeChildId(deviceId, id) {
  if (id.length === 1) {
    return `${deviceId}0${id}`;
  }
  if (id.length === 2) {
    return `${deviceId}${id}`;
  }
  return id;
}

/**
 * Read the ON/OFF state out of a sysinfo, given the device kind.
 * @param {string} kind - One of DEVICE_KINDS.
 * @param {object} sysInfo - The TP-Link `sysinfo` object.
 * @param {string} [childId] - The full outlet id, for an outlet.
 * @returns {number|undefined} 1 / 0, or undefined for an unsupported kind or
 *   an outlet the strip no longer reports.
 * @example
 * readOnOff(DEVICE_KINDS.PLUG, { relay_state: 1 }); // 1
 */
export function readOnOff(kind, sysInfo, childId) {
  if (kind === DEVICE_KINDS.OUTLET) {
    return sysInfo.children?.find((child) => normalizeChildId(sysInfo.deviceId, child.id) === childId)?.state;
  }
  if (kind === DEVICE_KINDS.PLUG) {
    return sysInfo.relay_state;
  }
  if (kind === DEVICE_KINDS.BULB) {
    return sysInfo.light_state?.on_off;
  }
  return undefined;
}

/**
 * Check that the device answering at an address is the one we stored.
 *
 * Kasa devices are reached by IP, but an IP is only a lease: once it is
 * reassigned, reading a state would publish another device's value, and a
 * command would switch the wrong device. The serial is the stable identity, so
 * it is verified before anything is read or written.
 * @param {object} sysInfo - The `sysinfo` just read from the address.
 * @param {string} [expectedDeviceId] - The serial stored on the Gladys device.
 * @param {string} host - The address that answered, for the error message.
 * @returns {void}
 * @throws {Error} When the address is held by a different device.
 * @example
 * assertExpectedDevice(sysInfo, 'PLUG0001', '192.168.1.10');
 */
export function assertExpectedDevice(sysInfo, expectedDeviceId, host) {
  if (expectedDeviceId && sysInfo?.deviceId !== expectedDeviceId) {
    const err = new Error(`Another device now answers at ${host}: run a new scan to refresh the addresses`);
    err.userFacing = true;
    throw err;
  }
}

/**
 * Build the Gladys discovery payload for one TP-Link device.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} sysInfo - The TP-Link `sysinfo` object.
 * @param {string} host - The device IP address.
 * @returns {{ kind: string, device: (object|null) }} The kind and the payload
 *   (null for an unsupported device, so the caller can skip it).
 * @example
 * buildDevice(gladys, sysInfo, '192.168.1.10');
 */
export function buildDevice(gladys, sysInfo, host) {
  const kind = classify(sysInfo);
  const ids = gladys.externalIds(kind, sysInfo.deviceId);
  const alias = sysInfo.alias || sysInfo.dev_name || `TP-Link ${sysInfo.deviceId}`;

  const device = {
    name: alias,
    external_id: ids.device,
    // No should_poll / poll_frequency: Gladys does not poll these devices, the
    // integration refreshes them on its own timer (see src/poller.js).
    params: [
      { name: PARAMS.IP_ADDRESS, value: host },
      { name: PARAMS.SERIAL_NUMBER, value: sysInfo.deviceId },
      { name: PARAMS.MODEL, value: sysInfo.model || '' },
    ],
    features: [],
  };

  if (kind === DEVICE_KINDS.PLUG) {
    device.features.push({
      name: `${alias} On/Off`,
      external_id: ids.feature(FEATURE_KEYS.ON_OFF),
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    });
    return { kind, device };
  }

  if (kind === DEVICE_KINDS.BULB) {
    device.features.push({
      name: `${alias} On/Off`,
      external_id: ids.feature(FEATURE_KEYS.ON_OFF),
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    });
    return { kind, device };
  }

  // Unsupported device type: no controllable feature, so nothing to publish.
  return { kind, device: null };
}

/**
 * Build one Gladys discovery payload per outlet of a strip.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} sysInfo - The strip `sysinfo` object, with `children[]`.
 * @param {string} host - The strip IP address.
 * @returns {object[]} One payload per outlet.
 * @example
 * buildOutletDevices(gladys, stripSysInfo, '192.168.1.13');
 */
export function buildOutletDevices(gladys, sysInfo, host) {
  const stripAlias = sysInfo.alias || sysInfo.dev_name || `TP-Link ${sysInfo.deviceId}`;
  return sysInfo.children.map((child, index) => {
    const childId = normalizeChildId(sysInfo.deviceId, child.id);
    const ids = gladys.externalIds(DEVICE_KINDS.OUTLET, childId);
    const name = child.alias || `${stripAlias} – Outlet ${index + 1}`;
    return {
      name,
      external_id: ids.device,
      // Polled by the integration's own timer, like a plug (see buildDevice).
      params: [
        { name: PARAMS.IP_ADDRESS, value: host },
        { name: PARAMS.SERIAL_NUMBER, value: sysInfo.deviceId },
        { name: PARAMS.MODEL, value: sysInfo.model || '' },
        { name: PARAMS.CHILD_ID, value: childId },
      ],
      features: [
        {
          name: `${name} On/Off`,
          external_id: ids.feature(FEATURE_KEYS.ON_OFF),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          min: 0,
          max: 1,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
      ],
    };
  });
}
