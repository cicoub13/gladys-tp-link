// -----------------------------------------------------------------------------
// Handle a user command on a device feature — port of the core
// `smart-device.setValue.js`.
//
// Only the binary ON/OFF of a plug (switch) or a bulb (light) is controllable,
// exactly like the core. The command is sent by unicast to the device IP, after
// checking that address is still held by the expected device; the state that is
// then published is the one read back from the device, not the one we asked
// for, so a frame acked but not applied cannot show a state Gladys never saw.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { resolveTarget } from './deviceLookup.js';
import { classify, readOnOff } from './tplink/model.js';
import { publishFeatureState, publishDeviceTransport } from './statePublisher.js';
import { ON, OFF, TRANSPORTS } from './constants.js';
import { toUserFacingError } from './errors.js';

const logger = createLogger({ name: 'tp-link-set-value' });

const CONTROLLABLE_CATEGORIES = [DEVICE_FEATURE_CATEGORIES.SWITCH, DEVICE_FEATURE_CATEGORIES.LIGHT];

/**
 * Coerce and validate the requested value of a binary feature.
 * @param {unknown} value - The value Gladys sent.
 * @returns {boolean} True to turn on, false to turn off.
 * @throws {Error} When the value is neither 0 nor 1.
 * @example
 * readRequestedPower('1'); // true
 */
function readRequestedPower(value) {
  // Coerced rather than compared strictly: a '1' coming back as a string would
  // otherwise silently mean OFF, and "turn on" would turn the device off.
  const numeric = Number(value);
  if (numeric !== ON && numeric !== OFF) {
    const err = new Error(`Unsupported value for an On/Off control: ${value}`);
    err.userFacing = true;
    throw err;
  }
  return numeric === ON;
}

/**
 * Apply a value the user set on a device feature.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} tpClient - The TP-Link client wrapper.
 * @param {object} params - The command.
 * @param {object} params.device - The target device.
 * @param {object} params.feature - The target feature.
 * @param {number} params.value - The requested value (1 = on, 0 = off).
 * @returns {Promise<void>} Resolves once the state has been published.
 * @throws {Error} When the feature is not controllable or the command failed.
 * @example
 * await handleSetValue(gladys, tpClient, { device, feature, value: 1 });
 */
export async function handleSetValue(gladys, tpClient, { device, feature, value }) {
  if (!CONTROLLABLE_CATEGORIES.includes(feature.category)) {
    // Throwing makes the SDK ack success:false, so the Gladys UI shows the failure.
    const err = new Error(`This TP-Link device has no On/Off control (${feature.category})`);
    err.userFacing = true;
    throw err;
  }

  const on = readRequestedPower(value);
  const { full, host, serial } = await resolveTarget(gladys, device);
  logger.info(`Setting ${device.external_id} -> ${on ? 'ON' : 'OFF'} (${host})`);

  let sysInfo;
  try {
    sysInfo = await tpClient.setPowerState(host, on, { expectedDeviceId: serial });
  } catch (err) {
    logger.error(`Command on ${device.external_id} failed at ${host}`, err);
    await publishDeviceTransport(gladys, full.external_id, TRANSPORTS.UNREACHABLE).catch((reportErr) => {
      logger.error('Could not publish the unreachable transport', reportErr);
    });
    throw toUserFacingError(err, `TP-Link device unreachable at ${host}: check it is powered on and on your network`);
  }

  // Guarded: the command already reached the device, a failed badge update
  // must not hide its new state nor report the command as failed.
  await publishDeviceTransport(gladys, full.external_id, TRANSPORTS.LOCAL).catch((reportErr) => {
    logger.error('Could not publish the local transport', reportErr);
  });

  // Publish what the device reports, falling back to the requested value if the
  // read-back is unusable or missing (null: it failed or ran out of time) — the
  // command did succeed, the UI must reflect it.
  const readBack = sysInfo ? readOnOff(classify(sysInfo), sysInfo) : undefined;
  await publishFeatureState(gladys, feature.external_id, typeof readBack === 'number' ? readBack : Number(on));
}
