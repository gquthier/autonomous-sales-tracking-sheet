'use strict';
// One pass of the service: bookings first, then recording links, then (every few minutes) the outcomes.
const { createSheetsClient } = require('./google');
const { createSync } = require('./sync');
const { createSetup } = require('./setup');
const { fetchCalls } = require('./iclosed');
const { fetchRecordings, matchRecordings } = require('./fathom');
const { decideAll } = require('./outcome');

const DAY = 864e5;

// The sync and the tab preparation share one Sheets client; the sync prepares a month tab before its first row.
function build(config, sheets = createSheetsClient(config.credentials), { logger = console, now } = {}) {
  const s = config.settings;
  const common = { sheets, spreadsheetId: config.spreadsheetId, timeZone: config.timeZone, monthTabs: s.monthTabs, labels: s.labels, headers: s.headers, logger, ...(now ? { now } : {}) };
  const reader = createSync(common);
  const setup = createSetup({ sheets, spreadsheetId: config.spreadsheetId, layout: reader.layout, extraColumns: s.extraColumns, addSourceOptions: s.addSourceOptions });
  const sync = createSync({ ...common, prepareTab: tab => setup.prepareTab(tab) });
  return { sync, setup, sheets };
}

async function runOnce({ config, sync, crm = null, fetchImpl = fetch, now = () => Date.now(), logger = console, state = {} }) {
  const s = config.settings;
  const recorder = config.fathomKeys.length > 0;
  const from = new Date(Math.max(config.syncSince.getTime(), now() - config.lookbackDays * DAY));
  const calls = await fetchCalls({ apiKey: config.iclosedKey, eventIds: config.eventIds, from, to: new Date(now() + 180 * DAY), sources: s.sources, fetchImpl });
  const out = { calls: calls.length, ...(await sync.syncCalls(calls)) };

  if (recorder) {
    const recs = await fetchRecordings({ apiKeys: config.fathomKeys, since: from, fetchImpl, logger });
    Object.assign(out, await sync.syncRecordings(calls.filter(c => new Date(c.start).getTime() < now() + 15 * 60e3), recs));
  }

  // Outcomes need at least one witness: the recorder (who spoke) or the CRM (what was decided).
  const due = now() - (state.lastOutcomes || 0) >= config.outcomeMinutes * 60e3;
  if ((recorder || (crm && crm.enabled)) && due) {
    state.lastOutcomes = now();
    let leads = [];
    if (crm && crm.enabled) {
      try { leads = await crm.fetchLeads(); }
      catch (e) { // CRM down: no guess, retry next pass
        logger.error('CRM read failed', e.message.slice(0, 120));
        state.lastOutcomes = 0;
        return { ...out, crmError: e.message.slice(0, 120) };
      }
    }
    const voiced = recorder ? await fetchRecordings({ apiKeys: config.fathomKeys, since: from, withVoices: true, fetchImpl, logger }) : [];
    const past = calls.filter(c => new Date(c.start).getTime() < now());
    const decisions = decideAll({
      calls: past, picked: matchRecordings(past, voiced), leads, now: now(),
      waitHours: config.outcomeWaitHours,
      noRecordingFrom: recorder ? config.absentIfNoRecordingFrom || null : null, // without a recorder, a missing recording proves nothing
      team: s.team, labels: s.labels, minSegments: s.minProspectSegments, phoneDigits: s.phoneDigits,
    });
    Object.assign(out, await sync.syncOutcomes(decisions));
  }
  return out;
}

module.exports = { build, runOnce };
