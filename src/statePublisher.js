// -----------------------------------------------------------------------------
// Publish to Gladys only what actually changed.
//
// Gladys does NOT deduplicate: every published state writes a history row (the
// features declare keep_history), broadcasts a websocket event and re-evaluates
// every trigger. The host API caps states at 300 per minute per integration,
// sized for state *changes*, not for full snapshots — at one poll per second a
// handful of devices would blow through it. So both helpers below are no-ops
// when the value is the same as the one already published: the SDK's
// publishChangedStates deduplicates the states (and forgets a device's values
// when the user creates, updates or deletes it), a local cache the transports.
//
// On top of that, a guard against the setValue/poll race: a poll that started
// BEFORE a command must not publish the state it read before the command was
// applied, or the switch visibly flips back on its own in the UI.
// -----------------------------------------------------------------------------

// featureExternalId -> when a value was last handed to publishChangedStates,
// published or confirmed unchanged: a read started before it is stale.
const lastPublishAt = new Map();
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
  if (lastPublishAt.get(featureExternalId) > readAt) {
    return false;
  }
  // Stamped before the await so a concurrent stale poll is already dropped.
  // Kept even when the value is unchanged or the publish fails: a read started
  // before this one is stale either way (the SDK re-sends a refused value).
  lastPublishAt.set(featureExternalId, Date.now());
  const { count } = await gladys.publishChangedStates([
    { device_feature_external_id: featureExternalId, state: value },
  ]);
  return count > 0;
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
  const previous = lastTransports.get(deviceExternalId);
  if (previous === transport) {
    return false;
  }
  lastTransports.set(deviceExternalId, transport);
  try {
    await gladys.publishTransports([{ external_id: deviceExternalId, transport }]);
  } catch (err) {
    rollback(lastTransports, deviceExternalId, transport, previous);
    throw err;
  }
  return true;
}

/**
 * Forget the transport published for a device, so the next poll publishes it
 * again. Called when the user creates, updates or deletes the device, like the
 * SDK does for its states.
 * @param {object} device - The device from the SDK event.
 * @returns {void}
 * @example
 * gladys.onDeviceCreated(forgetDeviceTransport);
 */
export function forgetDeviceTransport(device) {
  lastTransports.delete(device.external_id);
}

/**
 * Undo a cache entry after a failed publish, unless a later publish already
 * replaced it.
 * @param {Map} cache - lastTransports.
 * @param {string} key - The external id.
 * @param {unknown} entry - The entry the failed publish recorded.
 * @param {unknown} previous - The entry before it (undefined when none).
 * @returns {void}
 * @example
 * rollback(lastTransports, 'd1', 'local', undefined);
 */
function rollback(cache, key, entry, previous) {
  if (cache.get(key) !== entry) {
    return;
  }
  if (previous === undefined) {
    cache.delete(key);
  } else {
    cache.set(key, previous);
  }
}

/**
 * Forget everything published so far. Only used to isolate unit tests.
 * @returns {void}
 * @example
 * resetPublishedState();
 */
export function resetPublishedState() {
  lastPublishAt.clear();
  lastTransports.clear();
}
