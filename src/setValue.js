// -----------------------------------------------------------------------------
// Handle a user command on a device feature — port of the core
// `smart-device.setValue.js`.
//
// Only the binary ON/OFF of a plug (switch) or a bulb (light) is controllable,
// exactly like the core. The command is sent by unicast to the device IP; on
// success we publish the confirmed state (the features declare
// has_feedback: true).
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { resolveHost } from './deviceLookup.js';
import { ON } from './constants.js';

const logger = createLogger({ name: 'tp-link-set-value' });

const CONTROLLABLE_CATEGORIES = [DEVICE_FEATURE_CATEGORIES.SWITCH, DEVICE_FEATURE_CATEGORIES.LIGHT];

/**
 * Apply a value the user set on a device feature.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} tpClient - The TP-Link client wrapper.
 * @param {object} params - The command.
 * @param {object} params.device - The target device.
 * @param {object} params.feature - The target feature.
 * @param {number} params.value - The requested value (1 = on, 0 = off).
 * @returns {Promise<void>} Resolves once the state has been published.
 * @throws {Error} When the feature is not controllable or the device is unreachable.
 * @example
 * await handleSetValue(gladys, tpClient, { device, feature, value: 1 });
 */
export async function handleSetValue(gladys, tpClient, { device, feature, value }) {
  if (!CONTROLLABLE_CATEGORIES.includes(feature.category)) {
    // Throwing makes the SDK ack success:false, so the Gladys UI shows the failure.
    throw new Error(`TP-Link feature not managed: ${feature.category}`);
  }

  const host = await resolveHost(gladys, device);
  const on = value === ON;
  logger.info(`Setting ${device.external_id} -> ${on ? 'ON' : 'OFF'} (${host})`);

  await tpClient.setPowerState(host, on);

  // has_feedback: true -> reflect the state we just applied.
  await gladys.publishState(feature.external_id, on ? 1 : 0);
}
