// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the TP-Link client wrapper (src/tplink/client.js).
//
//   - getSysInfo(host)       -> returns the sysinfo mapped to that host, or throws;
//                               counted per host in `sysInfoReads`
//   - setPowerState(host,on) -> records the command; with a `childId`, switches
//                               only that outlet of a strip, and keeps it;
//                               refuses an outlet the strip does not report
//
// Also provides discoveryReply(): a real encrypted `udp-active-broadcast` scan
// result for a sysinfo, so discovery tests exercise the actual codec.
// -----------------------------------------------------------------------------

import { encrypt } from 'tplink-smarthome-crypto';
import { assertExpectedDevice, assertOutletPresent } from '../../src/tplink/model.js';

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
  const sysInfoReads = {};

  function read(host) {
    const sysInfo = byHost[host];
    if (!sysInfo) {
      // Shaped like the driver's own failure: multi-line, with the protocol
      // payload — exactly what must never reach the user (see src/errors.js).
      throw new Error(`TCP Timeout after 2000ms\n${host}:9999 {"system":{"get_sysinfo":{}}}`);
    }
    return sysInfo;
  }

  return {
    powerCommands,
    sysInfoReads,

    async getSysInfo(host) {
      sysInfoReads[host] = (sysInfoReads[host] || 0) + 1;
      return read(host);
    },

    async setPowerState(host, on, { expectedDeviceId, childId } = {}) {
      const sysInfo = read(host);
      assertExpectedDevice(sysInfo, expectedDeviceId, host);
      // Like the wrapper: an outlet the strip no longer reports is refused
      // before anything is sent (the driver would throw at that point).
      assertOutletPresent(sysInfo, childId, host);
      if (childId) {
        powerCommands.push({ host, on, childId });
        // Like the relay of a real strip: only the targeted outlet changes, and
        // it stays changed for the next read.
        byHost[host] = {
          ...sysInfo,
          children: sysInfo.children.map((child) => (child.id === childId ? { ...child, state: on ? 1 : 0 } : child)),
        };
        return byHost[host];
      }
      powerCommands.push({ host, on });
      // The real wrapper reads the state back after commanding it.
      return sysInfo.light_state
        ? { ...sysInfo, light_state: { ...sysInfo.light_state, on_off: on ? 1 : 0 } }
        : { ...sysInfo, relay_state: on ? 1 : 0 };
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

// Multi-outlet strip: announced as a plug type, but its state lives in
// `children[]`, one entry per outlet. The third outlet has no name set.
export const POWER_STRIP_SYSINFO = {
  deviceId: 'STRIP001',
  alias: 'Desk strip',
  model: 'HS300(US)',
  type: 'IOT.SMARTPLUGSWITCH',
  children: [
    { id: 'STRIP00100', alias: 'Lamp', state: 1 },
    { id: 'STRIP00101', alias: 'TV', state: 0 },
    { id: 'STRIP00102', alias: '', state: 1 },
  ],
};
