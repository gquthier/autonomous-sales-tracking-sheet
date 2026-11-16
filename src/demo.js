'use strict';
// Demo without any key: a fictional agency that sells member acquisition to gyms.
// The real iClosed and Fathom clients read API-shaped JSON files (examples/demo), the CRM is a JSON export,
// the sheet lives in memory. Three passes: bookings, then (after the closer typed two values) outcomes, then nothing.
const fs = require('node:fs');
const path = require('node:path');
const { mergeSettings, configFromEnv, ROOT } = require('./config');
const { createMemorySheets } = require('./memory-sheets');
const { build, runOnce } = require('./run');
const { createCrm } = require('./crm');
const { fromSerial } = require('./dry-run');

const DEMO = path.join(ROOT, 'examples', 'demo');
const NOW = new Date('2026-03-12T18:00:00Z').getTime();
const HEADER = ['', 'Date', 'Name', 'Source', 'Booked', 'Outcome', 'Revenue', 'Cash', 'Offer', 'My Emotions', 'Objection', 'Call Summary', 'Video Call Recording Link'];
const SOURCE_LIST = { condition: { type: 'ONE_OF_LIST', values: ['Facebook', 'Email', 'Linkedin', 'Referral', ''].map(v => ({ userEnteredValue: v })) }, showCustomUi: true };

const readJson = f => JSON.parse(fs.readFileSync(path.join(DEMO, f), 'utf8'));

// Serves the demo files at the real API addresses.
function demoFetch(url) {
  const u = new URL(url);
  const json = body => Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.hostname === 'public.api.iclosed.io' && u.pathname.endsWith('/eventCalls')) {
    const ids = (u.searchParams.get('eventIds') || '').split(',').filter(Boolean);
    const rows = readJson('iclosed-event-calls.json').data.eventCalls.filter(r => !ids.length || ids.includes(String(r.eventId)));
    return json({ data: { eventCalls: rows } });
  }
  if (u.hostname === 'api.fathom.ai') {
    const withVoices = u.searchParams.get('include_transcript') === 'true';
    const items = readJson('fathom-meetings.json').items.map(m => (withVoices ? m : { ...m, transcript: undefined }));
    return json({ items, next_cursor: null });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => 'not found' });
}

function demoSheet() {
  const month = title => ({
    title,
    grid: [[title, 'Kinetic : appels de vente'], [], ['', 'Bookings', '=COUNTA(C6:C)'], [], HEADER.slice()],
    validations: { 3: SOURCE_LIST },
  });
  return createMemorySheets(['Dash', month('Mar'), month('Apr')]);
}

function demoConfig(extraEnv = {}) {
  const settings = mergeSettings(JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'config.example.json'), 'utf8')));
  return configFromEnv({
    SPREADSHEET_ID: 'demo', ICLOSED_API_KEY: 'demo', ICLOSED_EVENT_IDS: '1001,1002,1003', FATHOM_API_KEYS: 'demo',
    SYNC_SINCE: '2026-03-01', ABSENT_IF_NO_RECORDING_FROM: '2026-03-01',
    CRM_ADAPTER: 'json', CRM_JSON_FILE: path.join(DEMO, 'crm-leads.json'),
    ...extraEnv,
  }, settings);
}

function table(memory, tab) {
  const s = memory.tab(tab);
  const head = s.grid[4];
  const col = name => head.indexOf(name);
  const pick = ['Date', 'Name', 'Source', 'Outcome', 'Revenue', 'Cash', 'Video Call Recording Link'];
  const rows = s.grid.slice(5).filter(r => r && r.some(v => v !== '' && v !== undefined)).map(r => pick.map(h => {
    const v = r[col(h)] ?? '';
    if (h === 'Date' && typeof v === 'number') return fromSerial(v);
    if (h === 'Video Call Recording Link') return v ? 'yes' : '';
    return String(v);
  }));
  const all = [pick.map(h => (h === 'Video Call Recording Link' ? 'Recording' : h)), ...rows];
  const widths = all[0].map((_, i) => Math.max(...all.map(r => r[i].length)));
  return all.map(r => r.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

async function runDemo({ print = console.log } = {}) {
  const memory = demoSheet();
  const config = demoConfig();
  const quiet = { log() {}, warn() {}, error() {} };
  const { sync } = build(config, memory, { logger: quiet, now: () => new Date(NOW) });
  const crm = createCrm(config.crm, config.settings);
  const opts = { config, sync, crm, fetchImpl: demoFetch, now: () => NOW, logger: quiet };

  const state = { lastOutcomes: NOW }; // first pass: bookings and recording links only
  const pass1 = await runOnce({ ...opts, state });
  print('Pass 1, bookings and recording links:', JSON.stringify(pass1));

  // Between two passes, the closer types two outcomes by hand.
  const mar = memory.tab('Mar'), head = mar.grid[4], at = name => mar.grid.findIndex(r => r && r[head.indexOf('Name')] === name);
  mar.grid[at('Maxime Lefevre')][head.indexOf('Outcome')] = 'No-Show'; // the recording says otherwise
  mar.grid[at('Chloe Blanc')][head.indexOf('Outcome')] = "Offer & Didn't Buy"; // legit, nothing in the CRM yet

  state.lastOutcomes = 0;
  const pass2 = await runOnce({ ...opts, state });
  print('Pass 2, outcomes:', JSON.stringify({ outcomes: pass2.outcomes, cleared: pass2.cleared, closer: pass2.closer, conflicts: pass2.conflicts.length }));
  for (const c of pass2.conflicts) print(`  check ${c.tab} row ${c.row}: ${c.why} (kept as typed)`);

  state.lastOutcomes = 0;
  const pass3 = await runOnce({ ...opts, state });
  print('Pass 3, same data again:', JSON.stringify({ added: pass3.added, linked: pass3.linked, outcomes: pass3.outcomes, cleared: pass3.cleared }));

  print('\nTab Mar after the passes (Paris time, demo clock 12/03/26 19:00):\n');
  print(table(memory, 'Mar'));
  print('\nTab Apr:\n');
  print(table(memory, 'Apr'));
  print(`\nColumns added on the right of Mar: ${memory.tab('Mar').grid[4].slice(HEADER.length).join(', ')}`);
  print(`Source dropdown of Mar: ${memory.tab('Mar').validations[3].condition.values.map(v => v.userEnteredValue).filter(Boolean).join(', ')}`);
  return { memory, pass1, pass2, pass3 };
}

module.exports = { runDemo, demoFetch, demoSheet, demoConfig, NOW };
