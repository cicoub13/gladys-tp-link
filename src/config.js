// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest. The
// SDK fetches it (`gladys.getConfig()`) and notifies changes
// (`gladys.onConfigUpdated()`); this module only provides defaults and coerces
// the types (a form may hand back strings).
//
// Devices are found by the mediated `udp-active-broadcast` scan (see
// src/discovery.js), so there is no IP list to configure — the only setting is
// how often each device is polled.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // How often Gladys polls each device, in seconds.
  poll_frequency: 60,
};

// The only poll frequencies (in seconds) Gladys core accepts on a published
// device — it validates poll_frequency in milliseconds against the closed set
// [1000, 2000, 10000, 15000, 30000, 60000]. Any other value makes
// publishDiscoveredDevices fail (silently: onScanRequest is an unacked SDK
// event), so a stale/out-of-range stored value must be snapped to this set
// rather than passed through.
const POLL_FREQUENCIES_SECONDS = [1, 2, 10, 15, 30, 60];

/**
 * Snap a poll frequency (seconds) to the nearest value Gladys core accepts.
 * @param {number} seconds - The requested poll frequency, in seconds.
 * @returns {number} The nearest value among POLL_FREQUENCIES_SECONDS.
 * @example
 * nearestPollFrequency(45); // 60
 */
function nearestPollFrequency(seconds) {
  return POLL_FREQUENCIES_SECONDS.reduce((closest, candidate) =>
    // <= so an exact tie (e.g. 45, equidistant from 30 and 60) picks the
    // larger, less chatty frequency.
    Math.abs(candidate - seconds) <= Math.abs(closest - seconds) ? candidate : closest,
  );
}

/**
 * Merge the user configuration with the defaults and coerce the types.
 * @param {Record<string, unknown>} raw - Configuration returned by the SDK.
 * @returns {object} The normalized configuration.
 * @example
 * normalizeConfig({ poll_frequency: '30' });
 */
export function normalizeConfig(raw = {}) {
  const merged = { ...DEFAULT_CONFIG, ...raw };
  return {
    ...merged,
    poll_frequency: nearestPollFrequency(Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency)),
  };
}
