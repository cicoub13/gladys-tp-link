// -----------------------------------------------------------------------------
// Tiny helpers with no dependencies.
// -----------------------------------------------------------------------------

/**
 * Run an async function over a list with a bounded concurrency, so probing many
 * IP addresses stays fast without opening one socket per device at once.
 * @param {Array} items - The items to process.
 * @param {number} limit - Maximum number of concurrent executions.
 * @param {Function} fn - Async mapper `(item, index) => Promise<result>`.
 * @returns {Promise<Array>} Results in the original order.
 * @example
 * await mapLimit(ips, 5, (ip) => probe(ip));
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
