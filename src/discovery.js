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
    const previous = responders.get(sysInfo.deviceId);
    if (previous && previous.host !== host) {
      // Multi-homed device (two interfaces, two subnets): the address we keep
      // would otherwise depend on datagram arrival order, silently.
      logger.warn(`Device ${sysInfo.deviceId} answered from ${previous.host} and ${host}; keeping ${host}`);
    }
    responders.set(sysInfo.deviceId, { sysInfo, host });
  }

  // Build the payloads, skipping the unsupported device types.
  const devices = [];
  for (const { sysInfo, host } of responders.values()) {
    const { kind, device } = buildDevice(gladys, sysInfo, host, config);
    if (kind === DEVICE_KINDS.POWER_STRIP) {
      logger.warn(
        `Skipping "${sysInfo.alias}" (model ${sysInfo.model}): multi-outlet TP-Link strips are not supported yet`,
      );
      continue;
    }
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

// Messages surfaced to the user through setConnectionStatus, which is the only
// channel the SDK gives a scan to report anything: onScanRequest is an UNACKED
// event whose exceptions are swallowed into the SDK debug channel
// (`_runHandler`), so without this the whole scan fails in complete silence.
const SCAN_ERROR_MESSAGES = {
  // The core allows one active scan per 10 seconds per integration (429).
  // Double-clicking "scan" is the most likely failure of all, by far.
  429: {
    en: 'A scan was just run, wait about 10 seconds before scanning again.',
    fr: 'Un scan vient déjà d’être lancé, patientez une dizaine de secondes avant de relancer.',
  },
  // The core rejects any capture the manifest does not declare (403).
  403: {
    en: 'This Gladys version refused the network scan. Check the integration is up to date.',
    fr: 'Cette version de Gladys a refusé le scan réseau. Vérifiez que l’intégration est à jour.',
  },
  default: {
    en: 'Device scan failed, check the integration logs.',
    fr: 'Le scan des appareils a échoué, consultez les logs de l’intégration.',
  },
};

/**
 * Run a full scan on user request: discover, publish, and report the outcome.
 * Never throws — a failure is logged AND surfaced to the user, because the SDK
 * swallows exceptions thrown from an unacked handler.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} config - The normalized integration configuration.
 * @returns {Promise<void>} Resolves once the outcome has been reported.
 * @example
 * gladys.onScanRequest(() => handleScanRequest(gladys, config));
 */
export async function handleScanRequest(gladys, config) {
  try {
    const devices = await scan(gladys, config);
    await gladys.publishDiscoveredDevices(devices);
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Device scan failed', err);
    const message = SCAN_ERROR_MESSAGES[err.status] || SCAN_ERROR_MESSAGES.default;
    // Guarded: an exception raised while reporting an exception would be
    // swallowed by the SDK too, and would hide the log line above.
    await gladys.setConnectionStatus(false, message).catch((reportErr) => {
      logger.error('Could not report the scan failure to Gladys', reportErr);
    });
  }
}
