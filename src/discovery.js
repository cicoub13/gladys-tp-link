// -----------------------------------------------------------------------------
// Device discovery — the external-integration counterpart of the core
// `smart-device.getDevices.js`.
//
// The configured IP list is probed by unicast (the only reliable path from a
// bridge container) and de-duplicated by the device serial (deviceId). The
// result is the list of discovery payloads to hand to
// `gladys.publishDiscoveredDevices()`. Nothing is created here: the user picks
// which discovered devices to add, from the Gladys "Discovery" tab.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice } from './tplink/model.js';
import { DEVICE_KINDS } from './constants.js';
import { mapLimit } from './utils.js';

const logger = createLogger({ name: 'tp-link-discovery' });

const PROBE_CONCURRENCY = 5;

/**
 * Scan for TP-Link devices and build their discovery payloads.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} tpClient - The TP-Link client wrapper (see tplink/client.js).
 * @param {object} config - The normalized integration configuration.
 * @returns {Promise<Array>} The discovery payloads for the supported devices.
 * @example
 * await scan(gladys, tpClient, config);
 */
export async function scan(gladys, tpClient, config) {
  // deviceId -> { sysInfo, host }
  const responders = new Map();

  // Unicast probe of every configured IP.
  if (config.ips.length > 0) {
    await mapLimit(config.ips, PROBE_CONCURRENCY, async (host) => {
      try {
        const sysInfo = await tpClient.getSysInfo(host);
        if (sysInfo && sysInfo.deviceId) {
          responders.set(sysInfo.deviceId, { sysInfo, host });
        }
      } catch (err) {
        logger.warn(`Could not reach TP-Link device at ${host}: ${err.message}`);
      }
    });
  }

  // Build the payloads, skipping the unsupported device types.
  const devices = [];
  for (const { sysInfo, host } of responders.values()) {
    const { kind, device } = buildDevice(gladys, sysInfo, host, config);
    if (kind === DEVICE_KINDS.UNKNOWN || !device) {
      logger.warn(
        `Skipping unsupported TP-Link device "${sysInfo.alias}" (model ${sysInfo.model}, type ${
          sysInfo.type || sysInfo.mic_type
        })`,
      );
      continue;
    }
    devices.push(device);
  }

  logger.info(`Discovered ${devices.length} controllable TP-Link device(s)`);
  return devices;
}
