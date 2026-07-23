// -----------------------------------------------------------------------------
// Device discovery — the external-integration counterpart of the core
// `smart-device.getDevices.js`.
//
// Kasa devices only answer an *active* discovery probe (query/response), and a
// bridge container can neither broadcast onto the LAN nor receive the unicast
// replies. So we use the SDK's mediated `udp-active-broadcast` scan: we forge
// the encrypted request, the core (host network) broadcasts it and relays the
// raw unicast replies, and we decode them here. Each reply carries the device's
// source IP, which rides along as a param so later commands/polls reach it by
// unicast. Nothing is created here: the user picks which discovered devices to
// add, from the Gladys "Discovery" tab.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice } from './tplink/model.js';
import { buildDiscoveryRequest, parseDiscoveryReply, DISCOVERY_PORT } from './tplink/protocol.js';
import { DEVICE_KINDS } from './constants.js';

const logger = createLogger({ name: 'tp-link-discovery' });

// Scan duration handed to the core (SDK bound: 1-30s). Kasa devices answer in a
// few hundred ms; 5s comfortably covers a LAN without dragging the UI.
const SCAN_TIMEOUT_SECONDS = 5;

/**
 * Scan for TP-Link devices and build their discovery payloads.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} config - The normalized integration configuration.
 * @returns {Promise<Array>} The discovery payloads for the supported devices.
 * @example
 * await scan(gladys, config);
 */
export async function scan(gladys, config) {
  const replies = await gladys.scanNetwork('udp-active-broadcast', {
    port: DISCOVERY_PORT,
    payload: buildDiscoveryRequest(),
    timeoutSeconds: SCAN_TIMEOUT_SECONDS,
  });

  // deviceId -> { sysInfo, host }, de-duplicated by serial (a device may answer
  // more than one datagram).
  const responders = new Map();
  for (const { source_ip: host, payload_base64: payloadBase64 } of replies) {
    const sysInfo = parseDiscoveryReply(payloadBase64);
    if (!sysInfo) {
      logger.warn(`Ignoring an unreadable discovery reply from ${host}`);
      continue;
    }
    responders.set(sysInfo.deviceId, { sysInfo, host });
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
