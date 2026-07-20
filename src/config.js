// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest. The
// SDK fetches it (`gladys.getConfig()`) and notifies changes
// (`gladys.onConfigUpdated()`); this module only provides defaults, coerces the
// types (a form may hand back strings) and derives the parsed IP list.
//
// Why an explicit IP list matters: the integration runs in a sandboxed bridge
// container, which can reach a LAN device by UNICAST (a known IP) but cannot
// receive the UDP broadcast responses TP-Link discovery relies on. So the
// reliable discovery path is the user-provided IP list; LAN broadcast is only a
// best-effort bonus for hosts that expose it to the container.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // Comma / space / newline separated list of TP-Link device IP addresses.
  device_ips: '',
  // How often Gladys polls each device, in seconds.
  poll_frequency: 60,
  // Attempt a LAN UDP-broadcast discovery in addition to the IP list.
  broadcast_discovery: true,
  // Duration of the best-effort broadcast discovery, in seconds.
  discovery_timeout: 5,
};

/**
 * Split a free-text list of IP addresses into a clean array.
 * @param {unknown} raw - The raw `device_ips` string.
 * @returns {string[]} The trimmed, non-empty, de-duplicated IPs.
 * @example
 * parseIpList('192.168.1.10, 192.168.1.11'); // ['192.168.1.10', '192.168.1.11']
 */
export function parseIpList(raw) {
  if (!raw) {
    return [];
  }
  const list = String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

/**
 * Merge the user configuration with the defaults and coerce the types.
 * @param {Record<string, unknown>} raw - Configuration returned by the SDK.
 * @returns {object} The normalized configuration (adds a parsed `ips` array).
 * @example
 * normalizeConfig({ poll_frequency: '30', device_ips: '192.168.1.10' });
 */
export function normalizeConfig(raw = {}) {
  const merged = { ...DEFAULT_CONFIG, ...raw };
  return {
    ...merged,
    device_ips: raw.device_ips ?? DEFAULT_CONFIG.device_ips,
    // Parsed IP list, ready to probe by unicast.
    ips: parseIpList(raw.device_ips),
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
    // Any value but an explicit false means "attempt broadcast discovery".
    broadcast_discovery: raw.broadcast_discovery !== false,
    discovery_timeout: Number(raw.discovery_timeout ?? DEFAULT_CONFIG.discovery_timeout),
  };
}
