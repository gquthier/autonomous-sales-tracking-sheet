'use strict';
// Writes bookings into the sales tracking sheet without touching its layout:
// month tab of the call date (sheet time zone), first free row under the header, columns found by their header name.
// The closer's columns are never written over what the closer typed. The service fills Outcome only in an empty cell
// (or over its own earlier value): Cancelled / Rescheduled from the booking tool, then after the call No-Show or the
// deal result (see outcome.js), and Revenue / Cash of a won deal.
const { matchRecordings } = require('./fathom');
const { DEFAULTS, DEFAULT_LABELS, DEFAULT_HEADERS } = require('./config');

const LEDGER = '_sync'; // hidden tab: one line per booking already handled
const LEDGER_HEAD = ['booking', 'status', 'tab', 'row', 'logged_at', 'recording', 'outcome_auto'];
const CLOSER = '(closer)'; // outcome_auto when a human typed the Outcome: the row is never touched again
const META_KEY = 'sales_sheet_booking';
const MAX_ROWS = 400;
const DATE_FORMAT = { type: 'DATE_TIME', pattern: 'dd/mm/yy hh:mm' };

function localParts(iso, timeZone) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid start time');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute) };
}
// Google Sheets date-time serial (days since 1899-12-30, time as a fraction of the day).
const serial = ({ y, m, d, hh = 0, mm = 0 }) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5 + (hh * 60 + mm) / 1440;
const colLetter = i => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
const blank = v => v === '' || v === null || v === undefined;
const str = v => ({ userEnteredValue: { stringValue: String(v) } });
const enc = encodeURIComponent;
const keyOf = call => `${call.id}@${call.start}`;
const tabName = (monthTabs, p) => monthTabs[p.m - 1].replace('{yyyy}', String(p.y)).replace('{yy}', String(p.y).slice(2));

function createSync({ sheets, spreadsheetId: id, timeZone = 'Europe/Paris', monthTabs = DEFAULTS.monthTabs, labels = DEFAULT_LABELS, headers = DEFAULT_HEADERS, prepareTab = null, logger = console, now = () => new Date() }) {
  const HEADERS = Object.fromEntries(Object.entries({ ...DEFAULT_HEADERS, ...headers }).map(([k, v]) => [k, v instanceof RegExp ? v : new RegExp(v, 'i')]));
  const SHOWED = new Set([labels.lost, labels.badFit, labels.followUp, labels.fullPay, labels.splitPay]);
  let chain = Promise.resolve();
  const locked = fn => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  let tabs = null;
  const prepared = new Set();
  const reported = new Set(); // conflicts already reported since the service started

  async function loadTabs() {
    if (!tabs) {
      const meta = await sheets.call('GET', `${id}?fields=sheets(properties(sheetId,title,gridProperties(columnCount)))`);
      tabs = Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
    }
    if (tabs[LEDGER] === undefined) {
      const res = await sheets.call('POST', `${id}:batchUpdate`, { requests: [{ addSheet: { properties: { title: LEDGER, hidden: true, gridProperties: { rowCount: 2000, columnCount: LEDGER_HEAD.length } } } }] });
      tabs[LEDGER] = res.replies[0].addSheet.properties.sheetId;
      await sheets.call('PUT', `${id}/values/${enc(`${LEDGER}!A1:G1`)}?valueInputOption=RAW`, { values: [LEDGER_HEAD] });
    }
    return tabs;
  }

  async function readLedger() {
    const values = (await sheets.call('GET', `${id}/values/${enc(`${LEDGER}!A2:G`)}`)).values || [];
    const map = new Map();
    values.forEach((r, i) => { if (r[0]) map.set(r[0], { key: r[0], status: r[1] || '', tab: r[2] || '', recording: r[5] || '', auto: r[6] || '', ledgerRow: i + 2 }); });
    return map;
  }

  // Header row of the call table and the column of each known header, whatever the tab's layout.
  // The header row is the first row with a "Date" cell directly followed by a "Name" cell.
  async function layout(tab) {
    const values = (await sheets.call('GET', `${id}/values/${enc(`'${tab}'!A1:AZ40`)}`)).values || [];
    for (let r = 0; r < values.length; r += 1) {
      const row = values[r].map(v => String(v ?? '').trim());
      const d = row.findIndex(v => HEADERS.date.test(v));
      if (d === -1 || !HEADERS.name.test(row[d + 1] || '')) continue;
      const cols = {};
      row.forEach((v, c) => { if (c >= d) for (const [k, re] of Object.entries(HEADERS)) if (cols[k] === undefined && re.test(v)) cols[k] = c; });
      const used = Object.values(cols);
      return { headerRow: r, cols, first: Math.min(...used), last: Math.max(...used) };
    }
    return null;
  }

  async function findRow(key) {
    const res = await sheets.call('POST', `${id}/developerMetadata:search`, { dataFilters: [{ developerMetadataLookup: { metadataKey: META_KEY, metadataValue: key } }] });
    const range = res.matchedDeveloperMetadata?.[0]?.developerMetadata?.location?.dimensionRange;
    if (!range) return null;
    const tab = Object.keys(tabs).find(t => tabs[t] === range.sheetId);
    return tab ? { tab, sheetId: range.sheetId, rowIndex: range.startIndex } : null;
  }

  const cellAt = (sheetId, rowIndex, col, value, fields = 'userEnteredValue') =>
    ({ updateCells: { range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: col, endColumnIndex: col + 1 }, rows: [{ values: [value] }], fields } });
  const ledgerCell = (entry, col, value) => cellAt(tabs[LEDGER], entry.ledgerRow - 1, col, str(value));

  // Fills one cell of the booking's row only when it is empty. Returns true when written.
  async function fillIfEmpty(key, column, value, extra = []) {
    const found = await findRow(key);
    const requests = [...extra];
    let written = false;
    if (found) {
      const lay = await layout(found.tab);
      const col = lay?.cols[column];
      if (col !== undefined && found.rowIndex > lay.headerRow) {
        const a1 = `'${found.tab}'!${colLetter(col)}${found.rowIndex + 1}`;
        const current = (await sheets.call('GET', `${id}/values/${enc(a1)}`)).values?.[0]?.[0];
        if (blank(current)) { requests.push(cellAt(found.sheetId, found.rowIndex, col, str(value))); written = true; }
      }
    }
    if (requests.length) await sheets.call('POST', `${id}:batchUpdate`, { requests });
    return written;
  }

  // New bookings -> one row each; cancelled or moved bookings -> Outcome on the row they already have.
  function syncCalls(calls) {
    return locked(async () => {
      await loadTabs();
      const ledger = await readLedger();
      const result = { added: 0, cancelled: 0, rescheduled: 0, skipped: 0 };
      const state = new Map(); // tab -> { lay, rows, top, cursor } for this run
      const requests = [];
      const fresh = calls.filter(c => !ledger.has(keyOf(c))).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

      for (const call of fresh) {
        const key = keyOf(call);
        // Same booking, other hour: the previous row becomes "Rescheduled".
        for (const old of ledger.values()) {
          if (old.status === 'booked' && old.key.startsWith(`${call.id}@`)) {
            await fillIfEmpty(old.key, 'outcome', labels.rescheduled, [ledgerCell(old, 1, 'rescheduled')]);
            old.status = 'rescheduled'; result.rescheduled += 1;
          }
        }
        const p = localParts(call.start, timeZone);
        const tab = tabName(monthTabs, p);
        if (tabs[tab] === undefined) { result.skipped += 1; logger.warn('No tab for month', tab); continue; }
        if (!state.has(tab)) {
          // First booking written in this tab since the service started: make sure the tab is ready (columns, dropdown).
          if (prepareTab && !prepared.has(tab)) { await prepareTab(tab); prepared.add(tab); }
          const lay = await layout(tab);
          if (!lay || lay.cols.date === undefined || lay.cols.name === undefined) state.set(tab, null);
          else {
            const top = lay.headerRow + 2; // first data row, 1-based
            const rows = (await sheets.call('GET', `${id}/values/${enc(`'${tab}'!${colLetter(lay.first)}${top}:${colLetter(lay.last)}${top + MAX_ROWS - 1}`)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];
            state.set(tab, { lay, rows, top, cursor: 0 });
          }
        }
        const st = state.get(tab);
        if (!st) { result.skipped += 1; logger.warn('No call table found in tab', tab); continue; }
        while (st.cursor < st.rows.length && !(st.rows[st.cursor] || []).every(blank)) st.cursor += 1;
        if (st.cursor >= MAX_ROWS) { result.skipped += 1; logger.warn('Tab is full', tab); continue; }
        const rowIndex = st.top - 1 + st.cursor; // 0-based
        st.cursor += 1;
        const { cols } = st.lay, sheetId = tabs[tab];
        const put = (k, v) => { if (cols[k] !== undefined && !blank(v)) requests.push(cellAt(sheetId, rowIndex, cols[k], str(v))); };
        requests.push(cellAt(sheetId, rowIndex, cols.date, { userEnteredValue: { numberValue: serial(p) }, userEnteredFormat: { numberFormat: DATE_FORMAT } }, 'userEnteredValue,userEnteredFormat.numberFormat'));
        put('name', call.name); put('source', call.source); put('booked', 'Yes');
        if (call.cancelled) put('outcome', labels.cancelled);
        put('email', call.email); put('phone', call.phone); put('website', call.website); put('meet', call.meetLink); put('answers', call.answers);
        requests.push({ createDeveloperMetadata: { developerMetadata: { metadataKey: META_KEY, metadataValue: key, visibility: 'DOCUMENT', location: { dimensionRange: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } } } });
        requests.push({ appendCells: { sheetId: tabs[LEDGER], rows: [{ values: [str(key), str(call.cancelled ? 'cancelled' : 'booked'), str(tab), { userEnteredValue: { numberValue: rowIndex + 1 } }, str(now().toISOString()), str('')] }], fields: 'userEnteredValue' } });
        result.added += 1;
      }
      if (requests.length) await sheets.call('POST', `${id}:batchUpdate`, { requests });

      for (const call of calls) {
        const entry = ledger.get(keyOf(call));
        if (!entry || !call.cancelled || entry.status !== 'booked') continue;
        await fillIfEmpty(entry.key, 'outcome', labels.cancelled, [ledgerCell(entry, 1, 'cancelled')]);
        result.cancelled += 1;
      }
      if (result.added || result.cancelled || result.rescheduled) logger.log('Bookings synced', result);
      return result;
    });
  }

  // Recording link in "Video Call Recording Link", once per booking, never over a link typed by the closer.
  function syncRecordings(calls, recordings) {
    return locked(async () => {
      await loadTabs();
      const ledger = await readLedger();
      const result = { linked: 0, kept: 0 };
      for (const [key, rec] of matchRecordings(calls, recordings)) {
        const entry = ledger.get(key);
        if (!entry || entry.recording) continue;
        const written = await fillIfEmpty(key, 'video', rec.link, [ledgerCell(entry, 5, rec.link)]);
        result[written ? 'linked' : 'kept'] += 1;
      }
      if (result.linked) logger.log('Recordings linked', result);
      return result;
    });
  }

  // A value typed by a human that the recording contradicts: reported, never changed.
  function contradicts(typed, came) {
    if (!typed) return null;
    if (came === true && typed === labels.noShow) return 'typed No-Show, but the prospect speaks in the recording';
    if (came === false && SHOWED.has(typed)) return 'typed a call result, but the closer is alone in the recording';
    return null;
  }

  // Outcome after the call (decisions: booking key -> { outcome, revenue, came } | null, see outcome.js).
  // Written in an empty cell or over the service's own earlier value; a value typed (or cleared) by a human wins for good.
  // Few Sheets calls whatever the number of rows: one metadata search, one layout per tab, one read, one write.
  function syncOutcomes(decisions) {
    return locked(async () => {
      await loadTabs();
      const ledger = await readLedger();
      const result = { outcomes: 0, cleared: 0, closer: 0, conflicts: [] };
      const todo = [];
      for (const [key, d] of decisions) {
        const entry = ledger.get(key);
        if (!entry || entry.status !== 'booked' || !d) continue;
        const want = d.outcome || '';
        const owned = entry.auto !== CLOSER;
        // A row with a recording is also read to compare what a human typed with the recording (once per row).
        const evidence = (d.came === true || d.came === false) && !reported.has(key);
        if ((owned && want !== entry.auto) || evidence) todo.push({ key, entry, want, revenue: d.revenue ?? null, came: d.came, owned });
      }
      if (!todo.length) return result;
      const found = await sheets.call('POST', `${id}/developerMetadata:search`, { dataFilters: todo.map(t => ({ developerMetadataLookup: { metadataKey: META_KEY, metadataValue: t.key } })) });
      const where = new Map((found.matchedDeveloperMetadata || []).map(m => [m.developerMetadata.metadataValue, m.developerMetadata.location?.dimensionRange]).filter(([, r]) => r));
      const lays = new Map();
      const ready = [];
      for (const t of todo) {
        const r = where.get(t.key);
        const tab = r && Object.keys(tabs).find(n => tabs[n] === r.sheetId);
        if (!tab) continue;
        if (!lays.has(tab)) lays.set(tab, await layout(tab));
        const lay = lays.get(tab);
        if (lay?.cols.outcome === undefined || r.startIndex <= lay.headerRow) continue;
        const a1 = k => (lay.cols[k] === undefined ? null : `'${tab}'!${colLetter(lay.cols[k])}${r.startIndex + 1}`);
        ready.push({ ...t, tab, sheetId: r.sheetId, rowIndex: r.startIndex, cols: lay.cols, a1 });
      }
      if (!ready.length) return result;
      const ranges = ready.flatMap(t => ['outcome', 'revenue', 'cash'].map(t.a1).filter(Boolean));
      const got = await sheets.call('GET', `${id}/values:batchGet?${ranges.map(x => `ranges=${enc(x)}`).join('&')}`);
      const value = new Map(ranges.map((x, i) => [x, got.valueRanges?.[i]?.values?.[0]?.[0]]));
      const requests = [];
      for (const t of ready) {
        const current = String(value.get(t.a1('outcome')) ?? '').trim();
        if (!t.owned || current !== t.entry.auto) {
          if (t.owned) { requests.push(ledgerCell(t.entry, 6, CLOSER)); result.closer += 1; }
          const why = contradicts(current, t.came);
          if (why) result.conflicts.push({ tab: t.tab, row: t.rowIndex + 1, typed: current, why });
          reported.add(t.key);
          continue;
        }
        if (t.want === t.entry.auto) continue; // read for the comparison only
        requests.push(cellAt(t.sheetId, t.rowIndex, t.cols.outcome, t.want ? str(t.want) : {}));
        if (t.want && t.revenue !== null && Number.isFinite(t.revenue)) {
          for (const k of ['revenue', 'cash']) if (t.a1(k) && blank(value.get(t.a1(k)))) requests.push(cellAt(t.sheetId, t.rowIndex, t.cols[k], { userEnteredValue: { numberValue: t.revenue } }));
        }
        requests.push(ledgerCell(t.entry, 6, t.want));
        result[t.want ? 'outcomes' : 'cleared'] += 1;
      }
      if (requests.length) await sheets.call('POST', `${id}:batchUpdate`, { requests });
      if (result.outcomes || result.cleared) logger.log('Outcomes synced', { outcomes: result.outcomes, cleared: result.cleared, closer: result.closer });
      // Row numbers only: no prospect data in the logs.
      for (const c of result.conflicts) logger.warn(`Check ${c.tab}!row ${c.row}: ${c.why} (kept as typed)`);
      return result;
    });
  }

  return { syncCalls, syncRecordings, syncOutcomes, layout };
}

module.exports = { createSync, localParts, serial, tabName, colLetter, LEDGER, LEDGER_HEAD, META_KEY, CLOSER };
