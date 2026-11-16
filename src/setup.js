'use strict';
// Preparation of a month tab, without changing its look. Every step is safe to run again.
// - Information columns (Email, Phone, Website, Meet Link, Form Answers by default) added on the right of the call table,
//   styled like the recording column (or the last known column).
// - Extra values (e.g. "Cold Call") added to the Source dropdown when the column has one.
// The rest of your sheet (dashboard, formulas, counters) is never touched.
const { DEFAULTS } = require('./config');
const { colLetter } = require('./sync');

const enc = encodeURIComponent;
const str = v => ({ userEnteredValue: { stringValue: v } });
const rect = (sheetId, r0, r1, c0, c1) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });

function createSetup({ sheets, spreadsheetId: id, layout, extraColumns = DEFAULTS.extraColumns, addSourceOptions = DEFAULTS.addSourceOptions }) {
  let props = null;
  async function tabProps() {
    if (!props) {
      const meta = await sheets.call('GET', `${id}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`);
      props = Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties]));
    }
    return props;
  }

  async function prepareTab(tab) {
    const p = (await tabProps())[tab];
    const lay = p && await layout(tab);
    if (!lay) return { tab, changes: 0, skipped: 'no call table (a "Date" header followed by "Name")' };
    const { headerRow: h, cols } = lay, sid = p.sheetId, rows = p.gridProperties.rowCount;
    const anchor = cols.video ?? lay.last;
    const requests = [];

    const header = (await sheets.call('GET', `${id}/values/${enc(`'${tab}'!A${h + 1}:AZ${h + 1}`)}`)).values?.[0] || [];
    const missing = extraColumns.filter(([name]) => !header.some(v => String(v).trim().toLowerCase() === name.toLowerCase()));
    if (missing.length) {
      const start = Math.max(header.length, anchor + 1);
      const need = start + missing.length - p.gridProperties.columnCount;
      if (need > 0) requests.push({ appendDimension: { sheetId: sid, dimension: 'COLUMNS', length: need } });
      missing.forEach(([name, width], i) => {
        const c = start + i;
        requests.push({ copyPaste: { source: rect(sid, h, rows, anchor, anchor + 1), destination: rect(sid, h, rows, c, c + 1), pasteType: 'PASTE_FORMAT' } });
        requests.push({ updateCells: { range: rect(sid, h, h + 1, c, c + 1), rows: [{ values: [str(name)] }], fields: 'userEnteredValue' } });
        if (width) requests.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: width }, fields: 'pixelSize' } });
      });
    }

    if (cols.source !== undefined && addSourceOptions.length) {
      const res = await sheets.call('GET', `${id}?ranges=${enc(`'${tab}'!${colLetter(cols.source)}${h + 2}`)}&fields=sheets(data(rowData(values(dataValidation))))`);
      const rule = res.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
      const current = rule?.condition?.type === 'ONE_OF_LIST' ? rule.condition.values.map(v => v.userEnteredValue ?? '') : null;
      const add = current ? addSourceOptions.filter(v => !current.includes(v)) : [];
      if (add.length) {
        const next = [...current.filter(v => v !== ''), ...add, ...(current.includes('') ? [''] : [])];
        requests.push({ setDataValidation: { range: rect(sid, h + 1, rows, cols.source, cols.source + 1), rule: { ...rule, condition: { type: 'ONE_OF_LIST', values: next.map(v => ({ userEnteredValue: v })) } } } });
      }
    }
    if (requests.length) await sheets.call('POST', `${id}:batchUpdate`, { requests });
    if (requests.length) props = null; // the column count may have changed
    return { tab, changes: requests.length };
  }

  return { prepareTab };
}

module.exports = { createSetup };
