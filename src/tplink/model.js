// -----------------------------------------------------------------------------
// Map a TP-Link `sysinfo` object to a Gladys discovery payload.
//
// Direct port of the core models (server/services/tp-link/lib/models):
//   - IOT.SMARTPLUGSWITCH / IOT.RANGEEXTENDER.SMARTPLUG -> plug  (SWITCH/binary)
//   - IOT.SMARTBULB                                     -> bulb  (LIGHT/binary)
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
 * @returns {string} One of DEVICE_KINDS (plug | bulb | device).
 * @example
 * classify({ type: 'IOT.SMARTPLUGSWITCH' }); // 'plug'
 */
export function classify(sysInfo) {
  const type = sysInfo.type || sysInfo.mic_type;
  if (TP_LINK_DEVICE_TYPES.PLUG.includes(type)) {
    return DEVICE_KINDS.PLUG;
  }
  if (TP_LINK_DEVICE_TYPES.BULB.includes(type)) {
    return DEVICE_KINDS.BULB;
  }
  return DEVICE_KINDS.UNKNOWN;
}

/**
 * Build the Gladys discovery payload for one TP-Link device.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} sysInfo - The TP-Link `sysinfo` object.
 * @param {string} host - The device IP address.
 * @param {object} config - The normalized integration configuration.
 * @returns {{ kind: string, device: (object|null) }} The kind and the payload
 *   (null for an unsupported device, so the caller can skip it).
 * @example
 * buildDevice(gladys, sysInfo, '192.168.1.10', config);
 */
export function buildDevice(gladys, sysInfo, host, config) {
  const kind = classify(sysInfo);
  const ids = gladys.externalIds(kind, sysInfo.deviceId);
  const alias = sysInfo.alias || sysInfo.dev_name || `TP-Link ${sysInfo.deviceId}`;

  const device = {
    name: alias,
    external_id: ids.device,
    poll_frequency: config.poll_frequency,
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
