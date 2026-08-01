// -----------------------------------------------------------------------------
// Publish to Gladys only what actually changed.
//
// Gladys does NOT deduplicate: every published state writes a history row (the
// features declare keep_history), broadcasts a websocket event and re-evaluates
// every trigger. The host API caps states at 300 per minute per integration,
// sized for state *changes*, not for full snapshots — at one poll per second a
// handful of devices would blow through it. So both helpers below are no-ops
// when the value is the same as the one already published.
//
// The value cache doubles as the guard against the setValue/poll race: a poll
// that started BEFORE a command must not publish the state it read before the
// command was applied, or the switch visibly flips back on its own in the UI.
// -----------------------------------------------------------------------------

// featureExternalId -> { value, at }, `at` being when we published it.
const lastStates = new Map();
// deviceExternalId -> last published transport.
const lastTransports = new Map();

/**
 * Publish a feature state, unless it is unchanged or superseded.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {string} featureExternalId - The target feature.
 * @param {number} value - The state to publish.
 * @param {number} [readAt] - When the value was read from the device
 *   (Date.now()); a read older than the last publish is dropped as stale.
 * @returns {Promise<boolean>} True when the state was actually published.
 * @example
 * await publishFeatureState(gladys, feature.external_id, 1, readAt);
 */
export async function publishFeatureState(gladys, featureExternalId, value, readAt = Date.now()) {
  const previous = lastStates.get(featureExternalId);
  if (previous && (previous.value === value || previous.at > readAt)) {
    return false;
  }
  lastStates.set(featureExternalId, { value, at: Date.now() });
  await gladys.publishState(featureExternalId, value);
  return true;
}

/**
 * Publish a device transport status, unless it is already the current one.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {string} deviceExternalId - The target device.
 * @param {string} transport - 'local' when reachable, 'unreachable' otherwise.
 * @returns {Promise<boolean>} True when the transport was actually published.
 * @example
 * await publishDeviceTransport(gladys, device.external_id, 'unreachable');
 */
export async function publishDeviceTransport(gladys, deviceExternalId, transport) {
  if (lastTransports.get(deviceExternalId) === transport) {
    return false;
  }
  lastTransports.set(deviceExternalId, transport);
  await gladys.publishTransports([{ external_id: deviceExternalId, transport }]);
  return true;
}

/**
 * Forget everything published so far. Only used to isolate unit tests.
 * @returns {void}
 * @example
 * resetPublishedState();
 */
export function resetPublishedState() {
  lastStates.clear();
  lastTransports.clear();
}
