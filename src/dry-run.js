'use strict';
// Dry run on real data: copy the real sheet into memory (3 reads), run a full pass against the copy with the real
// booking tool, recorder and CRM, then list every cell the service would change. Nothing is written to Google.
const { createMemorySheets } = require('./memory-sheets');
const { META_KEY, LEDGER, colLetter } = require('./sync');

const enc = encodeURIComponent;

async function cloneToMemory(sheets, id, { maxRows = 600, ledgerRows = 5000 } = {}) {
  const meta = await sheets.call('GET', `${id}?fields=properties(title),sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))`);
  const props = meta.sheets.map(s => s.properties);
  const ranges = props.map(p => (p.title === LEDGER ? `${LEDGER}!A1:G${ledgerRows}` : `'${p.title}'!A1:AZ${maxRows}`));
  const got = await sheets.call('GET', `${id}/values:batchGet?${ranges.map(r => `ranges=${enc(r)}`).join('&')}&valueRenderOption=UNFORMATTED_VALUE`);
  const found = await sheets.call('POST', `${id}/developerMetadata:search`, { dataFilters: [{ developerMetadataLookup: { metadataKey: META_KEY } }] });
  const tabs = props.map((p, i) => ({
    title: p.title, sheetId: p.sheetId, hidden: Boolean(p.hidden), columnCount: p.gridProperties?.columnCount || 26,
    grid: (got.valueRanges?.[i]?.values || []).map(r => r.slice()),
  }));
  const memory = createMemorySheets(tabs, { metadata: (found.matchedDeveloperMetadata || []).map(m => m.developerMetadata) });
  return { memory, title: meta.properties?.title || '' };
}

const snapshot = memory => new Map(memory.sheets.map(s => [s.title, s.grid.map(r => (r ? r.slice() : []))]));

// Serial date of Google Sheets -> "dd/mm/yy hh:mm".
function fromSerial(n) {
  const at = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 1440) * 60e3);
  const p = v => String(v).padStart(2, '0');
  return `${p(at.getUTCDate())}/${p(at.getUTCMonth() + 1)}/${String(at.getUTCFullYear()).slice(2)} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())}`;
}

// Changed cells grouped by row, with the header name of each column.
async function diff(before, memory, layout) {
  const rows = [];
  let ledger = 0;
  for (const s of memory.sheets) {
    const old = before.get(s.title) || [];
    const height = Math.max(old.length, s.grid.length);
    const changed = new Map();
    for (let r = 0; r < height; r++) {
      const width = Math.max(old[r]?.length || 0, s.grid[r]?.length || 0);
      for (let c = 0; c < width; c++) {
        const a = old[r]?.[c] ?? '', b = s.grid[r]?.[c] ?? '';
        if (a !== b) (changed.get(r) || changed.set(r, []).get(r)).push({ c, a, b });
      }
    }
    if (!changed.size) continue;
    if (s.title === LEDGER) { ledger += changed.size; continue; }
    const lay = await layout(s.title).catch(() => null);
    const head = lay ? (s.grid[lay.headerRow] || []) : [];
    const isDate = c => lay && c === lay.cols.date;
    for (const [r, cells] of changed) {
      rows.push({
        tab: s.title, row: r + 1,
        cells: cells.map(({ c, a, b }) => ({
          column: String(head[c] || colLetter(c)),
          before: isDate(c) && typeof a === 'number' ? fromSerial(a) : a,
          after: isDate(c) && typeof b === 'number' ? fromSerial(b) : b,
        })),
      });
    }
  }
  return { rows, ledgerRows: ledger };
}

function formatDiff({ rows, ledgerRows }) {
  if (!rows.length) return `Nothing to write in the visible tabs. Ledger: ${ledgerRows} line(s) would change.`;
  const lines = rows.map(r => `${r.tab} row ${r.row}: ${r.cells.map(c => `${c.column} ${c.before === '' ? '' : `"${c.before}" -> `}"${c.after}"`).join(' | ')}`);
  return `${lines.join('\n')}\n\n${rows.length} row(s) would change in the visible tabs. Ledger (${LEDGER}): ${ledgerRows} line(s).`;
}

module.exports = { cloneToMemory, snapshot, diff, formatDiff, fromSerial };
