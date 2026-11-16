'use strict';
// Read-only preflight. Each check answers one of the questions that broke the real service on day one:
// is the sheet shared with the service account, is it the sheet the team really types in, which booking calendars
// carry bookings that nobody listed, does each recorder account answer, which CRM stages the mapping does not know.
const { fetchCalls } = require('./iclosed');
const { fetchRecordings } = require('./fathom');
const { unknownStages } = require('./crm');
const { localParts, tabName, LEDGER } = require('./sync');

const DAY = 864e5;

async function runCheck({ config, sheets, layout, crm, fetchImpl = fetch, now = () => Date.now() }) {
  const report = [];
  const add = (level, what, detail) => report.push({ level, what, detail });
  const s = config.settings;

  // 1. Google Sheet
  if (sheets) {
    add('info', 'Service account', `${sheets.email || '(memory)'}: this address must be Editor on the sheet the team uses.`);
    try {
      const meta = await sheets.call('GET', `${config.spreadsheetId}?fields=properties(title),sheets(properties(sheetId,title))`);
      const titles = meta.sheets.map(x => x.properties.title);
      add('ok', 'Sheet reachable', `"${meta.properties?.title || '?'}". Open it from the link the team actually uses and compare the id in the URL.`);
      for (const at of [now(), now() + 31 * DAY]) {
        const tab = tabName(s.monthTabs, localParts(new Date(at).toISOString(), config.timeZone));
        if (!titles.includes(tab)) { add('warn', `Tab ${tab}`, 'missing: bookings of that month will be skipped until it exists.'); continue; }
        const lay = await layout(tab);
        if (!lay) add('error', `Tab ${tab}`, 'no call table found (a "Date" header directly followed by "Name").');
        else add('ok', `Tab ${tab}`, `header on row ${lay.headerRow + 1}, columns: ${Object.keys(lay.cols).join(', ')}`);
      }
      if (titles.includes(LEDGER)) {
        const rows = (await sheets.call('GET', `${config.spreadsheetId}/values/${encodeURIComponent(`${LEDGER}!A2:G`)}`)).values || [];
        const last = rows.map(r => r[4]).filter(Boolean).sort().pop();
        add('info', 'Ledger', `${rows.length} booking(s) handled, last one logged ${last || 'never'}.`);
      } else add('info', 'Ledger', `no ${LEDGER} tab yet: the first real pass creates it (hidden).`);
    } catch (e) { add('error', 'Sheet', e.message); }
  } else add('error', 'Sheet', config.credentials ? 'SPREADSHEET_ID is missing.' : 'no Google key: set GOOGLE_SERVICE_ACCOUNT_B64 or GOOGLE_SERVICE_ACCOUNT_FILE.');

  // 2. Booking tool: every calendar with bookings, listed or not.
  if (config.iclosedKey) {
    try {
      const all = await fetchCalls({ apiKey: config.iclosedKey, eventIds: [], from: new Date(now() - config.lookbackDays * DAY), to: new Date(now() + 60 * DAY), sources: s.sources, fetchImpl });
      const byEvent = new Map();
      for (const c of all) byEvent.set(c.eventId, (byEvent.get(c.eventId) || 0) + 1);
      const listed = new Set(config.eventIds.map(String));
      for (const [eventId, count] of [...byEvent].sort((a, b) => b[1] - a[1])) {
        if (!listed.size) add('warn', `Calendar ${eventId}`, `${count} booking(s). ICLOSED_EVENT_IDS is empty: every calendar is read, internal ones included.`);
        else if (listed.has(eventId)) add('ok', `Calendar ${eventId}`, `${count} booking(s), listed.`);
        else add('warn', `Calendar ${eventId}`, `${count} booking(s) NOT listed in ICLOSED_EVENT_IDS. A sales calendar you forgot? Its bookings never reach the sheet.`);
      }
      for (const eventId of listed) if (!byEvent.has(eventId)) add('warn', `Calendar ${eventId}`, 'listed, but no booking in the window: wrong id?');
      if (!all.length) add('warn', 'Booking tool', 'no booking at all in the window.');
    } catch (e) { add('error', 'Booking tool', e.message); }
  } else add('error', 'Booking tool', 'ICLOSED_API_KEY is missing.');

  // 3. Recorder: one line per account.
  if (config.fathomKeys.length) {
    for (const [i, key] of config.fathomKeys.entries()) {
      const errors = [];
      const recs = await fetchRecordings({ apiKeys: [key], since: new Date(now() - config.lookbackDays * DAY), fetchImpl, logger: { error: (_, m) => errors.push(m) } });
      if (errors.length) add('error', `Recorder account #${i + 1}`, errors[0]);
      else add(recs.length ? 'ok' : 'warn', `Recorder account #${i + 1}`, `${recs.length} recording(s) in the last ${config.lookbackDays} days.`);
    }
    if (!s.team.emailDomains.length && !s.team.firstNames.length) add('warn', 'Team', 'team.emailDomains and team.firstNames are empty: a teammate on the call would count as the prospect.');
  } else add('info', 'Recorder', 'no FATHOM_API_KEYS: no recording links, no No-Show detection.');

  // 4. CRM: stages the mapping does not know count as "open" (nothing written).
  if (crm && crm.enabled) {
    try {
      const rows = await crm.fetchRows();
      add('ok', 'CRM', `${rows.length} prospect(s) read with the "${crm.name}" adapter.`);
      const unknown = unknownStages(rows, s.crm);
      if (unknown.length) add('warn', 'CRM stages not mapped', unknown.map(u => `"${u.stage}" (${u.count})`).join(', '));
    } catch (e) { add('error', 'CRM', e.message); }
  } else add('info', 'CRM', 'CRM_ADAPTER=none: outcomes come from the recorder only (No-Show), deal results stay manual.');

  return { report, ok: !report.some(r => r.level === 'error') };
}

function formatReport({ report }) {
  const tag = { ok: 'OK   ', warn: 'WARN ', error: 'ERROR', info: 'INFO ' };
  return report.map(r => `${tag[r.level]} ${r.what}: ${r.detail}`).join('\n');
}

module.exports = { runCheck, formatReport };
