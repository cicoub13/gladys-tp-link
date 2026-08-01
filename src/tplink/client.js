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
import { assertExpectedDevice } from './model.js';

const { Client } = tplinkSmarthomeApi;

// The driver defaults to a 10s timeout, but Gladys acks a command within 5s and
// setPowerState needs two round-trips (identity check, then the command). 2s
// keeps the worst case under the ack window and stops requests from piling up
// on an unreachable device polled every second.
const SEND_TIMEOUT_MS = 2000;

/**
 * Create the TP-Link client wrapper.
 * @param {object} [deps] - Optional dependency injection for tests.
 * @param {object} [deps.client] - A pre-built `tplink-smarthome-api` Client.
 * @returns {object} The wrapper exposing getSysInfo/setPowerState.
 * @example
 * const tpClient = createClient();
 */
export function createClient({ client = new Client({ defaultSendOptions: { timeout: SEND_TIMEOUT_MS } }) } = {}) {
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
     * Turn a device ON or OFF by unicast, and return the state read back from
     * the device. Throws if the device is unreachable, or if the device
     * answering at `host` is not the expected one (DHCP lease reassigned).
     * @param {string} host - The device IP address.
     * @param {boolean} on - True to turn on, false to turn off.
     * @param {object} [options] - Command options.
     * @param {string} [options.expectedDeviceId] - Serial the host must match.
     * @returns {Promise<object>} The `sysinfo` read back after the command.
     */
    async setPowerState(host, on, { expectedDeviceId } = {}) {
      // getDevice() already does a sysinfo round-trip to pick the right driver
      // class, so checking the identity here costs nothing on the network.
      const device = await client.getDevice({ host });
      assertExpectedDevice(await device.getSysInfo(), expectedDeviceId, host);
      await device.setPowerState(Boolean(on));
      // Read back rather than trusting the command: a device can ack a frame
      // without actually switching (jammed relay), and an optimistic publish
      // would then show a state Gladys never verified.
      return device.getSysInfo();
    },
  };
}
