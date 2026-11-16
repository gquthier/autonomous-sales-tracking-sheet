'use strict';
// Settings: secrets and ids come from the environment, the vocabulary of your sheet and CRM from a JSON file.
const fs = require('node:fs');
const path = require('node:path');
const { credentialsFromEnv } = require('./google');

const ROOT = path.join(__dirname, '..');

// Values written in the Outcome column. Change them to the exact words of your sheet's dropdown.
const DEFAULT_LABELS = {
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  noShow: 'No-Show',
  lost: "Offer & Didn't Buy",
  badFit: 'Bad Fit & No Offer',
  followUp: 'No Deposit & Follow-Up',
  fullPay: 'Full-Pay',
  splitPay: 'Split-Pay',
};

// Header names of the call table, as case-insensitive regular expressions. The service finds columns by header, not by letter.
const DEFAULT_HEADERS = {
  date: '^date$', name: '^name$', source: '^source$', booked: '^booked\\??$', outcome: '^outcome$',
  revenue: '^revenue$', cash: '^cash ?(collected)?$',
  video: '^video call', email: '^e-?mail$', phone: '^phone$', website: '^website$', meet: '^meet link$', answers: '^(form answers|question)$',
};

// utm_source / utm_medium -> value of the sheet's Source dropdown. First match wins; no match leaves the cell empty.
const DEFAULT_SOURCES = [
  { label: 'Facebook', source: 'meta|facebook|instagram|^fb$|^ig$', key: 'fbclid' },
  { label: 'Cold Call', any: 'cold.?call|setter|phoning' },
  { label: 'Email', any: 'e-?mail|instantly|lemlist|smartlead|newsletter' },
  { label: 'Linkedin', source: 'linkedin' },
  { label: 'YouTube', source: 'youtube' },
  { label: 'Referral', any: 'referral|parrain' },
];

const DEFAULTS = {
  timeZone: 'Europe/Paris',
  monthTabs: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  labels: DEFAULT_LABELS,
  headers: DEFAULT_HEADERS,
  sources: DEFAULT_SOURCES,
  extraColumns: [['Email', 190], ['Phone', 120], ['Website', 200], ['Meet Link', 210], ['Form Answers', 340]],
  addSourceOptions: [],
  team: { emailDomains: [], firstNames: [] },
  minProspectSegments: 5,
  phoneDigits: 9,
  crm: {},
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// config.json next to the repo, else the file named by SALES_SHEET_CONFIG, else the defaults above.
function loadSettings(env = process.env) {
  const file = env.SALES_SHEET_CONFIG || (fs.existsSync(path.join(ROOT, 'config.json')) ? path.join(ROOT, 'config.json') : null);
  const own = file ? readJson(path.resolve(file)) : {};
  return mergeSettings(own);
}

function mergeSettings(own = {}) {
  return {
    ...DEFAULTS,
    ...own,
    labels: { ...DEFAULT_LABELS, ...(own.labels || {}) },
    headers: { ...DEFAULT_HEADERS, ...(own.headers || {}) },
    team: { ...DEFAULTS.team, ...(own.team || {}) },
    crm: { ...(own.crm || {}) },
  };
}

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

function configFromEnv(env = process.env, settings = loadSettings(env)) {
  return {
    settings,
    credentials: credentialsFromEnv(env),
    spreadsheetId: env.SPREADSHEET_ID || '',
    iclosedKey: env.ICLOSED_API_KEY || '',
    eventIds: list(env.ICLOSED_EVENT_IDS),
    fathomKeys: list(env.FATHOM_API_KEYS),
    timeZone: env.SHEET_TIME_ZONE || settings.timeZone,
    // Calls before this date are never written. Unset: only LOOKBACK_DAYS limits the window.
    syncSince: new Date(env.SYNC_SINCE || 0),
    lookbackDays: num(env.LOOKBACK_DAYS, 21),
    pollSeconds: num(env.POLL_SECONDS, 120),
    outcomeMinutes: num(env.OUTCOME_MINUTES, 10),
    outcomeWaitHours: num(env.OUTCOME_WAIT_HOURS, 3),
    // Calls from this date with no recording at all count as No-Show. Empty: a missing recording proves nothing.
    absentIfNoRecordingFrom: env.ABSENT_IF_NO_RECORDING_FROM || '',
    crm: { adapter: env.CRM_ADAPTER || 'none', jsonFile: env.CRM_JSON_FILE || '', httpUrl: env.CRM_HTTP_URL || '', httpToken: env.CRM_HTTP_TOKEN || '' },
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || '',
    alertAfterFailures: num(env.ALERT_AFTER_FAILURES, 3),
  };
}

function missingForRealRun(config) {
  const missing = [];
  if (!config.credentials) missing.push('GOOGLE_SERVICE_ACCOUNT_B64 or GOOGLE_SERVICE_ACCOUNT_FILE');
  if (!config.spreadsheetId) missing.push('SPREADSHEET_ID');
  if (!config.iclosedKey) missing.push('ICLOSED_API_KEY');
  return missing;
}

module.exports = { configFromEnv, loadSettings, mergeSettings, missingForRealRun, DEFAULT_LABELS, DEFAULT_HEADERS, DEFAULT_SOURCES, DEFAULTS, ROOT };
