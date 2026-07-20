// -----------------------------------------------------------------------------
// Device discovery — the external-integration counterpart of the core
// `smart-device.getDevices.js`.
//
// Two sources, merged and de-duplicated by the device serial (deviceId):
//   1. the configured IP list, probed by unicast (reliable from a bridge
//      container — this is the path that actually works in the sandbox);
//   2. a best-effort LAN UDP-broadcast scan (a bonus for hosts that let the
//      container receive the broadcast responses).
//
// The result is the list of discovery payloads to hand to
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
  // deviceId -> { sysInfo, host }. A Map de-duplicates a device seen on both
  // the broadcast and the configured IP list.
  const responders = new Map();

  // 1) Best-effort broadcast discovery.
  if (config.broadcast_discovery) {
    try {
      const timeoutMs = Math.max(1, config.discovery_timeout) * 1000;
      const broadcastResults = await tpClient.discoverBroadcast(timeoutMs);
      for (const result of broadcastResults) {
        responders.set(result.sysInfo.deviceId, result);
      }
      logger.info(`Broadcast discovery found ${broadcastResults.length} device(s)`);
    } catch (err) {
      logger.warn(`Broadcast discovery failed (ignored): ${err.message}`);
    }
  }

  // 2) Unicast probe of every configured IP.
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

  // 3) Build the payloads, skipping the unsupported device types.
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
