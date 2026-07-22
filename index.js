// -----------------------------------------------------------------------------
// Entry point of the TP-Link Kasa external integration for Gladys Assistant.
//
// This file only wires the SDK to the TP-Link logic (src/): it holds no
// hardware logic. It:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. instantiates the TP-Link client wrapper (the tplink-smarthome-api driver);
//   3. registers the event handlers BEFORE connect();
//   4. connects and reports its status.
//
// The Gladys supervisor injects the connection settings as environment
// variables (GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR); the SDK reads them automatically.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createClient } from './src/tplink/client.js';
import { scan } from './src/discovery.js';
import { handleSetValue } from './src/setValue.js';
import { handlePoll } from './src/poll.js';
import { testDevice } from './src/actions.js';

const gladys = new GladysIntegration();
const tpClient = createClient();

// Current configuration, hot-reloaded via onConfigUpdated.
let config = normalizeConfig();

// --- Discovery: the user clicked "scan" in the Discovery tab -----------------
// onScanRequest is an unacked SDK event: a thrown error here is otherwise
// swallowed silently (no ack, no console output), so publishDiscoveredDevices
// is wrapped explicitly to keep failures (e.g. a rejected payload) visible.
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> scanning for TP-Link devices');
  const devices = await scan(gladys, tpClient, config);
  try {
    await gladys.publishDiscoveredDevices(devices);
  } catch (err) {
    logger.error(`publishDiscoveredDevices failed: ${err.message}`);
  }
});

// --- Command: the user acted on a controllable feature -----------------------
gladys.onSetValue(async (device, feature, value) => {
  await handleSetValue(gladys, tpClient, { device, feature, value });
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  await handlePoll(gladys, tpClient, device);
});

// --- Manifest action: "Test a device by IP" ----------------------------------
gladys.onAction('test_device', (fields) => testDevice(tpClient, fields));

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under `gladys-sdk`); this handler
// only runs the integration's own (re)initialization. Devices are NOT
// re-scanned on connect: a network scan on every reconnection would be wasteful,
// and the devices the user already created keep working from their stored IP.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the TP-Link integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
