// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the TP-Link client wrapper (src/tplink/client.js).
//
//   - getSysInfo(host)       -> returns the sysinfo mapped to that host, or throws
//   - setPowerState(host,on) -> records the command
// -----------------------------------------------------------------------------

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
