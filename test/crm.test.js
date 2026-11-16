'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createCrm, normalizeLead, unknownStages, mappingOf } = require('../src/crm');

const ROOT = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'config.example.json'), 'utf8'));
const okJson = body => Promise.resolve({ ok: true, status: 200, json: async () => body });

test('rows already in the default shape need no mapping', () => {
  const m = mappingOf();
  assert.deepEqual(normalizeLead({ email: ' Julie@Atlas.example ', phone: '+33 6 00 00 01 01', status: 'won', amount: '2400', paymentMethod: 'split' }, m),
    { email: 'julie@atlas.example', phone: '+33 6 00 00 01 01', status: 'won', amount: 2400, split: true, stages: ['won'] });
  assert.equal(normalizeLead({ status: 'anything else' }, m).status, 'open');
  assert.equal(normalizeLead({ status: 'lost', lostReason: 'Pas le bon client' }, m).status, 'bad_fit');
  assert.equal(normalizeLead({ status: 'lost', lostReason: 'Budget' }, m).status, 'lost');
  assert.equal(normalizeLead({ status: 'open', paidAt: '2026-03-01' }, m).status, 'won'); // paid beats the stage
  assert.equal(normalizeLead({ status: 'open', noShowAt: '2026-03-01' }, m).status, 'no_show');
});

test('your own field names and stage values are mapped by config (accents, case and underscores ignored)', () => {
  const m = mappingOf(settings.crm);
  assert.equal(normalizeLead({ etape: 'SIGNE', montant: 3600, paiement: '3x sans frais' }, m).split, true);
  assert.equal(normalizeLead({ etape: 'Signé', montant: 2400, paiement: 'Comptant' }, m).split, false);
  assert.equal(normalizeLead({ etape: 'second_appel' }, m).status, 'follow_up');
  assert.equal(normalizeLead({ etape: 'Perdu', raison_perte: 'Pas le bon client : studio sans abonnement' }, m).status, 'bad_fit');
  assert.equal(normalizeLead({ etape: 'Non qualifié' }, m).status, 'bad_fit');
  const nested = mappingOf({ fields: { stage: ['deal.stage', 'pipeline'] }, stages: { won: ['closed won'] } });
  assert.equal(normalizeLead({ deal: { stage: 'Closed Won' } }, nested).status, 'won');
  assert.equal(normalizeLead({ pipeline: 'closed_won' }, nested).status, 'won');
});

test('stages the mapping does not know are listed, ignored stages are not', () => {
  const rows = [{ etape: 'Signé' }, { etape: 'RDV pris' }, { etape: 'En pause' }, { etape: 'En pause' }, { etape: 'Rappel' }];
  assert.deepEqual(unknownStages(rows, settings.crm), [{ stage: 'en pause', count: 2 }, { stage: 'rappel', count: 1 }]);
});

test('json adapter reads an export file', async () => {
  const crm = createCrm({ adapter: 'json', jsonFile: path.join(ROOT, 'examples', 'demo', 'crm-leads.json') }, { crm: settings.crm });
  const leads = await crm.fetchLeads();
  assert.equal(crm.enabled, true);
  assert.equal(leads.length, 8);
  assert.deepEqual(leads.map(l => l.status), ['won', 'lost', 'open', 'bad_fit', 'open', 'follow_up', 'won', 'follow_up']);
});

test('http adapter sends the token and accepts an array or {leads}', async () => {
  const seen = [];
  const fetchImpl = (url, opts) => { seen.push([url, opts.headers.authorization]); return okJson({ leads: [{ email: 'a@b.example', status: 'lost' }] }); };
  const crm = createCrm({ adapter: 'http', httpUrl: 'https://crm.example/api/leads', httpToken: 'T' }, {}, { fetchImpl });
  assert.deepEqual((await crm.fetchLeads()).map(l => l.status), ['lost']);
  assert.deepEqual(seen, [['https://crm.example/api/leads', 'Bearer T']]);
  const failing = createCrm({ adapter: 'http', httpUrl: 'https://crm.example/api/leads' }, {}, { fetchImpl: () => Promise.resolve({ ok: false, status: 500 }) });
  await assert.rejects(failing.fetchLeads(), /CRM 500/);
});

test('a custom module adapter works through the same interface', async () => {
  const pages = { 1: { deals: [{ contact: { email: 'x@club.example' }, stage: 'closed_won', value: 1200, installments: 3 }], next: true }, 2: { deals: [{ contact: { email: 'y@club.example' }, stage: 'disqualified' }], next: false } };
  const fetchImpl = url => okJson(pages[new URL(url).searchParams.get('page')]);
  const crm = createCrm({ adapter: './examples/crm-adapter.example.js' }, {}, { env: { EXAMPLE_CRM_URL: 'https://crm.example' }, fetchImpl, cwd: ROOT });
  const leads = await crm.fetchLeads();
  assert.deepEqual(leads.map(l => [l.email, l.status, l.amount, l.split]), [['x@club.example', 'won', 1200, true], ['y@club.example', 'bad_fit', null, false]]);
});

test('no CRM and unknown adapters', async () => {
  assert.deepEqual(await createCrm({ adapter: 'none' }).fetchLeads(), []);
  assert.equal(createCrm({}).enabled, false);
  assert.throws(() => createCrm({ adapter: 'salesforce' }), /Unknown CRM_ADAPTER/);
  assert.throws(() => createCrm({ adapter: 'json' }), /CRM_JSON_FILE/);
});
