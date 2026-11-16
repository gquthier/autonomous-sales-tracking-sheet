'use strict';
// Long-running service: one pass every POLL_SECONDS, GET /health for the host and for you.
const http = require('node:http');
const { configFromEnv, missingForRealRun } = require('./config');
const { build, runOnce } = require('./run');
const { createCrm } = require('./crm');
const { createAlerter } = require('./alert');

// GET /health: 200 with the last pass. GET /health?strict=1: 503 while passes fail (for an uptime monitor).
function createServer({ status = {}, alerter = null }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/health') { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"status":"not_found"}'); }
    const health = alerter ? alerter.status() : { consecutiveFailures: 0 };
    const failing = health.consecutiveFailures > 0;
    res.writeHead(failing && url.searchParams.get('strict') ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: failing ? 'failing' : 'ok', ...status, ...health }));
  });
}

function start(env = process.env) {
  const config = configFromEnv(env);
  const missing = missingForRealRun(config);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}`);
  const { sync } = build(config);
  const crm = createCrm(config.crm, config.settings, { env });
  const alerter = createAlerter({ url: config.alertWebhookUrl, after: config.alertAfterFailures });
  const status = { recorderAccounts: config.fathomKeys.length, crm: crm.name, calendars: config.eventIds.length || 'all' };
  const state = {};
  createServer({ status, alerter }).listen(env.PORT || 3000, '0.0.0.0', () => console.log('sales-tracking-sheet ready'));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      status.lastRun = { at: new Date().toISOString(), ...(await runOnce({ config, sync, crm, state })) };
      await alerter.ok();
    } catch (e) {
      status.lastRun = { at: new Date().toISOString(), error: e.message.slice(0, 160) };
      console.error('Sync failed', e.message.slice(0, 200)); // no personal data in logs
      await alerter.fail(e.message.slice(0, 160));
    } finally { running = false; }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, config.pollSeconds * 1000);
}

if (require.main === module) start();

module.exports = { createServer, start };
