// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// Reproduces only the surface the integration relies on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - scanNetwork(type, options)     -> injected raw scan replies, or throws
//   - publishState / publishStates   -> recorded for assertions
//   - publishDiscoveredDevices        -> recorded, or throws
//   - publishTransports               -> recorded for assertions
//   - getDevices                      -> returns the injected devices
//   - setConnectionStatus             -> recorded for assertions
// -----------------------------------------------------------------------------

export function createFakeGladys({ devices = [], scanReplies = [], scanError, publishError } = {}) {
  const published = [];
  const discovered = [];
  const connectionStatuses = [];
  const scanCalls = [];
  const transports = [];

  return {
    devices,
    published,
    discovered,
    connectionStatuses,
    scanCalls,
    transports,

    async scanNetwork(type, options) {
      scanCalls.push({ type, options });
      if (scanError) {
        throw scanError;
      }
      return scanReplies;
    },

    async publishTransports(entries) {
      transports.push(...entries);
      return { success: true };
    },

    externalIds(type, platformId) {
      const device = `ext:test:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
      return { success: true };
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
      return { success: true };
    },

    async publishDiscoveredDevices(list) {
      if (publishError) {
        throw publishError;
      }
      discovered.push(...list);
      return { success: true, count: list.length };
    },

    async getDevices() {
      // Read the live property so a test can reassign `gladys.devices`.
      return this.devices;
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
      return { success: true };
    },
  };
}
