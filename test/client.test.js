import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/tplink/client.js';
import { PLUG_SYSINFO } from './helpers/fakeTpLink.js';

// Stand-in for a `tplink-smarthome-api` Client: the wrapper takes one through
// its `{ client }` injection hook, so the driver itself is never touched.
function createFakeDriver({ sysInfo = PLUG_SYSINFO, failOnGetDevice } = {}) {
  const calls = { getDevice: [], setPowerState: [] };
  let current = sysInfo;

  return {
    calls,
    async getDevice({ host }) {
      calls.getDevice.push(host);
      if (failOnGetDevice) {
        throw failOnGetDevice;
      }
      return {
        async getSysInfo() {
          return current;
        },
        async setPowerState(on) {
          calls.setPowerState.push(on);
          current = { ...current, relay_state: on ? 1 : 0 };
        },
      };
    },
  };
}

test('getSysInfo reads the device at the given address', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  const sysInfo = await tpClient.getSysInfo('192.168.1.10');

  assert.equal(sysInfo.deviceId, PLUG_SYSINFO.deviceId);
  assert.deepEqual(driver.calls.getDevice, ['192.168.1.10']);
});

test('getSysInfo propagates an unreachable device', async () => {
  const driver = createFakeDriver({ failOnGetDevice: new Error('TCP Timeout after 2000ms') });
  const tpClient = createClient({ client: driver });

  await assert.rejects(() => tpClient.getSysInfo('192.168.1.10'), /TCP Timeout/);
});

test('setPowerState commands the device and returns the state read back', async () => {
  const driver = createFakeDriver({ sysInfo: { ...PLUG_SYSINFO, relay_state: 0 } });
  const tpClient = createClient({ client: driver });

  const sysInfo = await tpClient.setPowerState('192.168.1.10', true);

  assert.deepEqual(driver.calls.setPowerState, [true]);
  assert.equal(sysInfo.relay_state, 1); // read back, not the value we asked for
});

test('setPowerState coerces the requested power to a boolean for the driver', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  await tpClient.setPowerState('192.168.1.10', 0);

  assert.deepEqual(driver.calls.setPowerState, [false]);
});

test('setPowerState refuses to command an address held by another device', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  await assert.rejects(
    () => tpClient.setPowerState('192.168.1.10', true, { expectedDeviceId: 'SOMEONE_ELSE' }),
    /Another device now answers at 192\.168\.1\.10/,
  );
  assert.equal(driver.calls.setPowerState.length, 0);
});

test('setPowerState commands when the serial matches', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  await tpClient.setPowerState('192.168.1.10', true, { expectedDeviceId: PLUG_SYSINFO.deviceId });

  assert.deepEqual(driver.calls.setPowerState, [true]);
});
