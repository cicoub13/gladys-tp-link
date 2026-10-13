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
import { handleScanRequest } from './src/discovery.js';
import { handleSetValue } from './src/setValue.js';
import { handlePoll } from './src/poll.js';
import { createPoller } from './src/poller.js';
import { forgetDeviceTransport } from './src/statePublisher.js';
import { connectAndStayAlive, exitOnUnhandledRejection } from './src/lifecycle.js';

// Installed first, so it also covers the rest of the startup.
exitOnUnhandledRejection({ logger });

const gladys = new GladysIntegration();
const tpClient = createClient();

// Current configuration, hot-reloaded via onConfigUpdated.
let config = normalizeConfig();

// Refreshes every created device every config.poll_frequency seconds: Gladys
// never polls them itself (see src/poller.js). The SDK keeps `gladys.devices`
// up to date (resynchronized on every connection, then on each device
// created/updated/deleted event).
const poller = createPoller({
  listDevices: () => gladys.devices,
  pollDevice: (device) => handlePoll(gladys, tpClient, device),
});

// --- Discovery: the user clicked "scan" in the Discovery tab -----------------
// onScanRequest is an unacked SDK event: an error thrown from here is swallowed
// into the SDK debug channel (no ack, no visible log), so handleScanRequest owns
// the reporting and never throws — see src/discovery.js.
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> scanning for TP-Link devices');
  await handleScanRequest(gladys);
});

// --- Command: the user acted on a controllable feature -----------------------
gladys.onSetValue(async (device, feature, value) => {
  await handleSetValue(gladys, tpClient, { device, feature, value });
});

// --- Polling: a no-op, src/poller.js refreshes the devices ------------------
// Devices created before the own timer still carry a poll_frequency. Should a
// Gladys version start polling them, ack instead of answering "not implemented".
gladys.onPoll(() => {});

// --- Devices created, updated or deleted by the user -------------------------
// The SDK forgets the states it published for the device, so the next poll
// sends them again (a re-created device would otherwise stay blank until it
// changes); forget its transport badge as well.
gladys.onDeviceCreated(forgetDeviceTransport);
gladys.onDeviceUpdated(forgetDeviceTransport);
gladys.onDeviceDeleted(forgetDeviceTransport);

// --- Configuration updated by the user ---------------------------------------
// Wrapped because onConfigUpdated is unacked too: an error here would leave the
// integration silently running on the previous configuration.
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  try {
    config = normalizeConfig(newConfig);
  } catch (err) {
    logger.error('Could not apply the new configuration, keeping the previous one', err);
  }
  // Re-arms the loop when the refresh interval changed (no-op while stopped).
  await poller.update(config.poll_frequency);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under `gladys-sdk`); this handler
// only runs the integration's own (re)initialization. Devices are NOT
// re-scanned on connect: a network scan on every reconnection would be wasteful,
// and the devices the user already created keep working from their stored IP.
gladys.on('connected', async () => {
  // Gladys may have missed states while we were away (a device deleted and
  // re-created meanwhile): the next poll sends every value again. The SDK only
  // forgets on device events, not on reconnection.
  gladys.forgetPublishedStates();
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
  // Started even when the step above failed: the SDK resynchronized the
  // devices before emitting 'connected', and they still need refreshing.
  // Unless the connection dropped meanwhile: 'disconnected' already stopped it.
  if (gladys.connected) {
    poller.start(config.poll_frequency);
  }
});

// No timer left running while Gladys is unreachable: 'connected' restarts it.
gladys.on('disconnected', () => {
  poller.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  poller.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the TP-Link integration...');
connectAndStayAlive(gladys, { logger });
