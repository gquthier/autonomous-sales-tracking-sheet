'use strict';
// In-memory stand-in for the few Sheets REST calls the service makes.
// Used by the tests, the demo (no key at all) and the dry run (a copy of your real sheet, nothing written to Google).
const colIndex = letters => letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function parseRange(a1) {
  const m = decodeURIComponent(a1).match(/^'?([^'!]+)'?!([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/);
  if (!m) throw new Error(`Unsupported range ${a1}`);
  return { tab: m[1], c0: colIndex(m[2]), r0: Number(m[3]) - 1, c1: m[4] ? colIndex(m[4]) : colIndex(m[2]), r1: m[5] ? Number(m[5]) - 1 : m[4] ? Infinity : Number(m[3]) - 1 };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// tabs: titles, or { title, sheetId, grid, hidden, validations } to start from existing content.
function createMemorySheets(tabs = ['Dash', ...MONTHS], { metadata: startMetadata = [] } = {}) {
  let nextId = 100;
  const sheets = tabs.map(t => (typeof t === 'string'
    ? { title: t, sheetId: nextId++, grid: [], hidden: false, columnCount: 26, validations: {} }
    : { grid: [], hidden: false, columnCount: 26, validations: {}, ...t, sheetId: t.sheetId ?? nextId++ }));
  nextId = Math.max(nextId, ...sheets.map(s => s.sheetId + 1));
  const metadata = [...startMetadata];
  const calls = [];
  const byId = id => sheets.find(s => s.sheetId === id);
  const byTitle = t => sheets.find(s => s.title === t);
  const set = (s, r, c, v) => { (s.grid[r] ||= [])[c] = v; };
  const cellValue = v => v.userEnteredValue?.stringValue ?? v.userEnteredValue?.numberValue ?? v.userEnteredValue?.formulaValue ?? '';
  const props = s => ({ sheetId: s.sheetId, title: s.title, hidden: s.hidden, gridProperties: { rowCount: Math.max(1000, s.grid.length), columnCount: s.columnCount } });

  function read({ tab, c0, r0, c1, r1 }) {
    const s = byTitle(tab);
    if (!s) throw Object.assign(new Error(`Sheets 400: Unable to parse range: ${tab}`), { status: 400 });
    const out = [];
    for (let r = r0; r <= Math.min(r1, s.grid.length - 1); r++) { const row = []; for (let c = c0; c <= Math.min(c1, c0 + 200); c++) row.push(s.grid[r]?.[c] ?? ''); out.push(row); }
    while (out.length && out[out.length - 1].every(v => v === '')) out.pop();
    out.forEach(row => { while (row.length && row[row.length - 1] === '') row.pop(); });
    return out;
  }

  async function call(method, path, body) {
    calls.push({ method, path, body });
    const [, rest = ''] = path.match(/^[^/?:]+(.*)$/);
    if (method === 'GET' && rest.startsWith('?fields')) return { properties: { title: 'Sales Tracking Sheet (memory)' }, sheets: sheets.map(s => ({ properties: props(s) })) };
    if (method === 'GET' && rest.startsWith('?ranges=')) {
      const { tab, c0 } = parseRange(new URLSearchParams(rest.slice(1)).get('ranges'));
      return { sheets: [{ data: [{ rowData: [{ values: [{ dataValidation: byTitle(tab)?.validations[c0] }] }] }] }] };
    }
    if (method === 'GET' && rest.startsWith('/values/')) {
      const out = read(parseRange(rest.slice(8).split('?')[0]));
      return out.length ? { values: out } : {};
    }
    if (method === 'GET' && rest.startsWith('/values:batchGet?')) {
      const ranges = new URLSearchParams(rest.split('?')[1]).getAll('ranges');
      return { valueRanges: ranges.map(a1 => { const out = read(parseRange(a1)); return out.length ? { range: a1, values: out } : { range: a1 }; }) };
    }
    if (method === 'PUT' && rest.startsWith('/values/')) {
      const { tab, c0, r0 } = parseRange(rest.slice(8).split('?')[0]);
      body.values.forEach((row, i) => row.forEach((v, j) => set(byTitle(tab), r0 + i, c0 + j, v)));
      return {};
    }
    if (method === 'POST' && rest === '/developerMetadata:search') {
      const wants = body.dataFilters.map(f => f.developerMetadataLookup);
      return { matchedDeveloperMetadata: metadata.filter(m => wants.some(w => m.metadataKey === w.metadataKey && (w.metadataValue === undefined || m.metadataValue === w.metadataValue))).map(developerMetadata => ({ developerMetadata })) };
    }
    if (method === 'POST' && rest === ':batchUpdate') {
      const replies = [];
      for (const q of body.requests) {
        if (q.addSheet) {
          const s = { title: q.addSheet.properties.title, sheetId: nextId++, grid: [], hidden: Boolean(q.addSheet.properties.hidden), columnCount: q.addSheet.properties.gridProperties?.columnCount || 26, validations: {} };
          sheets.push(s); replies.push({ addSheet: { properties: { sheetId: s.sheetId, title: s.title } } }); continue;
        }
        if (q.updateCells) { const { sheetId, startRowIndex, startColumnIndex } = q.updateCells.range; q.updateCells.rows.forEach((row, i) => row.values.forEach((v, j) => set(byId(sheetId), startRowIndex + i, startColumnIndex + j, cellValue(v)))); }
        if (q.createDeveloperMetadata) metadata.push(q.createDeveloperMetadata.developerMetadata);
        if (q.appendCells) { const s = byId(q.appendCells.sheetId); const r = s.grid.length; q.appendCells.rows[0].values.forEach((v, j) => set(s, r, j, cellValue(v))); }
        if (q.appendDimension) byId(q.appendDimension.sheetId).columnCount += q.appendDimension.length;
        if (q.setDataValidation) byId(q.setDataValidation.range.sheetId).validations[q.setDataValidation.range.startColumnIndex] = q.setDataValidation.rule;
        // copyPaste (formats) and updateDimensionProperties (widths) have no visible effect in memory.
        replies.push({});
      }
      return { replies };
    }
    throw new Error(`Unhandled memory call ${method} ${path}`);
  }

  return {
    call, calls, sheets, metadata,
    tab: t => byTitle(t),
    cell: (t, a1) => { const { r0, c0 } = parseRange(`${t}!${a1}`); return byTitle(t).grid[r0]?.[c0]; },
  };
}

module.exports = { createMemorySheets, parseRange, colIndex };
