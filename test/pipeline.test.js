'use strict';
// End to end on the fictional demo data: real API clients on served JSON, CRM export, sheet in memory. No key, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runDemo, demoFetch, demoSheet, demoConfig, NOW } = require('../src/demo');
const { build, runOnce } = require('../src/run');
const { createCrm } = require('../src/crm');
const { cloneToMemory, snapshot, diff, formatDiff } = require('../src/dry-run');
const { runCheck } = require('../src/check');
const { createSheetsClient } = require('../src/google');
const crypto = require('node:crypto');

const quiet = { log() {}, warn() {}, error() {} };
const outcomes = memory => {
  const g = memory.tab('Mar').grid, head = g[4];
  return Object.fromEntries(g.slice(5).filter(r => r && r[2]).map(r => [r[head.indexOf('Name')], r[head.indexOf('Outcome')] || '']));
};

test('the demo fills bookings, links, outcomes and amounts, then a third pass changes nothing', async () => {
  const { memory, pass1, pass2, pass3 } = await runDemo({ print: () => {} });
  assert.equal(pass1.added, 13);
  assert.equal(pass1.linked, 9);
  assert.equal(pass1.outcomes, undefined); // outcomes not due yet
  assert.deepEqual(outcomes(memory), {
    'Julie Moreau': 'Full-Pay', // CRM: signed, paid in one go
    'Karim Benali': "Offer & Didn't Buy", // CRM: lost, budget
    'Maxime Lefevre': 'No-Show', // typed by the closer, contradicted by the recording, kept
    'Sophie Laurent': 'Bad Fit & No Offer', // CRM: lost, not the right client
    'Thomas Girard': 'No-Show', // closer alone in the recording
    'Nadia Haddad': 'No-Show', // no recording at all
    'Lucas Petit': 'No Deposit & Follow-Up', // CRM: second call (matched by phone), recording matched by the hour
    'Emma Roux': 'Split-Pay', // CRM: signed, 3 instalments
    'Chloe Blanc': "Offer & Didn't Buy", // typed by the closer, kept
    'Ines Garnier': 'Cancelled',
    'Lea Fontaine': '', // call ended less than 3 hours ago
    'Paul Mercier': '', // future call
  });
  assert.equal(pass2.outcomes, 7);
  assert.equal(pass2.closer, 2);
  assert.deepEqual(pass2.conflicts.map(c => c.typed), ['No-Show']);
  assert.deepEqual([pass3.added, pass3.linked, pass3.outcomes, pass3.cleared], [0, 0, 0, 0]);
  const g = memory.tab('Mar').grid, head = g[4], julie = g.find(r => r && r[2] === 'Julie Moreau');
  assert.equal(julie[head.indexOf('Revenue')], 2400);
  assert.equal(julie[head.indexOf('Cash')], 2400);
  assert.equal(julie[head.indexOf('Email')], 'julie@atlas-fitness.example');
  assert.equal(memory.tab('Apr').grid[5][2], 'Sarah Dumas');
  assert.equal(memory.tab('_sync').hidden, true);
});

test('a forgotten calendar: its bookings never reach the sheet', async () => {
  const memory = demoSheet();
  const config = demoConfig({ ICLOSED_EVENT_IDS: '1001,1002' });
  const { sync } = build(config, memory, { logger: quiet, now: () => new Date(NOW) });
  const res = await runOnce({ config, sync, crm: createCrm(config.crm, config.settings), fetchImpl: demoFetch, now: () => NOW, logger: quiet, state: {} });
  assert.equal(res.added, 10); // 3 bookings of calendar 1003 missing
});

test('without a recorder, the CRM alone still writes deal results, and a missing recording proves nothing', async () => {
  const memory = demoSheet();
  const config = demoConfig({ FATHOM_API_KEYS: '' });
  const { sync } = build(config, memory, { logger: quiet, now: () => new Date(NOW) });
  await runOnce({ config, sync, crm: createCrm(config.crm, config.settings), fetchImpl: demoFetch, now: () => NOW, logger: quiet, state: {} });
  const o = outcomes(memory);
  assert.equal(o['Julie Moreau'], 'Full-Pay');
  assert.equal(o['Karim Benali'], "Offer & Didn't Buy");
  assert.equal(o['Nadia Haddad'], ''); // no No-Show without a recorder
  assert.equal(o['Thomas Girard'], '');
});

test('a CRM that fails writes no outcome and retries next pass', async () => {
  const memory = demoSheet();
  const config = demoConfig();
  const { sync } = build(config, memory, { logger: quiet, now: () => new Date(NOW) });
  const crm = { enabled: true, name: 'broken', fetchLeads: async () => { throw new Error('CRM 503'); } };
  const state = {};
  const res = await runOnce({ config, sync, crm, fetchImpl: demoFetch, now: () => NOW, logger: quiet, state });
  assert.equal(res.crmError, 'CRM 503');
  assert.equal(state.lastOutcomes, 0);
  assert.ok(Object.values(outcomes(memory)).every(v => v === '' || v === 'Cancelled'));
});

test('dry run: a copy of the sheet gets the whole pass, the source sheet gets no write', async () => {
  const real = demoSheet(); // stands for the real Google sheet
  const config = demoConfig();
  const { memory } = await cloneToMemory(real, 'demo');
  const before = snapshot(memory);
  const { sync } = build(config, memory, { logger: quiet, now: () => new Date(NOW) });
  await runOnce({ config, sync, crm: createCrm(config.crm, config.settings), fetchImpl: demoFetch, now: () => NOW, logger: quiet, state: {} });
  assert.deepEqual(real.calls.map(c => c.method + (c.path.includes('developerMetadata') ? ' search' : '')), ['GET', 'GET', 'POST search']);
  const planned = await diff(before, memory, sync.layout);
  assert.equal(planned.rows.filter(r => r.tab === 'Mar' && r.row > 5).length, 12);
  assert.ok(planned.ledgerRows >= 13);
  const text = formatDiff(planned);
  assert.match(text, /Mar row 6: .*Date "09\/03\/26 10:00".*Name "Julie Moreau".*Outcome "Full-Pay"/);
  assert.match(text, /Mar row 5: Email "Email"/); // the information columns that would be added
});

test('dry run through the real Google client: Google only receives reads', async () => {
  const google = demoSheet(); // the "real" sheet, behind a fake Google HTTP API
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const sent = [];
  const fetchImpl = async (url, opts = {}) => {
    const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
    if (url.startsWith('https://oauth2.googleapis.com/')) return reply({ access_token: 't', expires_in: 3600 });
    const method = opts.method || 'GET';
    sent.push(method);
    return reply(await google.call(method, url.split('/v4/spreadsheets/')[1], opts.body ? JSON.parse(opts.body) : undefined));
  };
  const client = createSheetsClient({ client_email: 'robot@project.iam.example', private_key: privateKey }, { fetchImpl });
  const config = demoConfig();
  const { memory, title } = await cloneToMemory(client, 'demo');
  const { sync } = build(config, memory, { logger: quiet, now: () => new Date(NOW) });
  await runOnce({ config, sync, crm: createCrm(config.crm, config.settings), fetchImpl: demoFetch, now: () => NOW, logger: quiet, state: {} });
  assert.equal(title, 'Sales Tracking Sheet (memory)');
  assert.deepEqual(sent, ['GET', 'GET', 'POST']); // tabs, every value in one batch, metadata search
  assert.equal(google.tab('Mar').grid.length, 5); // header only, untouched
  assert.equal(memory.tab('Mar').grid.slice(5).filter(r => r && r[2]).length, 12); // the copy got the 12 March bookings
});

test('check: lists the calendars with bookings that nobody listed, and the CRM stages nobody mapped', async () => {
  const sheets = demoSheet();
  const config = demoConfig({ ICLOSED_EVENT_IDS: '1001,1002,2002' });
  const { sync } = build(config, sheets, { logger: quiet });
  config.settings.crm = { ...config.settings.crm, stages: { ...config.settings.crm.stages, followUp: ['Second appel'] } }; // "Relance" forgotten
  const crm = createCrm(config.crm, config.settings);
  const { report, ok } = await runCheck({ config, sheets, layout: sync.layout, crm, fetchImpl: demoFetch, now: () => NOW });
  const line = what => report.find(r => r.what === what);
  assert.equal(ok, true);
  assert.equal(line('Calendar 1003').level, 'warn');
  assert.match(line('Calendar 1003').detail, /NOT listed/);
  assert.equal(line('Calendar 1001').level, 'ok');
  assert.match(line('Calendar 2002').detail, /no booking/);
  assert.equal(line('Tab Mar').level, 'ok');
  assert.equal(line('Tab Apr').level, 'ok');
  assert.match(line('CRM stages not mapped').detail, /"relance" \(1\)/);
  assert.equal(line('Recorder account #1').level, 'ok');
});

test('check: an unshared sheet is an error that names the address to share with', async () => {
  const sheets = { email: 'robot@project.iam.example', call: async () => { throw new Error('Sheets 403: share the sheet with robot@project.iam.example as Editor (or check SPREADSHEET_ID)'); } };
  const config = demoConfig();
  const { report, ok } = await runCheck({ config, sheets, layout: async () => null, crm: null, fetchImpl: demoFetch, now: () => NOW });
  assert.equal(ok, false);
  assert.match(report.find(r => r.what === 'Sheet').detail, /share the sheet with robot@project\.iam\.example/);
});
