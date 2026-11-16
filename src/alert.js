'use strict';
// A failing service must not stay silent: after N failed passes in a row, one message to a webhook
// (Slack incoming webhook or anything that accepts {"text": "..."}), then one message when it works again.
function createAlerter({ url = '', after = 3, fetchImpl = fetch, logger = console, name = 'sales-tracking-sheet' } = {}) {
  let failures = 0, alerted = false, lastError = '';
  async function send(text) {
    if (!url) return false;
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch (e) { logger.error('Alert failed', e.message.slice(0, 120)); return false; }
  }
  return {
    async fail(message) {
      failures += 1; lastError = message;
      if (failures >= after && !alerted) { alerted = true; await send(`${name}: ${failures} failed passes in a row. Last error: ${message}`); }
    },
    async ok() {
      if (alerted) await send(`${name}: working again after ${failures} failed passes.`);
      failures = 0; alerted = false; lastError = '';
    },
    status: () => ({ consecutiveFailures: failures, lastError, alerted }),
  };
}

module.exports = { createAlerter };
