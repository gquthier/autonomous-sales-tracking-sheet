'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSheetsClient, credentialsFromEnv } = require('../src/google');
const { createAlerter } = require('../src/alert');
const { createServer } = require('../src/server');
const { configFromEnv, mergeSettings, missingForRealRun } = require('../src/config');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const credentials = { client_email: 'robot@project.iam.example', private_key: privateKey };
const reply = (status, body = {}) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

test('Sheets client: signs a token once, retries on 429, and names the account to share with on 403', async () => {
  const seen = [];
  let sheetCalls = 0;
  const fetchImpl = async (url, opts) => {
    seen.push(url);
    if (url.includes('oauth2')) { assert.match(String(opts.body), /assertion=/); return reply(200, { access_token: 'tok', expires_in: 3600 }); }
    sheetCalls += 1;
    if (sheetCalls === 1) return reply(429);
    if (sheetCalls === 2) return reply(200, { ok: 1 });
    return reply(403, { error: 'PERMISSION_DENIED' });
  };
  const client = createSheetsClient(credentials, { fetchImpl, wait: async () => {} });
  assert.deepEqual(await client.call('GET', 'S?fields=x'), { ok: 1 });
  await assert.rejects(client.call('GET', 'S?fields=x'), /share the sheet with robot@project\.iam\.example as Editor/);
  assert.equal(seen.filter(u => u.includes('oauth2')).length, 1);
});

test('the Google key comes from base64 or from a file path', () => {
  const b64 = Buffer.from(JSON.stringify(credentials)).toString('base64');
  assert.equal(credentialsFromEnv({ GOOGLE_SERVICE_ACCOUNT_B64: b64 }).client_email, 'robot@project.iam.example');
  assert.equal(credentialsFromEnv({ GOOGLE_SERVICE_ACCOUNT_FILE: '/k.json' }, () => JSON.stringify(credentials)).client_email, 'robot@project.iam.example');
  assert.equal(credentialsFromEnv({}), null);
});

test('alerts: one message after N failures in a row, one when it works again, nothing without a webhook', async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push(JSON.parse(opts.body).text); return reply(200); };
  const alerter = createAlerter({ url: 'https://hooks.example/x', after: 3, fetchImpl });
  for (let i = 0; i < 5; i++) await alerter.fail('Sheets 403: share the sheet');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /3 failed passes in a row.*Sheets 403/);
  assert.equal(alerter.status().consecutiveFailures, 5);
  await alerter.ok();
  assert.equal(sent.length, 2);
  assert.match(sent[1], /working again/);
  await alerter.ok();
  assert.equal(sent.length, 2);
  const silent = createAlerter({ fetchImpl: () => { throw new Error('must not be called'); } });
  await silent.fail('x'); await silent.fail('x'); await silent.fail('x');
});

test('health endpoint: ok, failing, and 503 in strict mode while failing', async () => {
  let failures = 0;
  const alerter = { status: () => ({ consecutiveFailures: failures, lastError: failures ? 'Sheets 403' : '' }) };
  const server = createServer({ status: { lastRun: { added: 1 } }, alerter }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
    failures = 2;
    res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'failing');
    res = await fetch(`${base}/health?strict=1`);
    assert.equal(res.status, 503);
    assert.equal((await fetch(`${base}/other`)).status, 404);
  } finally { server.close(); }
});

test('config: secrets from the environment, vocabulary from the settings file, nothing required for the demo', () => {
  const config = configFromEnv({ ICLOSED_EVENT_IDS: '1, 2 ,', FATHOM_API_KEYS: 'a,b', OUTCOME_WAIT_HOURS: '4' }, mergeSettings({ labels: { noShow: 'Absent' }, team: { firstNames: ['Camille'] } }));
  assert.deepEqual(config.eventIds, ['1', '2']);
  assert.deepEqual(config.fathomKeys, ['a', 'b']);
  assert.equal(config.outcomeWaitHours, 4);
  assert.equal(config.settings.labels.noShow, 'Absent');
  assert.equal(config.settings.labels.fullPay, 'Full-Pay');
  assert.deepEqual(config.settings.team, { emailDomains: [], firstNames: ['Camille'] });
  assert.equal(config.crm.adapter, 'none');
  assert.deepEqual(missingForRealRun(config), ['GOOGLE_SERVICE_ACCOUNT_B64 or GOOGLE_SERVICE_ACCOUNT_FILE', 'SPREADSHEET_ID', 'ICLOSED_API_KEY']);
});
