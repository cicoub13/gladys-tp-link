import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../src/poller.js';
import { handlePoll } from '../src/poll.js';
import { buildDevice, buildOutletDevices } from '../src/tplink/model.js';
import { createClient } from '../src/tplink/client.js';
import { TRANSPORTS } from '../src/constants.js';
import { resetPublishedState } from '../src/statePublisher.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createFakeTpLink, PLUG_SYSINFO, BULB_SYSINFO, POWER_STRIP_SYSINFO } from './helpers/fakeTpLink.js';

// setImmediate is not mocked (only setInterval is): it runs once every pending
// promise callback has, so a poll run that only awaits fakes has settled.
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Records the polled external ids; `byId` can make a device fail or hang.
function createRecorder(devices, byId = {}) {
  const polled = [];
  const poller = createPoller({
    listDevices: () => devices,
    pollDevice: async (device) => {
      polled.push(device.external_id);
      return byId[device.external_id]?.();
    },
  });
  return { poller, polled };
}

beforeEach(() => resetPublishedState());

test('the poller refreshes every created device right away, then at each interval', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const gladys = createFakeGladys();
  const plug = buildDevice(gladys, PLUG_SYSINFO, '192.168.1.10').device;
  const bulb = buildDevice(gladys, BULB_SYSINFO, '192.168.1.11').device;
  gladys.devices = [plug, bulb];
  const byHost = {
    '192.168.1.10': { ...PLUG_SYSINFO, relay_state: 1 },
    '192.168.1.11': { ...BULB_SYSINFO, light_state: { on_off: 0 } },
  };
  const tpClient = createFakeTpLink({ byHost });
  const poller = createPoller({
    listDevices: () => gladys.devices,
    pollDevice: (device) => handlePoll(gladys, tpClient, device),
  });

  await poller.start(30);
  assert.deepEqual(
    gladys.fake.states.map((s) => [s.device_feature_external_id, s.state]),
    [
      [plug.features[0].external_id, 1],
      [bulb.features[0].external_id, 0],
    ],
  );

  // The plug is switched by hand: nothing changes until the next interval.
  byHost['192.168.1.10'] = { ...PLUG_SYSINFO, relay_state: 0 };
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(gladys.fake.states.length, 2);

  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(gladys.fake.states.at(-1), { device_feature_external_id: plug.features[0].external_id, state: 0 });
  poller.stop();
});

test('the poller reads the device list at each run, so a device created later is polled', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const devices = [{ external_id: 'a' }];
  const { poller, polled } = createRecorder(devices);

  await poller.start(10);
  devices.push({ external_id: 'b' });
  t.mock.timers.tick(10_000);
  await flush();

  assert.deepEqual(polled, ['a', 'a', 'b']);
  poller.stop();
});

test('update re-arms the poller with the new interval', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { poller, polled } = createRecorder([{ external_id: 'a' }]);

  await poller.start(60);
  await poller.update(10);
  assert.equal(polled.length, 2); // re-armed loops poll right away

  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(polled.length, 3);

  // The old 60 s timer is gone: 60 s in all is 6 runs of the new one, not 7.
  for (let i = 0; i < 5; i += 1) {
    t.mock.timers.tick(10_000);
    await flush();
  }
  assert.equal(polled.length, 8);
  poller.stop();
});

test('update is a no-op when the interval is unchanged or the poller is stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { poller, polled } = createRecorder([{ external_id: 'a' }]);

  await poller.update(10); // never started: must not start
  assert.equal(polled.length, 0);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(polled.length, 0);

  await poller.start(10);
  await poller.update(10); // same interval: no extra run, phase kept
  assert.equal(polled.length, 1);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(polled.length, 2);
  poller.stop();
});

test('the poller skips a tick while the previous run is still going', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release;
  const slow = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const { poller, polled } = createRecorder([{ external_id: 'slow' }], { slow });

  const firstRun = poller.start(1);
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(polled.length, 1); // the hanging run was never overlapped

  release();
  await firstRun;
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(polled.length, 2);
  poller.stop();
});

test('a failing device stops neither the others nor the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const failing = async () => {
    throw new Error('unreachable');
  };
  const { poller, polled } = createRecorder([{ external_id: 'bad' }, { external_id: 'good' }], { bad: failing });

  await poller.start(10); // resolves despite the failure
  assert.deepEqual(polled, ['bad', 'good']);

  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(polled, ['bad', 'good', 'bad', 'good']);
  poller.stop();
});

test('a failure listing the devices does not break the loop either', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const poller = createPoller({
    listDevices: () => {
      calls += 1;
      throw new Error('boom');
    },
    pollDevice: async () => {},
  });

  await poller.start(10); // must not reject
  t.mock.timers.tick(10_000);
  await flush();

  assert.equal(calls, 2);
  poller.stop();
});

test('stop leaves no timer running', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { poller, polled } = createRecorder([{ external_id: 'a' }]);

  await poller.start(1);
  poller.stop();
  t.mock.timers.tick(60_000);
  await flush();

  assert.equal(polled.length, 1);
  poller.stop(); // idempotent
});

// --- strip outlets ----------------------------------------------------------
// The real client wrapper around the fake strip: the shared read under test
// lives in the wrapper, and the fake counts the requests that reach the strip.

const STRIP_HOST = '192.168.1.13';

function stripPoller(devices, byHost) {
  const gladys = createFakeGladys();
  const strip = createFakeTpLink({ byHost });
  const tpClient = createClient({ client: strip });
  const poller = createPoller({
    listDevices: () => devices,
    pollDevice: (device) => handlePoll(gladys, tpClient, device),
  });
  return { gladys, strip, poller };
}

const stateOf = (gladys, device) => gladys.fake.lastState(device.features[0].external_id);

test('each refresh reads a strip once and publishes each created outlet on its own', async (t) => {
  // FR-008, SC-003, SC-004.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const outlets = buildOutletDevices(createFakeGladys(), POWER_STRIP_SYSINFO, STRIP_HOST);
  const byHost = { [STRIP_HOST]: POWER_STRIP_SYSINFO };
  const { gladys, strip, poller } = stripPoller(outlets, byHost);

  await poller.start(10);
  assert.equal(strip.sysInfoReads[STRIP_HOST], 1);
  assert.deepEqual(
    outlets.map((o) => stateOf(gladys, o)),
    [1, 0, 1],
  );

  // Outlet 3 is switched off from the Kasa app.
  byHost[STRIP_HOST] = {
    ...POWER_STRIP_SYSINFO,
    children: POWER_STRIP_SYSINFO.children.map((c, i) => (i === 2 ? { ...c, state: 0 } : c)),
  };
  const published = gladys.fake.states.length;
  t.mock.timers.tick(10_000);
  await flush();

  assert.equal(strip.sysInfoReads[STRIP_HOST], 2);
  assert.deepEqual(gladys.fake.states.slice(published), [
    { device_feature_external_id: outlets[2].features[0].external_id, state: 0 },
  ]);
  poller.stop();
});

test('only the created outlets of a strip are published', async () => {
  const [, tv] = buildOutletDevices(createFakeGladys(), POWER_STRIP_SYSINFO, STRIP_HOST);
  const { gladys, poller } = stripPoller([tv], { [STRIP_HOST]: POWER_STRIP_SYSINFO });

  await poller.start(10);
  poller.stop();

  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: tv.features[0].external_id, state: 0 }]);
});

test('an outlet the strip no longer reports publishes nothing and breaks nothing', async () => {
  const [lamp, tv] = buildOutletDevices(createFakeGladys(), POWER_STRIP_SYSINFO, STRIP_HOST);
  const without = { ...POWER_STRIP_SYSINFO, children: POWER_STRIP_SYSINFO.children.slice(1) };
  const { gladys, poller } = stripPoller([lamp, tv], { [STRIP_HOST]: without });

  await poller.start(10);
  poller.stop();

  assert.equal(stateOf(gladys, lamp), undefined);
  assert.equal(stateOf(gladys, tv), 0);
});

test('a strip that stops answering flags every outlet unreachable, then reachable again', async (t) => {
  // FR-009.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const outlets = buildOutletDevices(createFakeGladys(), POWER_STRIP_SYSINFO, STRIP_HOST);
  const byHost = {};
  const { gladys, poller } = stripPoller(outlets, byHost);
  const transportOf = (o) =>
    gladys.fake.transports.findLast((tr) => tr.device_external_id === o.external_id)?.transport;

  await poller.start(10);
  assert.deepEqual(outlets.map(transportOf), [TRANSPORTS.UNREACHABLE, TRANSPORTS.UNREACHABLE, TRANSPORTS.UNREACHABLE]);

  byHost[STRIP_HOST] = POWER_STRIP_SYSINFO;
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(outlets.map(transportOf), [TRANSPORTS.LOCAL, TRANSPORTS.LOCAL, TRANSPORTS.LOCAL]);
  poller.stop();
});
