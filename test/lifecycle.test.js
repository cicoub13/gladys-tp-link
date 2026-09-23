import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectAndStayAlive } from '../src/lifecycle.js';

function createRecordingLogger() {
  const errors = [];
  return { errors, error: (...args) => errors.push(args) };
}

test('connectAndStayAlive logs a failed initial connection instead of exiting', async () => {
  // connect() rejects when Gladys refuses the token on the first attempt,
  // which the SDK documents as possibly transient (Gladys still booting) while
  // it keeps reconnecting: exiting here would kill that retry loop.
  const logger = createRecordingLogger();
  const exits = [];
  const refusal = new Error('GladysIntegration: authentication refused by Gladys (close code 4000)');
  const gladys = { connect: async () => Promise.reject(refusal) };

  const realExit = process.exit;
  process.exit = (code) => exits.push(code);
  try {
    await connectAndStayAlive(gladys, { logger });
  } finally {
    process.exit = realExit;
  }

  assert.deepEqual(exits, []);
  assert.equal(logger.errors.length, 1);
  assert.match(logger.errors[0][0], /Initial connection failed/);
  assert.equal(logger.errors[0][1], refusal);
});

test('connectAndStayAlive resolves quietly on a successful connection', async () => {
  const logger = createRecordingLogger();

  await connectAndStayAlive({ connect: async () => {} }, { logger });

  assert.equal(logger.errors.length, 0);
});
