import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tplinkSmarthomeApi from 'tplink-smarthome-api';
import { encryptWithHeader, decrypt } from 'tplink-smarthome-crypto';
import { createClient } from '../src/tplink/client.js';
import { PLUG_SYSINFO } from './helpers/fakeTpLink.js';

// Stand-in for a `tplink-smarthome-api` Client: the wrapper takes one through
// its `{ client }` injection hook, so the driver itself is never touched.
//
// It models what each driver call costs on the network, because that is what
// the Gladys ack window (5s) is spent on: every entry of `sends` is one TCP
// round-trip to the device. `getDevice()` only costs one when it is not handed
// a sysinfo; `latencyMs` advances the fake clock on each round-trip.
function createFakeDriver({ sysInfo = PLUG_SYSINFO, failOnGetSysInfo, latencyMs = 0 } = {}) {
  const sends = [];
  const clock = { now: 0 };
  let current = sysInfo;

  function send(op, host, sendOptions) {
    sends.push({ op, host, timeout: sendOptions?.timeout, startedAt: clock.now });
    clock.now += latencyMs;
  }

  return {
    sends,
    clock,
    async getSysInfo(host, port, sendOptions) {
      send('get_sysinfo', host, sendOptions);
      if (failOnGetSysInfo) {
        throw failOnGetSysInfo;
      }
      return current;
    },
    async getDevice({ host, sysInfo: known }, sendOptions) {
      if (!known) {
        send('get_sysinfo', host, sendOptions);
      }
      return {
        async getSysInfo(options) {
          send('get_sysinfo', host, options);
          return current;
        },
        async setPowerState(on, options) {
          send('set_power', host, options);
          current = { ...current, relay_state: on ? 1 : 0 };
        },
      };
    },
  };
}

test('getSysInfo reads the device at the given address in a single round-trip', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  const sysInfo = await tpClient.getSysInfo('192.168.1.10');

  assert.equal(sysInfo.deviceId, PLUG_SYSINFO.deviceId);
  assert.deepEqual(
    driver.sends.map((s) => [s.op, s.host]),
    [['get_sysinfo', '192.168.1.10']],
  );
});

test('getSysInfo propagates an unreachable device', async () => {
  const driver = createFakeDriver({ failOnGetSysInfo: new Error('TCP Timeout after 2000ms') });
  const tpClient = createClient({ client: driver });

  await assert.rejects(() => tpClient.getSysInfo('192.168.1.10'), /TCP Timeout/);
});

test('setPowerState commands the device and returns the state read back', async () => {
  const driver = createFakeDriver({ sysInfo: { ...PLUG_SYSINFO, relay_state: 0 } });
  const tpClient = createClient({ client: driver });

  const sysInfo = await tpClient.setPowerState('192.168.1.10', true);

  assert.equal(sysInfo.relay_state, 1); // read back, not the value we asked for
});

test('setPowerState costs three round-trips: identity check, command, read-back', async () => {
  const driver = createFakeDriver({ sysInfo: { ...PLUG_SYSINFO, relay_state: 0 } });
  const tpClient = createClient({ client: driver, now: () => driver.clock.now });

  await tpClient.setPowerState('192.168.1.10', true, { expectedDeviceId: PLUG_SYSINFO.deviceId });

  assert.deepEqual(
    driver.sends.map((s) => s.op),
    ['get_sysinfo', 'set_power', 'get_sysinfo'],
  );
});

test('setPowerState keeps all its round-trips within the Gladys ack window', async () => {
  // A device answering just under the per-request timeout on every
  // round-trip: the command must still be answered well within 5s.
  const driver = createFakeDriver({ sysInfo: { ...PLUG_SYSINFO, relay_state: 0 }, latencyMs: 1900 });
  const tpClient = createClient({ client: driver, now: () => driver.clock.now });

  await tpClient.setPowerState('192.168.1.10', true);

  // Every round-trip is bounded by what is left of the command budget: even
  // one running to its timeout ends by 4s, leaving room under the 5s window
  // for the Gladys calls around it.
  for (const { op, timeout, startedAt } of driver.sends) {
    assert.ok(timeout > 0 && timeout <= 2000, `${op} timeout ${timeout}`);
    assert.ok(startedAt + timeout <= 4000, `${op} may end at ${startedAt + timeout}ms`);
  }
});

test('setPowerState returns null when there is no time left to read the state back', async () => {
  // The command was applied: running out of budget for the read-back must not
  // turn it into a failure (the caller falls back to the requested value).
  const driver = createFakeDriver({ sysInfo: { ...PLUG_SYSINFO, relay_state: 0 }, latencyMs: 2000 });
  const tpClient = createClient({ client: driver, now: () => driver.clock.now });

  assert.equal(await tpClient.setPowerState('192.168.1.10', true), null);
  assert.deepEqual(
    driver.sends.map((s) => s.op),
    ['get_sysinfo', 'set_power'],
  );
});

test('setPowerState coerces the requested power to a boolean for the driver', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  const sysInfo = await tpClient.setPowerState('192.168.1.10', 0);

  assert.equal(sysInfo.relay_state, 0);
});

test('setPowerState refuses to command an address held by another device', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  await assert.rejects(
    () => tpClient.setPowerState('192.168.1.10', true, { expectedDeviceId: 'SOMEONE_ELSE' }),
    /Another device now answers at 192\.168\.1\.10/,
  );
  assert.deepEqual(
    driver.sends.map((s) => s.op),
    ['get_sysinfo'],
  );
});

test('setPowerState commands when the serial matches', async () => {
  const driver = createFakeDriver();
  const tpClient = createClient({ client: driver });

  await tpClient.setPowerState('192.168.1.10', true, { expectedDeviceId: PLUG_SYSINFO.deviceId });

  assert.ok(driver.sends.some((s) => s.op === 'set_power'));
});

// --- Against the real driver ------------------------------------------------
// The fake above encodes what each driver call costs; this checks that model
// against the real `tplink-smarthome-api`, talking to a fake Kasa device over
// TCP on localhost. Each accepted connection is one round-trip.

// A sysinfo complete enough for the driver's own plug detection.
const FULL_PLUG_SYSINFO = {
  ...PLUG_SYSINFO,
  relay_state: 0,
  sw_ver: '1.0.0',
  hw_ver: '1.0',
  mac: '50:C7:BF:00:00:01',
  feature: 'TIM',
  err_code: 0,
};

async function startFakeKasaDevice() {
  const state = { sysInfo: { ...FULL_PLUG_SYSINFO }, connections: 0 };
  const server = net.createServer((socket) => {
    state.connections += 1;
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4 || buffer.length - 4 < buffer.readUInt32BE(0)) {
        return;
      }
      const request = JSON.parse(decrypt(buffer.subarray(4)).toString());
      let response;
      if (request.system?.set_relay_state) {
        state.sysInfo.relay_state = request.system.set_relay_state.state;
        response = { system: { set_relay_state: { err_code: 0 } } };
      } else {
        response = { system: { get_sysinfo: state.sysInfo } };
      }
      socket.end(encryptWithHeader(JSON.stringify(response)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { state, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

// The real driver, only redirected to the fake device's port.
function realDriverOnPort(port) {
  const real = new tplinkSmarthomeApi.Client({ defaultSendOptions: { timeout: 2000 } });
  return {
    getSysInfo: (host, _port, sendOptions) => real.getSysInfo(host, port, sendOptions),
    getDevice: (options, sendOptions) => real.getDevice({ ...options, port }, sendOptions),
  };
}

test('with the real driver, a poll costs one round-trip and a command three', async () => {
  const device = await startFakeKasaDevice();
  try {
    const tpClient = createClient({ client: realDriverOnPort(device.port) });

    await tpClient.getSysInfo('127.0.0.1');
    assert.equal(device.state.connections, 1);

    device.state.connections = 0;
    const sysInfo = await tpClient.setPowerState('127.0.0.1', true, { expectedDeviceId: PLUG_SYSINFO.deviceId });
    assert.equal(device.state.connections, 3);
    assert.equal(sysInfo.relay_state, 1);
  } finally {
    await device.close();
  }
});
