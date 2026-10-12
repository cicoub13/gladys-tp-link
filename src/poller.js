// -----------------------------------------------------------------------------
// The integration's own poll loop.
//
// Gladys core only schedules onPoll for devices published with
// `should_poll: true`, which this integration never did: no created device was
// ever polled. Adding the flag now would not reach the devices users already
// created (Gladys offers the Discovery "Update" button only when features
// change), so the integration refreshes them itself, every `poll_frequency`
// seconds, through the same per-device logic (src/poll.js).
//
// A tick that comes while the previous run is still going is skipped, so runs
// never overlap. Devices are polled side by side and a failing one is only
// logged: it stops neither the others nor the timer.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tp-link-poller' });

/**
 * Create the poll loop over every created device.
 * @param {object} deps - Dependencies.
 * @param {() => object[]} deps.listDevices - Returns the created devices (read at each run).
 * @param {(device: object) => Promise<void>} deps.pollDevice - Polls one device.
 * @returns {{ start: Function, update: Function, stop: Function }} The poller.
 * @example
 * const poller = createPoller({ listDevices: () => gladys.devices, pollDevice });
 * poller.start(config.poll_frequency);
 */
export function createPoller({ listDevices, pollDevice }) {
  let timer = null;
  let intervalSeconds = null;
  let running = false;

  /**
   * Poll every created device once, unless a run is already going.
   * Never rejects: it is called from a timer.
   * @returns {Promise<void>} Resolves once every device settled.
   * @example
   * await runOnce();
   */
  async function runOnce() {
    if (running) {
      logger.debug('Previous poll still running, skipping this one');
      return;
    }
    running = true;
    try {
      const devices = listDevices();
      // async wrapper: a synchronous throw becomes a rejection of that device only.
      const results = await Promise.allSettled(devices.map(async (device) => pollDevice(device)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.warn(`Poll of ${devices[index].external_id} failed: ${result.reason?.message}`);
        }
      });
    } catch (err) {
      logger.error('Poll run failed', err);
    } finally {
      running = false;
    }
  }

  /**
   * Stop polling. A run in flight finishes, but nothing is scheduled after it.
   * @returns {void}
   * @example
   * poller.stop();
   */
  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    intervalSeconds = null;
  }

  /**
   * (Re)start polling: poll now, then every `seconds`.
   * @param {number} seconds - The interval, in seconds.
   * @returns {Promise<void>} Resolves once the immediate run settled.
   * @example
   * poller.start(60);
   */
  function start(seconds) {
    stop();
    intervalSeconds = seconds;
    timer = setInterval(runOnce, seconds * 1000);
    return runOnce();
  }

  /**
   * Re-arm with a new interval, only when polling is started and the interval
   * actually changed.
   * @param {number} seconds - The new interval, in seconds.
   * @returns {Promise<void>} Resolves once the re-armed loop's first run settled.
   * @example
   * poller.update(config.poll_frequency);
   */
  async function update(seconds) {
    if (timer === null || seconds === intervalSeconds) {
      return;
    }
    await start(seconds);
  }

  return { start, update, stop };
}
