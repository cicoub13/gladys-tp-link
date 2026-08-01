// -----------------------------------------------------------------------------
// User-facing error messages.
//
// A command handler that throws is acked `success: false` with `error:
// e.message`, and Gladys shows that string to the user as-is. The driver's own
// messages are not fit for that — `tplink-smarthome-api` raises things like
//   TCP Timeout after 10000ms\n192.168.1.10:9999 {"system":{"set_relay_state"…
// (multi-line, with the protocol JSON). So driver errors are replaced by a
// short actionable sentence, while errors this integration raised on purpose —
// already written for the user, and flagged `userFacing` — are kept verbatim.
//
// Note: this ack channel carries a plain string, not the SDK's multi-language
// object, so these sentences cannot be translated. `setConnectionStatus` does
// take an { en, fr } object, and is used with one everywhere it applies.
// -----------------------------------------------------------------------------

/**
 * Return the error to surface to the user for a failed command.
 * @param {Error} err - The caught error.
 * @param {string} fallbackMessage - Message to use for a raw driver error.
 * @returns {Error} The error to re-throw.
 * @example
 * throw toUserFacingError(err, `Device unreachable at ${host}`);
 */
export function toUserFacingError(err, fallbackMessage) {
  if (err?.userFacing) {
    return err;
  }
  const userError = new Error(fallbackMessage);
  userError.userFacing = true;
  // Keep the driver error reachable for anything reading the chain.
  userError.cause = err;
  return userError;
}
