'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemorySheets } = require('../src/memory-sheets');
const { createSync, serial, tabName } = require('../src/sync');
const { normalizeCall, resolveSource } = require('../src/iclosed');
const { matchRecordings } = require('../src/fathom');
const { DEFAULT_SOURCES } = require('../src/config');

const HEADER = ['', 'Date', 'Name', 'Source', 'Booked', 'Outcome', 'Revenue', 'Cash', 'Offer', 'My Emotions', 'Objection', 'Call Summary', '', '', '', 'Video Call Recording Link', 'Email', 'Phone', 'Website', 'Meet Link', 'Form Answers'];
const quiet = { log() {}, warn() {}, error() {} };
function setup() {
  const fake = createMemorySheets();
  for (const t of ['Nov', 'Dec']) { fake.tab(t).grid[2] = ['', 'Bookings:', 0]; fake.tab(t).grid[12] = HEADER.slice(); }
  const sync = createSync({ sheets: fake, spreadsheetId: 'S', logger: quiet, now: () => new Date('2026-11-13T08:00:00Z') });
  return { fake, sync };
}
const call = (over = {}) => ({ id: '100', eventId: '1001', start: '2026-11-13T13:30:00.000Z', name: 'Claire Dupont', email: 'claire@club-atlas.example', phone: '+33 6 00 00 00 01', website: 'https://club-atlas.example', meetLink: 'https://meet.google.com/abc-defg-hij', meetCode: 'abc-defg-hij', source: 'Facebook', answers: 'Combien de salles : 2', cancelled: false, ...over });

test('a booking lands in the month tab of its local date, first free row, by header name', async () => {
  const { fake, sync } = setup();
  assert.deepEqual(await sync.syncCalls([call()]), { added: 1, cancelled: 0, rescheduled: 0, skipped: 0 });
  assert.equal(fake.cell('Nov', 'B14'), serial({ y: 2026, m: 11, d: 13, hh: 14, mm: 30 })); // 13:30 UTC = 14:30 Paris
  assert.equal(fake.cell('Nov', 'C14'), 'Claire Dupont');
  assert.equal(fake.cell('Nov', 'D14'), 'Facebook');
  assert.equal(fake.cell('Nov', 'E14'), 'Yes');
  assert.equal(fake.cell('Nov', 'F14'), undefined);
  assert.equal(fake.cell('Nov', 'Q14'), 'claire@club-atlas.example');
  assert.equal(fake.cell('Nov', 'R14'), '+33 6 00 00 00 01');
  assert.equal(fake.cell('Nov', 'S14'), 'https://club-atlas.example');
  assert.equal(fake.cell('Nov', 'T14'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(fake.cell('Nov', 'U14'), 'Combien de salles : 2');
});

test('the same booking read again adds nothing, and rows already used are skipped', async () => {
  const { fake, sync } = setup();
  fake.tab('Nov').grid[13] = ['', 46000, 'Typed by hand'];
  await sync.syncCalls([call()]);
  await sync.syncCalls([call(), call({ id: '101', name: 'Marc Petit', start: '2026-11-14T09:00:00.000Z' })]);
  assert.equal(fake.cell('Nov', 'C14'), 'Typed by hand');
  assert.equal(fake.cell('Nov', 'C15'), 'Claire Dupont');
  assert.equal(fake.cell('Nov', 'C16'), 'Marc Petit');
  assert.equal(fake.cell('Nov', 'C17'), undefined);
});

test('several new bookings are written in call order; a December call goes to Dec', async () => {
  const { fake, sync } = setup();
  await sync.syncCalls([call({ id: '3', name: 'C', start: '2026-12-01T10:00:00.000Z' }), call({ id: '2', name: 'B', start: '2026-11-20T10:00:00.000Z' }), call({ id: '1', name: 'A', start: '2026-11-18T10:00:00.000Z' })]);
  assert.equal(fake.cell('Nov', 'C14'), 'A');
  assert.equal(fake.cell('Nov', 'C15'), 'B');
  assert.equal(fake.cell('Dec', 'C14'), 'C');
});

test('a call late on the last evening of the month goes to the next month in the sheet time zone', async () => {
  const { fake, sync } = setup();
  await sync.syncCalls([call({ start: '2026-11-30T23:30:00.000Z' })]); // 00:30 on 1 December in Paris
  assert.equal(fake.cell('Dec', 'C14'), 'Claire Dupont');
  assert.equal(fake.cell('Nov', 'C14'), undefined);
});

test('a cancellation fills Outcome only when the closer left it empty', async () => {
  const { fake, sync } = setup();
  await sync.syncCalls([call(), call({ id: '101', name: 'Marc Petit' })]);
  fake.tab('Nov').grid[14][5] = 'No-Show'; // closer already qualified Marc
  const res = await sync.syncCalls([call({ cancelled: true }), call({ id: '101', name: 'Marc Petit', cancelled: true })]);
  assert.equal(res.cancelled, 2);
  assert.equal(fake.cell('Nov', 'F14'), 'Cancelled');
  assert.equal(fake.cell('Nov', 'F15'), 'No-Show');
  assert.equal((await sync.syncCalls([call({ cancelled: true })])).cancelled, 0);
});

test('a booking already cancelled when first seen is logged with Outcome Cancelled', async () => {
  const { fake, sync } = setup();
  await sync.syncCalls([call({ cancelled: true })]);
  assert.equal(fake.cell('Nov', 'E14'), 'Yes');
  assert.equal(fake.cell('Nov', 'F14'), 'Cancelled');
});

test('a moved booking marks the old row Rescheduled and opens a new row', async () => {
  const { fake, sync } = setup();
  await sync.syncCalls([call()]);
  const res = await sync.syncCalls([call({ start: '2026-12-02T09:00:00.000Z' })]);
  assert.equal(res.rescheduled, 1); assert.equal(res.added, 1);
  assert.equal(fake.cell('Nov', 'F14'), 'Rescheduled');
  assert.equal(fake.cell('Dec', 'C14'), 'Claire Dupont');
  assert.equal(fake.cell('Dec', 'F14'), undefined);
});

test('a row cleared by the closer is never added again', async () => {
  const { fake, sync } = setup();
  await sync.syncCalls([call()]);
  fake.tab('Nov').grid[13] = [];
  assert.equal((await sync.syncCalls([call()])).added, 0);
  assert.equal(fake.cell('Nov', 'C14'), undefined);
});

test('the recording link is written once and never over a link typed by the closer', async () => {
  const { fake, sync } = setup();
  const calls = [call(), call({ id: '101', name: 'Marc Petit', meetCode: 'zzz-zzzz-zzz', start: '2026-11-13T15:00:00.000Z' })];
  await sync.syncCalls(calls);
  fake.tab('Nov').grid[14][15] = 'https://video.example/mine';
  const recs = [{ id: 'r1', link: 'https://fathom.video/share/A', start: '2026-11-13T13:31:00.000Z', minutes: 30, meetCode: 'abc-defg-hij', emails: [] }, { id: 'r2', link: 'https://fathom.video/share/B', start: '2026-11-13T15:02:00.000Z', minutes: 20, meetCode: 'zzz-zzzz-zzz', emails: [] }];
  assert.deepEqual(await sync.syncRecordings(calls, recs), { linked: 1, kept: 1 });
  assert.equal(fake.cell('Nov', 'P14'), 'https://fathom.video/share/A');
  assert.equal(fake.cell('Nov', 'P15'), 'https://video.example/mine');
  assert.deepEqual(await sync.syncRecordings(calls, recs), { linked: 0, kept: 0 });
});

test('a tab with another layout is read by its headers; a month without a tab is skipped', async () => {
  const fake = createMemorySheets(['Dash', 'May']);
  fake.tab('May').grid[0] = ['Date', 'Name', 'Email', 'Website', 'Phone', 'Source', 'Question', 'Outcome', 'Offer', 'Revenue', 'Cash', 'My Emotions', 'Objection', 'Call Summary', 'Video Call Recording Link'];
  const sync = createSync({ sheets: fake, spreadsheetId: 'S', logger: quiet });
  const res = await sync.syncCalls([call({ start: '2026-05-04T08:00:00.000Z' }), call({ id: '9', start: '2026-06-04T08:00:00.000Z' })]);
  assert.deepEqual(res, { added: 1, cancelled: 0, rescheduled: 0, skipped: 1 });
  assert.equal(fake.cell('May', 'B2'), 'Claire Dupont');
  assert.equal(fake.cell('May', 'C2'), 'claire@club-atlas.example');
  assert.equal(fake.cell('May', 'F2'), 'Facebook');
  assert.equal(fake.cell('May', 'H2'), undefined);
});

test('month tabs can carry the year, and headers and labels come from the settings', async () => {
  const fake = createMemorySheets(['Mars 2026']);
  fake.tab('Mars 2026').grid[0] = ['Date', 'Nom', 'Résultat'];
  const months = ['Janv {yyyy}', 'Févr {yyyy}', 'Mars {yyyy}', 'Avr {yyyy}', 'Mai {yyyy}', 'Juin {yyyy}', 'Juil {yyyy}', 'Août {yyyy}', 'Sept {yyyy}', 'Oct {yyyy}', 'Nov {yyyy}', 'Déc {yyyy}'];
  assert.equal(tabName(months, { y: 2026, m: 3 }), 'Mars 2026');
  const sync = createSync({ sheets: fake, spreadsheetId: 'S', logger: quiet, monthTabs: months, headers: { name: '^nom$', outcome: '^résultat$' }, labels: { cancelled: 'Annulé' } });
  await sync.syncCalls([call({ start: '2026-03-04T08:00:00.000Z', cancelled: true })]);
  assert.equal(fake.cell('Mars 2026', 'B2'), 'Claire Dupont');
  assert.equal(fake.cell('Mars 2026', 'C2'), 'Annulé');
});

test('recordings match by Meet room, then guest e-mail, then an unambiguous hour; the longest wins', () => {
  const calls = [call(), call({ id: '2', meetCode: null, email: 'bob@salle-b.example', start: '2026-11-13T15:00:00.000Z' }), call({ id: '3', meetCode: null, email: 'x@x.example', start: '2026-11-13T17:00:00.000Z' }), call({ id: '4', meetCode: null, email: 'y@y.example', start: '2026-11-14T09:00:00.000Z' }), call({ id: '5', meetCode: null, email: 'z@z.example', start: '2026-11-14T09:15:00.000Z' })];
  const rec = (id, start, minutes, extra = {}) => ({ id, link: `L${id}`, start, minutes, meetCode: null, emails: [], ...extra });
  const picked = matchRecordings(calls, [
    rec('a', '2026-11-12T10:00:00.000Z', 5, { meetCode: 'abc-defg-hij' }), rec('b', '2026-11-13T13:35:00.000Z', 31, { meetCode: 'abc-defg-hij' }),
    rec('c', '2026-11-13T15:01:00.000Z', 20, { emails: ['bob@salle-b.example'] }),
    rec('d', '2026-11-13T17:03:00.000Z', 25),
    rec('e', '2026-11-14T09:10:00.000Z', 25), // two calls around: nobody gets it
    rec('f', '2026-11-20T09:00:00.000Z', 25),
  ]);
  assert.equal(picked.get('100@2026-11-13T13:30:00.000Z').id, 'b');
  assert.equal(picked.get('2@2026-11-13T15:00:00.000Z').id, 'c');
  assert.equal(picked.get('3@2026-11-13T17:00:00.000Z').id, 'd');
  assert.equal(picked.size, 3);
});

test('booking rows are normalised and the source follows the UTMs and the configured rules', () => {
  const c = normalizeCall({ id: 7, callId: 7, eventId: 1001, dateTimeUTC: '2026-11-17T14:00:00.000Z', inviteeName: ' Nora  Vidal ', inviteeEmail: 'N@Club-Atlas.example', phoneNumber: '+33 6 00 00 00 00', locationLink: 'https://meet.google.com/nor-avid-alx', cancelledBy: null, cancelReason: '',
    utm: [{ utmKey: 'utm_source', utmValue: 'meta' }], questions: [{ statement: 'First Name', answer: 'Nora' }],
    secondaryAnswers: [{ customFieldIdentifier: 'website', statement: 'Le site de votre salle ?', answer: [{ answer: 'https://club-atlas.example/' }] }, { customFieldIdentifier: 'salles', statement: 'Combien de salles gérez-vous ?', answer: [{ answer: '3' }] }] });
  assert.deepEqual({ ...c }, { id: '7', eventId: '1001', start: '2026-11-17T14:00:00.000Z', name: 'Nora Vidal', email: 'n@club-atlas.example', phone: '+33 6 00 00 00 00', website: 'https://club-atlas.example/', meetLink: 'https://meet.google.com/nor-avid-alx', meetCode: 'nor-avid-alx', source: 'Facebook', answers: 'Combien de salles gérez-vous : 3', cancelled: false });
  assert.equal(normalizeCall({ id: 1, dateTimeUTC: '2026-11-17T14:00:00.000Z', cancelledBy: 'superadmin' }).cancelled, true);
  assert.equal(resolveSource({ utm_source: 'dialer' }, [{ label: 'Cold Call', source: '^dialer$' }, ...DEFAULT_SOURCES]), 'Cold Call');
  assert.equal(resolveSource({ utm_source: 'x', utm_medium: 'cold-call' }), 'Cold Call');
  assert.equal(resolveSource({ fbclid: 'x' }), 'Facebook');
  assert.equal(resolveSource({ utm_source: 'instantly' }), 'Email');
  assert.equal(resolveSource({}), '');
});

test('a month tab is prepared once before its first row', async () => {
  const fake = createMemorySheets();
  for (const t of ['Nov', 'Dec']) fake.tab(t).grid[12] = HEADER.slice();
  const seen = [];
  const sync = createSync({ sheets: fake, spreadsheetId: 'S', logger: quiet, prepareTab: async tab => { seen.push(tab); } });
  await sync.syncCalls([call(), call({ id: '2', start: '2026-11-14T09:00:00.000Z' })]);
  await sync.syncCalls([call({ id: '3', start: '2026-11-15T09:00:00.000Z' }), call({ id: '4', start: '2026-12-01T09:00:00.000Z' })]);
  assert.deepEqual(seen, ['Nov', 'Dec']);
});
