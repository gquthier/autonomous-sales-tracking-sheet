'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemorySheets } = require('../src/memory-sheets');
const { createSync } = require('../src/sync');
const { decideOutcome, decideAll, outsideVoices } = require('../src/outcome');

const H = 36e5;
const team = { emailDomains: ['kinetic-agence.example'], firstNames: ['Camille', 'Hugo'] };
const call = (over = {}) => ({ id: '100', start: '2026-03-13T09:00:00.000Z', name: 'Claire Dupont', email: 'claire@club-atlas.example', phone: '+33 6 00 00 00 01', cancelled: false, ...over });
const now = new Date('2026-03-13T09:00:00.000Z').getTime() + 4 * H;
const closer = { name: 'Camille Roche', email: 'camille@kinetic-agence.example', segments: 90 };
const came = { hostEmail: 'camille@kinetic-agence.example', hostName: 'Camille Roche', voices: [closer, { name: 'Claire Dupont', email: '', segments: 80 }] };
const alone = { hostEmail: 'camille@kinetic-agence.example', hostName: 'Camille Roche', voices: [{ ...closer, segments: 31 }] };
const lead = (over = {}) => ({ email: 'claire@club-atlas.example', phone: '+33 6 00 00 00 01', status: 'open', amount: null, split: false, ...over });
const decide = (over = {}) => decideOutcome({ call: call(), rec: null, lead: null, now, team, noRecordingFrom: '2026-03-10', ...over });

test('who spoke: the team (by domain or first name) does not count, the prospect does', () => {
  assert.equal(outsideVoices(came, team), 80);
  assert.equal(outsideVoices(alone, team), 0);
  assert.equal(outsideVoices({ hostEmail: 'camille@kinetic-agence.example', hostName: 'Camille Roche', voices: [{ name: 'Hugo Martin', email: '', segments: 40 }] }, team), 0);
});

test('recording: closer alone = No-Show; prospect spoke and nothing decided = left to the closer', () => {
  assert.deepEqual(decide({ rec: alone }), { outcome: 'No-Show', came: false });
  assert.deepEqual(decide({ rec: came }), { outcome: null, came: true });
  assert.deepEqual(decide({ rec: came, lead: lead() }), { outcome: null, came: true });
});

test('no recording = No-Show only from the configured date, and never too soon after the call', () => {
  assert.deepEqual(decide(), { outcome: 'No-Show', came: null });
  assert.deepEqual(decide({ noRecordingFrom: null }), { outcome: null, came: null });
  assert.deepEqual(decide({ call: call({ start: '2026-03-06T09:00:00.000Z' }) }), { outcome: null, came: null });
  assert.equal(decide({ now: now - 2 * H }), null);
  assert.equal(decide({ call: call({ cancelled: true }) }), null);
});

test('CRM decisions: lost, bad fit, follow-up, won, no-show', () => {
  assert.equal(decide({ rec: came, lead: lead({ status: 'lost' }) }).outcome, "Offer & Didn't Buy");
  assert.equal(decide({ rec: came, lead: lead({ status: 'bad_fit' }) }).outcome, 'Bad Fit & No Offer');
  assert.equal(decide({ rec: came, lead: lead({ status: 'follow_up' }) }).outcome, 'No Deposit & Follow-Up');
  assert.equal(decide({ lead: lead({ status: 'follow_up' }) }).outcome, 'No Deposit & Follow-Up'); // talked off the recorder
  assert.deepEqual(decide({ rec: came, lead: lead({ status: 'won', amount: 4500 }) }), { outcome: 'Full-Pay', revenue: 4500, came: true });
  assert.deepEqual(decide({ rec: came, lead: lead({ status: 'won', split: true }) }), { outcome: 'Split-Pay', revenue: null, came: true });
  assert.equal(decide({ rec: came, lead: lead({ status: 'no_show' }) }).outcome, 'No-Show');
  // Lost, but the closer was alone on the call: the prospect never came.
  assert.equal(decide({ rec: alone, lead: lead({ status: 'lost' }) }).outcome, 'No-Show');
});

test('labels follow the settings', () => {
  const labels = { noShow: 'Absent', lost: 'Perdu', badFit: 'Non qualifié', followUp: 'Relance', fullPay: 'Payé', splitPay: 'Payé en plusieurs fois' };
  assert.equal(decide({ rec: alone, labels }).outcome, 'Absent');
  assert.equal(decide({ rec: came, lead: lead({ status: 'won', split: true }), labels }).outcome, 'Payé en plusieurs fois');
});

test('the CRM card speaks only for the latest booking of the person, matched by e-mail or phone', () => {
  const first = call({ id: '1', start: '2026-03-10T09:00:00.000Z' }), second = call({ id: '2', start: '2026-03-12T09:00:00.000Z', email: '' });
  const picked = new Map([['2@2026-03-12T09:00:00.000Z', came]]);
  const out = decideAll({ calls: [first, second], picked, leads: [lead({ email: '', phone: '06 00 00 00 01', status: 'follow_up' })], now: new Date('2026-03-13T09:00:00Z').getTime(), team, noRecordingFrom: '2026-03-01' });
  assert.equal(out.get('1@2026-03-10T09:00:00.000Z').outcome, 'No-Show'); // no recording, older booking
  assert.equal(out.get('2@2026-03-12T09:00:00.000Z').outcome, 'No Deposit & Follow-Up');
});

// --- writing in the sheet ---
const HEADER = ['', 'Date', 'Name', 'Source', 'Booked', 'Outcome', 'Revenue', 'CashCollected', 'Offer', 'My Emotions', 'Objection', 'Call Summary', '', '', '', 'Video Call Recording Link', 'Email', 'Phone', 'Website', 'Meet Link', 'Form Answers'];
const quiet = { log() {}, warn() {}, error() {} };
async function sheetWith(calls) {
  const fake = createMemorySheets();
  fake.tab('Mar').grid[12] = HEADER.slice();
  const sync = createSync({ sheets: fake, spreadsheetId: 'S', logger: quiet });
  await sync.syncCalls(calls);
  return { fake, sync };
}
const k = c => `${c.id}@${c.start}`;
const said = (outcome, extra = {}) => ({ outcome, came: null, ...extra });

test('outcomes land in empty cells, with revenue and cash of a won deal', async () => {
  const a = call({ id: '1' }), b = call({ id: '2', name: 'B' });
  const { fake, sync } = await sheetWith([a, b]);
  const res = await sync.syncOutcomes(new Map([[k(a), said('No-Show')], [k(b), said('Full-Pay', { revenue: 4500 })]]));
  assert.deepEqual(res, { outcomes: 2, cleared: 0, closer: 0, conflicts: [] });
  assert.equal(fake.cell('Mar', 'F14'), 'No-Show');
  assert.equal(fake.cell('Mar', 'F15'), 'Full-Pay');
  assert.equal(fake.cell('Mar', 'G15'), 4500);
  assert.equal(fake.cell('Mar', 'H15'), 4500);
  assert.equal(fake.cell('_sync', 'G2'), 'No-Show');
  // Same decisions again: nothing to do, and no Sheets call at all.
  const before = fake.calls.length;
  assert.deepEqual(await sync.syncOutcomes(new Map([[k(a), said('No-Show')]])), { outcomes: 0, cleared: 0, closer: 0, conflicts: [] });
  assert.equal(fake.calls.filter((c, i) => i >= before && c.method === 'POST' && c.path.endsWith(':batchUpdate')).length, 0);
});

test('the service updates its own value, but never what the closer typed or cleared', async () => {
  const a = call({ id: '1' }), b = call({ id: '2', name: 'B' }), c = call({ id: '3', name: 'C' });
  const { fake, sync } = await sheetWith([a, b, c]);
  fake.tab('Mar').grid[14][5] = "Offer & Didn't Buy"; // closer typed on B
  await sync.syncOutcomes(new Map([[k(a), said('No-Show')], [k(b), said('No-Show')], [k(c), said('No-Show')]]));
  assert.equal(fake.cell('Mar', 'F15'), "Offer & Didn't Buy");
  // The team then qualified A in the CRM: the service's No-Show is replaced.
  fake.tab('Mar').grid[15][5] = ''; // closer cleared the service's value on C
  const res = await sync.syncOutcomes(new Map([[k(a), said('No Deposit & Follow-Up')], [k(b), said('Full-Pay')], [k(c), said('Bad Fit & No Offer')]]));
  assert.deepEqual(res, { outcomes: 1, cleared: 0, closer: 1, conflicts: [] });
  assert.equal(fake.cell('Mar', 'F14'), 'No Deposit & Follow-Up');
  assert.equal(fake.cell('Mar', 'F15'), "Offer & Didn't Buy");
  assert.equal(fake.cell('Mar', 'F16'), '');
  // A recording shows up later and the prospect did come: the service takes its own No-Show back.
  const d = call({ id: '4', name: 'D' });
  await sync.syncCalls([a, b, c, d]);
  await sync.syncOutcomes(new Map([[k(d), said('No-Show')]]));
  assert.deepEqual(await sync.syncOutcomes(new Map([[k(d), said(null)]])), { outcomes: 0, cleared: 1, closer: 0, conflicts: [] });
  assert.equal(fake.cell('Mar', 'F17'), '');
});

test('a hand-typed value the recording contradicts is reported once, by row, and kept', async () => {
  const a = call({ id: '1' }), b = call({ id: '2', name: 'B' }), c = call({ id: '3', name: 'C' });
  const { fake, sync } = await sheetWith([a, b, c]);
  fake.tab('Mar').grid[13][5] = 'No-Show'; // the prospect spoke for 40 minutes
  fake.tab('Mar').grid[14][5] = 'Full-Pay'; // the closer was alone
  fake.tab('Mar').grid[15][5] = "Offer & Didn't Buy"; // consistent with the recording
  const decisions = new Map([[k(a), { outcome: null, came: true }], [k(b), { outcome: 'No-Show', came: false }], [k(c), { outcome: null, came: true }]]);
  const res = await sync.syncOutcomes(decisions);
  assert.equal(res.closer, 3);
  assert.deepEqual(res.conflicts.map(x => [x.tab, x.row, x.typed]), [['Mar', 14, 'No-Show'], ['Mar', 15, 'Full-Pay']]);
  assert.equal(fake.cell('Mar', 'F14'), 'No-Show');
  assert.equal(fake.cell('Mar', 'F15'), 'Full-Pay');
  assert.deepEqual((await sync.syncOutcomes(decisions)).conflicts, []); // reported once
});

test('cancelled and rescheduled rows are left alone', async () => {
  const a = call({ id: '1', cancelled: true });
  const { fake, sync } = await sheetWith([a]);
  assert.deepEqual(await sync.syncOutcomes(new Map([[k(a), said('No-Show')]])), { outcomes: 0, cleared: 0, closer: 0, conflicts: [] });
  assert.equal(fake.cell('Mar', 'F14'), 'Cancelled');
});
