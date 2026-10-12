import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../src/poller.js';
import { handlePoll } from '../src/poll.js';
import { buildDevice } from '../src/tplink/model.js';
import { resetPublishedState } from '../src/statePublisher.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeTpLink, PLUG_SYSINFO, BULB_SYSINFO } from './helpers/fakeTpLink.js';

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
    gladys.published.map((p) => [p.featureExternalId, p.state]),
    [
      [plug.features[0].external_id, 1],
      [bulb.features[0].external_id, 0],
    ],
  );

  // The plug is switched by hand: nothing changes until the next interval.
  byHost['192.168.1.10'] = { ...PLUG_SYSINFO, relay_state: 0 };
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(gladys.published.length, 2);

  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(gladys.published.at(-1), { featureExternalId: plug.features[0].external_id, state: 0 });
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
