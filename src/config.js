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
  // How often the integration polls each device, in seconds (src/poller.js).
  poll_frequency: 60,
};

// The poll frequencies (in seconds) offered by the manifest select. Originally
// the closed set Gladys core accepts on a published device; kept as is now that
// the integration polls on its own timer, so stored settings stay valid. A
// stale/out-of-range stored value is snapped to this set rather than passed
// through (a 0 or a garbage value would make the timer spin or never fire).
const POLL_FREQUENCIES_SECONDS = [1, 2, 10, 15, 30, 60];

/**
 * Snap a poll frequency (seconds) to the nearest accepted value.
 * @param {number} seconds - The requested poll frequency, in seconds.
 * @returns {number} The nearest value among POLL_FREQUENCIES_SECONDS.
 * @example
 * nearestPollFrequency(45); // 60
 */
function nearestPollFrequency(seconds) {
  // A non-numeric value (empty select, corrupted store) must fall back to the
  // default, NOT flow into the reduce below: every comparison against NaN is
  // false, so the accumulator would stay on the first candidate — 1 second, the
  // chattiest frequency of the set, the exact opposite of a safe default.
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_CONFIG.poll_frequency;
  }
  return POLL_FREQUENCIES_SECONDS.reduce((closest, candidate) =>
    // <= so an exact tie (e.g. 45, equidistant from 30 and 60) picks the
    // larger, less chatty frequency.
    Math.abs(candidate - seconds) <= Math.abs(closest - seconds) ? candidate : closest,
  );
}

/**
 * Merge the user configuration with the defaults and coerce the types.
 * @param {Record<string, unknown>} [raw] - Configuration returned by the SDK.
 * @returns {object} The normalized configuration.
 * @example
 * normalizeConfig({ poll_frequency: '30' });
 */
export function normalizeConfig(raw) {
  // `= {}` would not cover an explicit null, which getConfig() can return.
  const source = raw ?? {};
  const stored = source.poll_frequency;
  // A select hands back a number or a numeric string, nothing else. Anything
  // of another type is a corrupted value, not something to coerce: Number(true)
  // for instance is 1 — a member of the accepted set, and the chattiest one.
  const requested = typeof stored === 'number' || typeof stored === 'string' ? Number(stored) : NaN;
  return {
    ...DEFAULT_CONFIG,
    ...source,
    poll_frequency: nearestPollFrequency(
      stored === undefined || stored === null ? DEFAULT_CONFIG.poll_frequency : requested,
    ),
  };
}
