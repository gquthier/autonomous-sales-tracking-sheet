'use strict';
// CRM adapter. All the service needs from your CRM is, per prospect, what the team decided after the call.
//
// Interface (any source): an async fetchRows() that returns an array of plain objects, one per prospect.
// normalizeLeads() then maps each row with the "crm" block of config.json to:
//   { email, phone, status: 'won' | 'no_show' | 'lost' | 'bad_fit' | 'follow_up' | 'open', amount, split, stages }
//
// Built-in sources (CRM_ADAPTER): none, json (CRM_JSON_FILE), http (CRM_HTTP_URL + CRM_HTTP_TOKEN),
// or the path of your own module exporting `async fetchLeads({ env, settings, fetchImpl })` that returns rows.
const fs = require('node:fs');
const path = require('node:path');

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
const get = (row, field) => (field ? String(field).split('.').reduce((o, k) => (o == null ? undefined : o[k]), row) : undefined);
const filled = v => v !== undefined && v !== null && v !== '' && v !== false;

// With no "crm" block, rows are expected to already use these field names and status values.
const DEFAULT_MAPPING = {
  fields: { email: 'email', phone: 'phone', stage: ['status'], lostReason: 'lostReason', amount: 'amount', paymentMethod: 'paymentMethod', noShow: 'noShowAt', paidAt: 'paidAt' },
  stages: { won: ['won'], noShow: ['no_show'], lost: ['lost'], badFit: ['bad_fit'], followUp: ['follow_up'] },
  badFitReasons: 'bon client|qualif|not a fit|bad fit|hors cible|hors zone',
  splitPayment: 'split|plusieurs|echeanc|mensual|installment|\\b\\d+ ?x\\b|\\bx ?\\d+\\b',
};

function mappingOf(crmSettings = {}) {
  return {
    ...DEFAULT_MAPPING,
    ...crmSettings,
    fields: { ...DEFAULT_MAPPING.fields, ...(crmSettings.fields || {}) },
    stages: { ...DEFAULT_MAPPING.stages, ...(crmSettings.stages || {}) },
  };
}

function normalizeLead(row, mapping = mappingOf()) {
  const f = mapping.fields;
  const stages = [].concat(f.stage || []).map(k => norm(get(row, k))).filter(Boolean);
  const is = kind => stages.some(v => (mapping.stages[kind] || []).map(norm).includes(v));
  const lostReason = norm(get(row, f.lostReason));
  let status = 'open';
  // Order matters: a paid deal beats everything, then an explicit no-show, then the decisions taken in the call.
  if (is('won') || filled(get(row, f.paidAt))) status = 'won';
  else if (is('noShow') || filled(get(row, f.noShow))) status = 'no_show';
  else if (is('lost')) status = mapping.badFitReasons && new RegExp(mapping.badFitReasons, 'i').test(lostReason) ? 'bad_fit' : 'lost';
  else if (is('badFit')) status = 'bad_fit';
  else if (is('followUp')) status = 'follow_up';
  const raw = get(row, f.amount);
  const amount = filled(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null;
  return {
    email: String(get(row, f.email) ?? '').trim().toLowerCase(),
    phone: String(get(row, f.phone) ?? ''),
    status,
    amount,
    split: status === 'won' && Boolean(mapping.splitPayment) && new RegExp(mapping.splitPayment, 'i').test(norm(get(row, f.paymentMethod))),
    stages,
  };
}

const normalizeLeads = (rows, crmSettings) => { const m = mappingOf(crmSettings); return rows.map(r => normalizeLead(r, m)); };

// Stage values found in the CRM that the mapping does not know: they all count as "open". Shown by the check.
function unknownStages(rows, crmSettings) {
  const m = mappingOf(crmSettings);
  const known = new Set(Object.values(m.stages).flat().map(norm));
  for (const v of [].concat(m.ignoreStages || [])) known.add(norm(v));
  const counts = new Map();
  for (const r of rows) for (const k of [].concat(m.fields.stage || [])) {
    const v = norm(get(r, k));
    if (v && !known.has(v)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([stage, count]) => ({ stage, count }));
}

const rowsOf = body => (Array.isArray(body) ? body : body?.leads || body?.data || body?.items || []);

function createCrm(crmConfig = {}, settings = {}, { env = process.env, fetchImpl = fetch, cwd = process.cwd() } = {}) {
  const adapter = crmConfig.adapter || 'none';
  let fetchRows;
  if (adapter === 'none') fetchRows = async () => [];
  else if (adapter === 'json') {
    if (!crmConfig.jsonFile) throw new Error('CRM_ADAPTER=json needs CRM_JSON_FILE');
    fetchRows = async () => rowsOf(JSON.parse(fs.readFileSync(path.resolve(cwd, crmConfig.jsonFile), 'utf8')));
  } else if (adapter === 'http') {
    if (!crmConfig.httpUrl) throw new Error('CRM_ADAPTER=http needs CRM_HTTP_URL');
    fetchRows = async () => {
      const headers = { accept: 'application/json' };
      if (crmConfig.httpToken) headers.authorization = `Bearer ${crmConfig.httpToken}`;
      const res = await fetchImpl(crmConfig.httpUrl, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`CRM ${res.status}`);
      return rowsOf(await res.json());
    };
  } else if (/\.(c?js)$/.test(adapter)) {
    const mod = require(path.resolve(cwd, adapter));
    if (typeof mod.fetchLeads !== 'function') throw new Error(`${adapter} must export async fetchLeads()`);
    fetchRows = async () => rowsOf(await mod.fetchLeads({ env, settings, fetchImpl }));
  } else throw new Error(`Unknown CRM_ADAPTER "${adapter}" (none, json, http or a .js file)`);

  return {
    name: adapter,
    enabled: adapter !== 'none',
    fetchRows,
    fetchLeads: async () => normalizeLeads(await fetchRows(), settings.crm),
  };
}

module.exports = { createCrm, normalizeLead, normalizeLeads, unknownStages, mappingOf, norm };
