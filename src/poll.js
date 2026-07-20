// -----------------------------------------------------------------------------
// Refresh a device state on Gladys' schedule — port of the core
// `smart-device.poll.js`.
//
// Read the current sysinfo by unicast, extract the ON/OFF state depending on
// the device kind (plug -> relay_state, bulb -> light_state.on_off) and publish
// it. The SDK stores the last value, so publishing an unchanged value is cheap
// and keeps the history/last-seen accurate.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { resolveDevice, resolveHost, findOnOffFeature } from './deviceLookup.js';
import { classify } from './tplink/model.js';
import { DEVICE_KINDS } from './constants.js';

const logger = createLogger({ name: 'tp-link-poll' });

/**
 * Read the ON/OFF state out of a sysinfo, given the device kind.
 * @param {string} kind - One of DEVICE_KINDS.
 * @param {object} sysInfo - The TP-Link `sysinfo` object.
 * @returns {number|undefined} 1 / 0, or undefined for an unsupported kind.
 * @example
 * readOnOff(DEVICE_KINDS.PLUG, { relay_state: 1 }); // 1
 */
export function readOnOff(kind, sysInfo) {
  if (kind === DEVICE_KINDS.PLUG) {
    return sysInfo.relay_state;
  }
  if (kind === DEVICE_KINDS.BULB) {
    return sysInfo.light_state && sysInfo.light_state.on_off;
  }
  return undefined;
}

/**
 * Poll a device and publish its current ON/OFF state.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} tpClient - The TP-Link client wrapper.
 * @param {object} device - The device to poll.
 * @returns {Promise<void>} Resolves once the state has been published.
 * @example
 * await handlePoll(gladys, tpClient, device);
 */
export async function handlePoll(gladys, tpClient, device) {
  const full = await resolveDevice(gladys, device);
  const host = await resolveHost(gladys, full);

  const sysInfo = await tpClient.getSysInfo(host);
  const kind = classify(sysInfo);
  const state = readOnOff(kind, sysInfo);
  if (state === undefined) {
    logger.warn(`Poll: device ${device.external_id} is not a managed TP-Link type`);
    return;
  }

  const feature = findOnOffFeature(full);
  if (!feature) {
    logger.warn(`Poll: no ON/OFF feature found for ${device.external_id}`);
    return;
  }

  logger.debug(`Poll ${device.external_id} -> ${state} (${host})`);
  await gladys.publishState(feature.external_id, state);
}
