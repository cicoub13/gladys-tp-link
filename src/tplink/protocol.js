// -----------------------------------------------------------------------------
// TP-Link Kasa discovery codec — the protocol half of the mediated
// `udp-active-broadcast` scan.
//
// The core runs on the host network and owns the *network position* (it emits
// the broadcast and relays the raw unicast replies); this module owns the
// *protocol knowledge*: it forges the encrypted discovery request the core
// broadcasts, and decodes the encrypted replies the devices send back.
//
// Kasa's classic LAN protocol is the XOR-autokey cipher of
// `tplink-smarthome-crypto` (the same the core service uses). On UDP (port
// 9999) there is no 4-byte length header — that is TCP-only — so we use the
// header-less `encrypt` / `decrypt`.
// -----------------------------------------------------------------------------

import { encrypt, decrypt } from 'tplink-smarthome-crypto';

// The classic Kasa discovery UDP port. Declared in the manifest
// `network_discovery` field so the core is allowed to broadcast on it.
export const DISCOVERY_PORT = 9999;

// The one request every Kasa device answers: read its system info.
const DISCOVERY_REQUEST = '{"system":{"get_sysinfo":{}}}';

/**
 * Forge the encrypted discovery request to broadcast (≤ 512 bytes, ~29 here).
 * @returns {Buffer} The XOR-encrypted `get_sysinfo` request, UDP (no header).
 * @example
 * gladys.scanNetwork('udp-active-broadcast', { port: DISCOVERY_PORT, payload: buildDiscoveryRequest() });
 */
export function buildDiscoveryRequest() {
  return encrypt(DISCOVERY_REQUEST);
}

/**
 * Decode one raw unicast reply into its TP-Link `sysinfo` object.
 * @param {string} payloadBase64 - The base64 payload from a scan result.
 * @returns {object|null} The `sysinfo`, or null when the reply is unreadable
 *   (not a Kasa device, truncated datagram, missing sysinfo…).
 * @example
 * parseDiscoveryReply(reply.payload_base64); // { deviceId, alias, type, ... }
 */
export function parseDiscoveryReply(payloadBase64) {
  try {
    const json = decrypt(Buffer.from(payloadBase64, 'base64')).toString();
    const sysInfo = JSON.parse(json)?.system?.get_sysinfo;
    return sysInfo && sysInfo.deviceId ? sysInfo : null;
  } catch {
    return null;
  }
}
