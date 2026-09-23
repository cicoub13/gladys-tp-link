import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { publishFeatureState, publishDeviceTransport, resetPublishedState } from '../src/statePublisher.js';
import { TRANSPORTS } from '../src/constants.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

beforeEach(() => resetPublishedState());

test('publishFeatureState publishes a value it has never seen', async () => {
  const gladys = createFakeGladys();

  assert.equal(await publishFeatureState(gladys, 'f1', 1), true);
  assert.deepEqual(gladys.published, [{ featureExternalId: 'f1', state: 1 }]);
});

test('publishFeatureState drops an unchanged value', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, 'f1', 1);
  assert.equal(await publishFeatureState(gladys, 'f1', 1), false);
  assert.equal(gladys.published.length, 1);
});

test('publishFeatureState tracks each feature independently', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, 'f1', 1);
  await publishFeatureState(gladys, 'f2', 1);

  assert.equal(gladys.published.length, 2);
});

test('publishFeatureState drops a read older than the last publish', async () => {
  // The setValue/poll race: a poll started before a command still carries the
  // pre-command state, and would visibly flip the switch back in the UI.
  const gladys = createFakeGladys();
  const staleReadAt = Date.now() - 5000;

  await publishFeatureState(gladys, 'f1', 1); // the command
  assert.equal(await publishFeatureState(gladys, 'f1', 0, staleReadAt), false);

  assert.deepEqual(
    gladys.published.map((p) => p.state),
    [1],
  );
});

test('publishFeatureState accepts a read taken after the last publish', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, 'f1', 1);
  assert.equal(await publishFeatureState(gladys, 'f1', 0, Date.now() + 1000), true);
  assert.equal(gladys.published.length, 2);
});

test('publishDeviceTransport publishes only on change', async () => {
  const gladys = createFakeGladys();

  assert.equal(await publishDeviceTransport(gladys, 'd1', TRANSPORTS.LOCAL), true);
  assert.equal(await publishDeviceTransport(gladys, 'd1', TRANSPORTS.LOCAL), false);
  assert.equal(await publishDeviceTransport(gladys, 'd1', TRANSPORTS.UNREACHABLE), true);

  assert.deepEqual(gladys.transports, [
    { external_id: 'd1', transport: TRANSPORTS.LOCAL },
    { external_id: 'd1', transport: TRANSPORTS.UNREACHABLE },
  ]);
});

test('publishFeatureState publishes again after a failed publish of the same value', async () => {
  // A failed publish must not be remembered as published: otherwise every
  // later poll reading the same value is dropped as "unchanged", and Gladys
  // keeps showing the previous state until the device changes again.
  const gladys = createFakeGladys();
  gladys.failNext('publishState');

  await assert.rejects(() => publishFeatureState(gladys, 'f1', 1), { status: 429 });
  assert.equal(await publishFeatureState(gladys, 'f1', 1), true);

  assert.deepEqual(gladys.published, [{ featureExternalId: 'f1', state: 1 }]);
});

test('publishFeatureState keeps the previous value as reference after a failed publish', async () => {
  const gladys = createFakeGladys();

  await publishFeatureState(gladys, 'f1', 0);
  gladys.failNext('publishState');
  await assert.rejects(() => publishFeatureState(gladys, 'f1', 1), { status: 429 });

  // 0 is still what Gladys holds: re-reading 0 needs no publish, 1 does.
  assert.equal(await publishFeatureState(gladys, 'f1', 0, Date.now() + 1000), false);
  assert.equal(await publishFeatureState(gladys, 'f1', 1, Date.now() + 1000), true);
});

test('publishDeviceTransport publishes again after a failed publish of the same transport', async () => {
  const gladys = createFakeGladys();
  gladys.failNext('publishTransports');

  await assert.rejects(() => publishDeviceTransport(gladys, 'd1', TRANSPORTS.UNREACHABLE), { status: 429 });
  assert.equal(await publishDeviceTransport(gladys, 'd1', TRANSPORTS.UNREACHABLE), true);

  assert.deepEqual(gladys.transports, [{ external_id: 'd1', transport: TRANSPORTS.UNREACHABLE }]);
});
