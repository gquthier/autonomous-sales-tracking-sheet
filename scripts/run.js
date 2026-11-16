#!/usr/bin/env node
'use strict';
// Command line. Same code as the service.
//   node scripts/run.js --demo              fictional data, no key, nothing leaves the machine
//   node scripts/run.js --check             read-only preflight on your real accounts
//   node scripts/run.js --dry-run           full pass on your real data against a copy of the sheet: what would change
//   node scripts/run.js --once              one real pass (writes)
//   node scripts/run.js --setup Mar,Apr     prepare month tabs (extra columns, Source dropdown), then stop
const { configFromEnv, missingForRealRun } = require('../src/config');
const { createSheetsClient } = require('../src/google');
const { build, runOnce } = require('../src/run');
const { createCrm } = require('../src/crm');

async function main(argv) {
  const mode = argv.find(a => a.startsWith('--')) || '--help';
  if (mode === '--demo') return require('../src/demo').runDemo();
  if (!['--check', '--dry-run', '--once', '--setup'].includes(mode)) {
    console.log('Usage: node scripts/run.js --demo | --check | --dry-run | --once | --setup <Tab,Tab>');
    return;
  }

  const config = configFromEnv(process.env);
  const crm = createCrm(config.crm, config.settings);

  if (mode === '--check') {
    const { runCheck, formatReport } = require('../src/check');
    const sheets = config.credentials && config.spreadsheetId ? createSheetsClient(config.credentials) : null;
    const layout = sheets ? build(config, sheets).sync.layout : null;
    const result = await runCheck({ config, sheets, layout, crm });
    console.log(formatReport(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const missing = missingForRealRun(config);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} (try --demo first)`);
  const google = createSheetsClient(config.credentials);

  if (mode === '--setup') {
    const tabs = (argv[argv.indexOf('--setup') + 1] || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tabs.length) throw new Error('--setup needs tab names, e.g. --setup Mar,Apr');
    const { setup } = build(config, google);
    for (const tab of tabs) console.log(await setup.prepareTab(tab));
    return;
  }

  if (mode === '--dry-run') {
    const { cloneToMemory, snapshot, diff, formatDiff } = require('../src/dry-run');
    const { memory, title } = await cloneToMemory(google, config.spreadsheetId);
    const before = snapshot(memory);
    const { sync } = build(config, memory);
    const result = await runOnce({ config, sync, crm, state: {} });
    console.log(`Dry run on "${title}": nothing was written.\n`);
    console.log(formatDiff(await diff(before, memory, sync.layout)));
    console.log(`\nPass summary: ${JSON.stringify(result)}`);
    return;
  }

  const { sync } = build(config, google);
  console.log(JSON.stringify(await runOnce({ config, sync, crm, state: {} }), null, 2));
}

main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
