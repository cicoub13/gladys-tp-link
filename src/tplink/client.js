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

// The driver defaults to a 10s timeout per round-trip. 2s stops requests from
// piling up on an unreachable device polled every second.
const SEND_TIMEOUT_MS = 2000;

// Gladys acks a command within 5s, and setPowerState needs three round-trips
// (identity check, command, read-back). They share this budget, so the device
// I/O ends by 4s even on a slow device, leaving room for the Gladys calls
// around it (device lookup, state publish).
const COMMAND_BUDGET_MS = 4000;

/**
 * Create the TP-Link client wrapper.
 * @param {object} [deps] - Optional dependency injection for tests.
 * @param {object} [deps.client] - A pre-built `tplink-smarthome-api` Client.
 * @param {Function} [deps.now] - Clock in ms (defaults to Date.now).
 * @returns {object} The wrapper exposing getSysInfo/setPowerState.
 * @example
 * const tpClient = createClient();
 */
export function createClient({
  client = new Client({ defaultSendOptions: { timeout: SEND_TIMEOUT_MS } }),
  now = Date.now,
} = {}) {
  return {
    /** The underlying driver, exposed for advanced use / debugging. */
    raw: client,

    /**
     * Read a device system info by unicast, in a single round-trip. Throws if
     * the device is unreachable.
     * @param {string} host - The device IP address.
     * @returns {Promise<object>} The TP-Link `sysinfo` object.
     */
    async getSysInfo(host) {
      return client.getSysInfo(host);
    },

    /**
     * Turn a device ON or OFF by unicast, and return the state read back from
     * the device. Throws if the device is unreachable, or if the device
     * answering at `host` is not the expected one (DHCP lease reassigned).
     * @param {string} host - The device IP address.
     * @param {boolean} on - True to turn on, false to turn off.
     * @param {object} [options] - Command options.
     * @param {string} [options.expectedDeviceId] - Serial the host must match.
     * @returns {Promise<object|null>} The `sysinfo` read back after the
     *   command, or null when it could not be read back (the command itself
     *   was applied).
     */
    async setPowerState(host, on, { expectedDeviceId } = {}) {
      const deadline = now() + COMMAND_BUDGET_MS;
      // Send options for the next round-trip: whatever is left of the budget.
      const nextSendOptions = () => {
        const left = deadline - now();
        if (left <= 0) {
          throw new Error(`TP-Link command budget exhausted for ${host}`);
        }
        return { timeout: Math.min(SEND_TIMEOUT_MS, left) };
      };

      const sysInfo = await client.getSysInfo(host, undefined, nextSendOptions());
      assertExpectedDevice(sysInfo, expectedDeviceId, host);
      // Handing the sysinfo over lets the driver pick its device class without
      // another round-trip.
      const device = await client.getDevice({ host, sysInfo });
      await device.setPowerState(Boolean(on), nextSendOptions());
      // Read back rather than trusting the command: a device can ack a frame
      // without actually switching (jammed relay), and an optimistic publish
      // would then show a state Gladys never verified. But the command was
      // applied: a read-back that fails or has no time left is not a failure.
      try {
        return await client.getSysInfo(host, undefined, nextSendOptions());
      } catch {
        return null;
      }
    },
  };
}
