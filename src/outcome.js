'use strict';
// Outcome of a past call, decided from two sources:
// - the call recorder (Fathom): who spoke in the recording (the prospect came, or the closer waited alone);
// - the CRM: what the team decided for the prospect afterwards (lost, follow-up, won). See crm.js for the statuses.
// Each decision is { outcome: label | null, revenue?, came: true | false | null }. outcome null = nothing to say yet,
// the closer fills it. came = what the recording shows (null: no recording), used to flag hand-typed values it contradicts.
const { DEFAULT_LABELS } = require('./config');
const { norm } = require('./crm');

const HOUR = 36e5;
const emailKey = s => String(s ?? '').trim().toLowerCase();
const digits = (s, n) => String(s ?? '').replace(/\D/g, '').slice(-n);

// Transcript segments spoken by people who are not the host nor the team (by e-mail domain, else by first name).
function outsideVoices(rec, { emailDomains = [], firstNames = [] } = {}) {
  const domains = [emailKey(rec.hostEmail).split('@')[1], ...emailDomains.map(emailKey)].filter(Boolean);
  const names = [norm(rec.hostName), ...firstNames.map(norm)].filter(Boolean).map(n => n.split(' ')[0]);
  let n = 0;
  for (const v of rec.voices || []) {
    const email = emailKey(v.email);
    const team = email ? domains.includes(email.split('@')[1]) : names.includes(norm(v.name).split(' ')[0]);
    if (!team) n += v.segments;
  }
  return n;
}

// The CRM card of the call's prospect: same e-mail, else same phone (last N digits).
function leadFor(call, leads, phoneDigits = 9) {
  const email = emailKey(call.email), phone = digits(call.phone, phoneDigits);
  return leads.find(l => email && emailKey(l.email) === email)
    || leads.find(l => phone.length === phoneDigits && digits(l.phone, phoneDigits) === phone)
    || null;
}

function decideOutcome({ call, rec = null, lead = null, latest = true, now, waitHours = 3, noRecordingFrom = null, team = {}, labels = DEFAULT_LABELS, minSegments = 5 }) {
  if (call.cancelled) return null;
  const start = new Date(call.start).getTime();
  if (start + waitHours * HOUR > now) return null; // the recorder and the team need a little time after the call
  const came = rec ? outsideVoices(rec, team) >= minSegments : null;
  const alone = came === false;
  const say = (outcome, extra = {}) => ({ outcome, ...extra, came });
  // The CRM speaks for the prospect's latest call only: an older booking of the same person is not what the team qualified.
  if (lead && latest) {
    if (lead.status === 'won') return say(lead.split ? labels.splitPay : labels.fullPay, { revenue: lead.amount ?? null });
    if (lead.status === 'no_show') return say(labels.noShow);
    if (!alone) { // "lost" while the closer was alone on the call: the prospect never came, it is a no-show
      if (lead.status === 'lost') return say(labels.lost);
      if (lead.status === 'bad_fit') return say(labels.badFit);
      if (lead.status === 'follow_up') return say(labels.followUp);
    }
  }
  if (alone) return say(labels.noShow);
  if (!rec && noRecordingFrom && start >= new Date(noRecordingFrom).getTime()) return say(labels.noShow);
  return say(null);
}

// One decision per booking key (`id@start`), for the calls that are over.
function decideAll({ calls, picked, leads = [], now, waitHours = 3, phoneDigits = 9, ...opts }) {
  const live = calls.filter(c => !c.cancelled);
  const samePerson = (a, b) => (a.email && emailKey(a.email) === emailKey(b.email))
    || (digits(a.phone, phoneDigits).length === phoneDigits && digits(a.phone, phoneDigits) === digits(b.phone, phoneDigits));
  const decisions = new Map();
  for (const call of live) {
    if (new Date(call.start).getTime() + waitHours * HOUR > now) continue;
    const key = `${call.id}@${call.start}`;
    const latest = !live.some(o => o !== call && o.start > call.start && samePerson(call, o));
    decisions.set(key, decideOutcome({ call, rec: picked.get(key) || null, lead: leadFor(call, leads, phoneDigits), latest, now, waitHours, ...opts }));
  }
  return decisions;
}

module.exports = { decideOutcome, decideAll, outsideVoices, leadFor };
