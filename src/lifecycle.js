// -----------------------------------------------------------------------------
// Process lifecycle helpers, kept out of index.js so they can be unit-tested
// (index.js instantiates the SDK on import).
// -----------------------------------------------------------------------------

/**
 * Connect to Gladys, logging a failed initial connection instead of exiting.
 *
 * connect() only rejects when Gladys refuses the token on the first attempt,
 * and the SDK documents that refusal as possibly transient (Gladys still
 * booting after a host reboot) while it keeps its reconnect loop armed for
 * life. Exiting would kill the very retry that recovers.
 * @param {object} gladys - The GladysIntegration SDK instance.
 * @param {object} deps - Dependencies.
 * @param {object} deps.logger - Logger with an error() method.
 * @returns {Promise<void>} Resolves once connected, or once the failure is logged.
 * @example
 * connectAndStayAlive(gladys, { logger });
 */
export async function connectAndStayAlive(gladys, { logger }) {
  try {
    await gladys.connect();
  } catch (err) {
    logger.error('Initial connection failed, the SDK keeps retrying in the background', err);
  }
}

/**
 * Log an unhandled promise rejection with its reason, then exit so the Gladys
 * supervisor restarts the integration: nothing is known to reject unhandled,
 * so one that does leaves the process in an unknown state.
 * @param {object} deps - Dependencies.
 * @param {object} deps.logger - Logger with an error() method.
 * @param {EventEmitter} [deps.target] - The process (injected for tests).
 * @param {Function} [deps.exit] - process.exit (injected for tests).
 * @returns {void}
 * @example
 * exitOnUnhandledRejection({ logger });
 */
export function exitOnUnhandledRejection({ logger, target = process, exit = (code) => process.exit(code) }) {
  target.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection, exiting so the integration is restarted', reason);
    exit(1);
  });
}
