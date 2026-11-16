'use strict';
// Read-only iClosed client: bookings of your sales calendars, normalised for the sheet.
// Another booking tool? Write a fetchCalls() that returns the same objects as normalizeCall(), the rest does not change.
const { DEFAULT_SOURCES } = require('./config');

const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const meetCode = url => (/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i.exec(url || '') || [])[1]?.toLowerCase() || null;

function utmOf(row) {
  const out = {};
  for (const u of Array.isArray(row.utm) ? row.utm : []) if (u && typeof u.utmKey === 'string') out[u.utmKey.toLowerCase()] = clean(String(u.utmValue ?? ''));
  return out;
}

// Value of the sheet's Source dropdown. Unknown stays empty: the closer picks it.
function resolveSource(utm = {}, rules = DEFAULT_SOURCES) {
  const s = (utm.utm_source || '').toLowerCase(), m = (utm.utm_medium || '').toLowerCase();
  for (const r of rules) {
    if (r.source && new RegExp(r.source, 'i').test(s)) return r.label;
    if (r.medium && new RegExp(r.medium, 'i').test(m)) return r.label;
    if (r.any && new RegExp(r.any, 'i').test(`${s} ${m}`)) return r.label;
    if (r.key && utm[r.key.toLowerCase()]) return r.label;
  }
  return '';
}

// Questions already in their own column, or useless in a sales sheet.
const SKIP_ANSWERS = /^(phone number|first name|last name|email|set by|call outcome|no sale reason)$/i;
function answerText(a) {
  if (Array.isArray(a)) return a.map(x => clean(String(x?.answer ?? x?.number ?? ''))).filter(Boolean).join(', ');
  return clean(String(a ?? ''));
}

function normalizeCall(row, { sources = DEFAULT_SOURCES } = {}) {
  const website = (row.secondaryAnswers || []).find(q => q.customFieldIdentifier === 'website' || /site|web|url/i.test(q.statement || ''));
  const answers = [];
  for (const q of [...(row.questions || []), ...(row.secondaryAnswers || [])]) {
    const statement = clean(q.statement), text = answerText(q.answer);
    if (!statement || !text || SKIP_ANSWERS.test(statement) || q === website) continue;
    answers.push(`${statement.replace(/\s*\?$/, '')} : ${text}`);
  }
  const name = clean(row.inviteeName) || clean([row.firstName, row.lastName].filter(Boolean).join(' ')) || clean(row.inviteeEmail) || 'Unknown';
  const start = new Date(row.dateTimeUTC || '');
  return {
    id: String(row.callId ?? row.id ?? ''),
    eventId: String(row.eventId ?? ''),
    start: Number.isFinite(start.getTime()) ? start.toISOString() : null,
    name,
    email: clean(row.inviteeEmail || row.contact?.email).toLowerCase(),
    phone: clean(row.phoneNumber || row.contact?.phoneNumber),
    website: website ? answerText(website.answer) : '',
    meetLink: clean(row.locationLink || row.locationLinkInvitee),
    meetCode: meetCode(row.locationLink || row.locationLinkInvitee),
    source: resolveSource(utmOf(row), sources),
    answers: answers.join(' · '),
    cancelled: Boolean(clean(row.deletedAt) || clean(row.cancelledBy) || clean(row.cancelReason)),
  };
}

// eventIds empty = every calendar of the account (used by the check to find calendars you forgot to list).
async function fetchCalls({ apiKey, base = 'https://public.api.iclosed.io/v1', eventIds = [], from, to, sources, fetchImpl = fetch }) {
  const date = d => new Date(d).toISOString().slice(0, 10);
  const rows = [];
  for (let page = 0; page < 30; page += 1) {
    const query = new URLSearchParams({ eventType: 'ALL', dateFrom: date(from), dateTo: date(to), limit: '100', page: String(page) });
    if (eventIds.length) query.set('eventIds', eventIds.join(','));
    const res = await fetchImpl(`${base}/eventCalls?${query}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw Object.assign(new Error(`iClosed ${res.status}`), { status: res.status });
    const batch = (await res.json())?.data?.eventCalls || [];
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  const allowed = new Set(eventIds.map(String));
  return rows.map(r => normalizeCall(r, { sources })).filter(c => c.id && c.start && (!allowed.size || allowed.has(c.eventId)));
}

module.exports = { fetchCalls, normalizeCall, resolveSource, meetCode };
