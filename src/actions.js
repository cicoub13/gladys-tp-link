// -----------------------------------------------------------------------------
// Manifest action handlers (buttons in the Configuration screen).
//
// `test_device`: probe a single IP address and report what answered. It lets a
// user confirm a device is reachable from the container before adding its IP to
// the list — the quickest way to tell a wrong IP from a network-isolation issue.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { classify } from './tplink/model.js';
import { DEVICE_KINDS } from './constants.js';

const logger = createLogger({ name: 'tp-link-action' });

/**
 * Probe one IP address and return a human-readable, multi-language result.
 * @param {object} tpClient - The TP-Link client wrapper.
 * @param {object} fields - The action fields (`ip`).
 * @returns {Promise<{ en: string, fr: string }>} The message shown under the button.
 * @example
 * await testDevice(tpClient, { ip: '192.168.1.10' });
 */
export async function testDevice(tpClient, fields) {
  const ip = String(fields?.ip || '').trim();
  if (!ip) {
    return { en: 'Please provide an IP address.', fr: 'Veuillez indiquer une adresse IP.' };
  }

  logger.info(`Testing TP-Link device at ${ip}`);
  try {
    const sysInfo = await tpClient.getSysInfo(ip);
    const kind = classify(sysInfo);
    const alias = sysInfo.alias || sysInfo.deviceId;
    const model = sysInfo.model || 'unknown model';

    if (kind === DEVICE_KINDS.UNKNOWN) {
      return {
        en: `Reached "${alias}" (${model}) but this device type is not supported.`,
        fr: `"${alias}" (${model}) est joignable mais ce type d'appareil n'est pas géré.`,
      };
    }
    return {
      en: `Reached "${alias}" (${model}), detected as a ${kind}. Add ${ip} to the list, then scan.`,
      fr: `"${alias}" (${model}) est joignable, détecté comme ${kind}. Ajoutez ${ip} à la liste, puis lancez un scan.`,
    };
  } catch (err) {
    return {
      en: `Could not reach a TP-Link device at ${ip}: ${err.message}`,
      fr: `Impossible de joindre un appareil TP-Link à ${ip} : ${err.message}`,
    };
  }
}
