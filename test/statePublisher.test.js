import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  publishFeatureState,
  publishDeviceTransport,
  forgetDeviceTransport,
  resetPublishedState,
} from '../src/statePublisher.js';
import { TRANSPORTS } from '../src/constants.js';

const ids = createFakeGladys().externalIds('plug', 'P1');
const D1 = ids.device;
const F1 = ids.feature('on-off');
const F2 = createFakeGladys().externalIds('plug', 'P2').feature('on-off');

const publishedValues = (gladys) => gladys.fake.states.map((s) => s.state);

// Makes the next call of `method` fail like a rate-limited Gladys.
function failOnce(t, gladys, method) {
  t.mock.method(gladys, method).mock.mockImplementationOnce(async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'RATE_LIMIT_EXCEEDED');
  });
}

beforeEach(() => resetPublishedState());

test('publishFeatureState publishes a value it has never seen', async () => {
  const gladys = createFakeGladys();

  assert.equal(await publishFeatureState(gladys, F1, 1), true);
  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: F1, state: 1 }]);
});

test('publishFeatureState drops an unchanged value', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, F1, 1);
  assert.equal(await publishFeatureState(gladys, F1, 1), false);
  assert.equal(gladys.fake.states.length, 1);
});

test('publishFeatureState tracks each feature independently', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, F1, 1);
  await publishFeatureState(gladys, F2, 1);

  assert.equal(gladys.fake.states.length, 2);
});

test('publishFeatureState drops a read older than the last publish', async () => {
  // The setValue/poll race: a poll started before a command still carries the
  // pre-command state, and would visibly flip the switch back in the UI.
  const gladys = createFakeGladys();
  const staleReadAt = Date.now() - 5000;

  await publishFeatureState(gladys, F1, 1); // the command
  assert.equal(await publishFeatureState(gladys, F1, 0, staleReadAt), false);

  assert.deepEqual(publishedValues(gladys), [1]);
});

test('publishFeatureState accepts a read taken after the last publish', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, F1, 1);
  assert.equal(await publishFeatureState(gladys, F1, 0, Date.now() + 1000), true);
  assert.equal(gladys.fake.states.length, 2);
});

test('publishDeviceTransport publishes only on change', async () => {
  const gladys = createFakeGladys();

  assert.equal(await publishDeviceTransport(gladys, D1, TRANSPORTS.LOCAL), true);
  assert.equal(await publishDeviceTransport(gladys, D1, TRANSPORTS.LOCAL), false);
  assert.equal(await publishDeviceTransport(gladys, D1, TRANSPORTS.UNREACHABLE), true);

  assert.deepEqual(gladys.fake.transports, [
    { device_external_id: D1, transport: TRANSPORTS.LOCAL },
    { device_external_id: D1, transport: TRANSPORTS.UNREACHABLE },
  ]);
});

test('publishFeatureState publishes again after a failed publish of the same value', async (t) => {
  // A failed publish must not be remembered as published: otherwise every
  // later poll reading the same value is dropped as "unchanged", and Gladys
  // keeps showing the previous state until the device changes again.
  const gladys = createFakeGladys();
  failOnce(t, gladys, 'publishStates');

  await assert.rejects(() => publishFeatureState(gladys, F1, 1), { status: 429 });
  assert.equal(await publishFeatureState(gladys, F1, 1), true);

  assert.deepEqual(gladys.fake.states, [{ device_feature_external_id: F1, state: 1 }]);
});

test('publishFeatureState drops a read older than an unchanged value it confirmed', async (t) => {
  // A poll confirming the published value is skipped, but it still proves
  // what the device held at that time: a slower poll that started earlier
  // must not publish the older value it read.
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, F1, 1, 1000);
  t.mock.timers.tick(1000);
  assert.equal(await publishFeatureState(gladys, F1, 1, 2000), false); // unchanged
  assert.equal(await publishFeatureState(gladys, F1, 0, 1500), false); // read before the confirmation
  assert.equal(await publishFeatureState(gladys, F1, 0, 2000), true);

  assert.deepEqual(publishedValues(gladys), [1, 0]);
});

test('publishFeatureState still drops a stale read after a failed publish', async (t) => {
  // The command read 1 back from the device: a poll that started before it
  // read the pre-command 0, whether or not Gladys took the 1.
  const gladys = createFakeGladys();
  failOnce(t, gladys, 'publishStates');

  await assert.rejects(() => publishFeatureState(gladys, F1, 1), { status: 429 });
  assert.equal(await publishFeatureState(gladys, F1, 0, Date.now() - 5000), false);
  assert.equal(gladys.fake.states.length, 0);
});

test('publishFeatureState publishes the state of a deleted then re-created device again', async () => {
  // Gladys drops the states of a feature that does not exist: the value
  // published before the deletion is not shown on the re-created device.
  const gladys = createFakeGladys();
  const device = { name: 'Plug', external_id: D1, features: [{ external_id: F1 }] };

  assert.equal(await publishFeatureState(gladys, F1, 1), true);
  assert.equal(await publishFeatureState(gladys, F1, 1), false);
  await gladys.fake.deviceDeleted(device);
  await gladys.fake.deviceCreated(device);
  assert.equal(await publishFeatureState(gladys, F1, 1), true);

  assert.deepEqual(publishedValues(gladys), [1, 1]);
});

test('forgetDeviceTransport makes the next transport publish again', async () => {
  const gladys = createFakeGladys();

  await publishDeviceTransport(gladys, D1, TRANSPORTS.LOCAL);
  forgetDeviceTransport({ external_id: D1 });
  assert.equal(await publishDeviceTransport(gladys, D1, TRANSPORTS.LOCAL), true);

  assert.equal(gladys.fake.transports.length, 2);
});

test('publishDeviceTransport publishes again after a failed publish of the same transport', async (t) => {
  const gladys = createFakeGladys();
  failOnce(t, gladys, 'publishTransports');

  await assert.rejects(() => publishDeviceTransport(gladys, D1, TRANSPORTS.UNREACHABLE), { status: 429 });
  assert.equal(await publishDeviceTransport(gladys, D1, TRANSPORTS.UNREACHABLE), true);

  assert.deepEqual(gladys.fake.transports, [{ device_external_id: D1, transport: TRANSPORTS.UNREACHABLE }]);
});
