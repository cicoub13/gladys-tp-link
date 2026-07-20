// -----------------------------------------------------------------------------
// Thin wrapper around `tplink-smarthome-api` (the same driver the Gladys core
// tp-link service uses). It exposes exactly the four operations the integration
// needs and hides the library object, so the rest of the code — and the unit
// tests — depend on this small, mockable surface instead of the driver.
//
//   - discoverBroadcast(timeoutMs) : best-effort LAN UDP-broadcast discovery
//   - getSysInfo(host)             : unicast read of a device system info
//   - setPowerState(host, on)      : unicast ON/OFF command
//
// Discovery is best-effort on purpose: from a sandboxed bridge container the
// broadcast responses usually never come back, so this must never throw — the
// reliable path is the configured IP list, probed by `getSysInfo`.
// -----------------------------------------------------------------------------

// tplink-smarthome-api is a CommonJS module: import the default and destructure
// (its named exports are not statically detectable by Node's ESM interop).
import tplinkSmarthomeApi from 'tplink-smarthome-api';
import { createLogger } from '@gladysassistant/integration-sdk';

const { Client } = tplinkSmarthomeApi;

const logger = createLogger({ name: 'tp-link-client' });

/**
 * Create the TP-Link client wrapper.
 * @param {object} [deps] - Optional dependency injection for tests.
 * @param {object} [deps.client] - A pre-built `tplink-smarthome-api` Client.
 * @returns {object} The wrapper exposing discoverBroadcast/getSysInfo/setPowerState.
 * @example
 * const tpClient = createClient();
 */
export function createClient({ client = new Client() } = {}) {
  return {
    /** The underlying driver, exposed for advanced use / debugging. */
    raw: client,

    /**
     * Best-effort LAN broadcast discovery. Resolves with the devices that
     * answered before the timeout; resolves with `[]` (never rejects) when the
     * network swallows the broadcast, as a bridge container's does.
     * @param {number} [timeoutMs] - How long to listen, in milliseconds.
     * @returns {Promise<Array<{ sysInfo: object, host: string }>>} Responders.
     */
    discoverBroadcast(timeoutMs = 5000) {
      return new Promise((resolve) => {
        const found = new Map();
        let discovery;

        const onDevice = async (device) => {
          try {
            const sysInfo = device.sysInfo || (await device.getSysInfo());
            if (sysInfo && sysInfo.deviceId) {
              found.set(sysInfo.deviceId, { sysInfo, host: device.host });
            }
          } catch (err) {
            logger.warn(`Discovery: could not read sysinfo from ${device.host}: ${err.message}`);
          }
        };

        try {
          discovery = client.startDiscovery({ discoveryInterval: 1000, breakoutChildren: false });
          discovery.on('device-new', onDevice);
          discovery.on('device-online', onDevice);
        } catch (err) {
          logger.warn(`Broadcast discovery could not start: ${err.message}`);
          resolve([]);
          return;
        }

        setTimeout(() => {
          try {
            client.stopDiscovery();
          } catch {
            // ignore: discovery may already be stopped
          }
          if (discovery) {
            discovery.removeListener('device-new', onDevice);
            discovery.removeListener('device-online', onDevice);
          }
          resolve([...found.values()]);
        }, timeoutMs);
      });
    },

    /**
     * Read a device system info by unicast. Throws if the device is unreachable.
     * @param {string} host - The device IP address.
     * @returns {Promise<object>} The TP-Link `sysinfo` object.
     */
    async getSysInfo(host) {
      const device = await client.getDevice({ host });
      return device.getSysInfo();
    },

    /**
     * Turn a device ON or OFF by unicast. Throws if the device is unreachable.
     * @param {string} host - The device IP address.
     * @param {boolean} on - True to turn on, false to turn off.
     * @returns {Promise<void>} Resolves when the command has been sent.
     */
    async setPowerState(host, on) {
      const device = await client.getDevice({ host });
      await device.setPowerState(Boolean(on));
    },
  };
}
