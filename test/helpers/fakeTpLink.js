// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the TP-Link client wrapper (src/tplink/client.js).
//
//   - getSysInfo(host)       -> returns the sysinfo mapped to that host, or throws
//   - setPowerState(host,on) -> records the command
//
// Also provides discoveryReply(): a real encrypted `udp-active-broadcast` scan
// result for a sysinfo, so discovery tests exercise the actual codec.
// -----------------------------------------------------------------------------

import { encrypt } from 'tplink-smarthome-crypto';

/**
 * Build a raw scan reply the way the core relays it, with a genuinely encrypted
 * Kasa payload — so parseDiscoveryReply() is exercised for real.
 * @param {string} sourceIp - The device IP the reply comes from.
 * @param {object} sysInfo - The TP-Link `sysinfo` to encode.
 * @returns {{ source_ip: string, source_port: number, payload_base64: string }}
 * @example
 * discoveryReply('192.168.1.10', PLUG_SYSINFO);
 */
export function discoveryReply(sourceIp, sysInfo) {
  const payload = encrypt(JSON.stringify({ system: { get_sysinfo: sysInfo } }));
  return { source_ip: sourceIp, source_port: 9999, payload_base64: payload.toString('base64') };
}

export function createFakeTpLink({ byHost = {} } = {}) {
  const powerCommands = [];

  return {
    powerCommands,

    async getSysInfo(host) {
      const sysInfo = byHost[host];
      if (!sysInfo) {
        throw new Error(`ECONNREFUSED ${host}`);
      }
      return sysInfo;
    },

    async setPowerState(host, on) {
      powerCommands.push({ host, on });
    },
  };
}

// Handy sysinfo fixtures matching real TP-Link Kasa responses.
export const PLUG_SYSINFO = {
  deviceId: 'PLUG0001',
  alias: 'Office plug',
  model: 'HS100(EU)',
  type: 'IOT.SMARTPLUGSWITCH',
  relay_state: 1,
};

export const BULB_SYSINFO = {
  deviceId: 'BULB0001',
  alias: 'Desk bulb',
  model: 'LB100(EU)',
  mic_type: 'IOT.SMARTBULB',
  light_state: { on_off: 0 },
};

export const UNKNOWN_SYSINFO = {
  deviceId: 'CAM0001',
  alias: 'Front camera',
  model: 'KC120(EU)',
  type: 'IOT.IPCAMERA',
};
