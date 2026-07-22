// -----------------------------------------------------------------------------
// Thin wrapper around `tplink-smarthome-api` (the same driver the Gladys core
// tp-link service uses). It exposes exactly the operations the integration
// needs and hides the library object, so the rest of the code — and the unit
// tests — depend on this small, mockable surface instead of the driver.
//
//   - getSysInfo(host)        : unicast read of a device system info
//   - setPowerState(host, on) : unicast ON/OFF command
// -----------------------------------------------------------------------------

// tplink-smarthome-api is a CommonJS module: import the default and destructure
// (its named exports are not statically detectable by Node's ESM interop).
import tplinkSmarthomeApi from 'tplink-smarthome-api';

const { Client } = tplinkSmarthomeApi;

/**
 * Create the TP-Link client wrapper.
 * @param {object} [deps] - Optional dependency injection for tests.
 * @param {object} [deps.client] - A pre-built `tplink-smarthome-api` Client.
 * @returns {object} The wrapper exposing getSysInfo/setPowerState.
 * @example
 * const tpClient = createClient();
 */
export function createClient({ client = new Client() } = {}) {
  return {
    /** The underlying driver, exposed for advanced use / debugging. */
    raw: client,

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
