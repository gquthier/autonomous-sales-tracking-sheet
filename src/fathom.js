'use strict';
// Read-only Fathom client (one or several accounts) + matching of recordings to booked calls.
const { meetCode } = require('./iclosed');

const MIN = 60_000;
const domainOf = email => String(email || '').split('@')[1] || '';

// withVoices: also read the transcripts to know who spoke (heavier, used by the outcome pass only).
async function fetchRecordings({ apiKeys = [], since, withVoices = false, fetchImpl = fetch, logger = console }) {
  const out = [];
  for (const [index, key] of apiKeys.entries()) {
    let cursor = null;
    try {
      for (let page = 0; page < 20; page += 1) {
        const query = new URLSearchParams({ created_after: new Date(since).toISOString() });
        if (withVoices) query.set('include_transcript', 'true');
        if (cursor) query.set('cursor', cursor);
        const res = await fetchImpl(`https://api.fathom.ai/external/v1/meetings?${query}`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Fathom ${res.status}`);
        const body = await res.json();
        for (const m of body.items || []) {
          const start = new Date(m.recording_start_time || m.scheduled_start_time || m.created_at || '');
          const end = new Date(m.recording_end_time || '');
          const link = m.share_url || m.url;
          if (!link || !Number.isFinite(start.getTime())) continue;
          const host = String(m.recorded_by?.email || '').toLowerCase();
          const rec = {
            id: String(m.recording_id ?? link),
            link,
            start: start.toISOString(),
            minutes: Number.isFinite(end.getTime()) ? Math.max(0, (end - start) / MIN) : 0,
            meetCode: meetCode(m.meeting_url),
            // Guests from outside the host's company: the prospect's address, used to match the booking.
            emails: (m.calendar_invitees || []).map(i => String(i.email || '').toLowerCase()).filter(e => e && e !== host && domainOf(e) !== domainOf(host)),
            account: index + 1,
          };
          if (withVoices) {
            const voices = new Map();
            for (const t of m.transcript || []) {
              const name = String(t.speaker?.display_name || ''), email = String(t.speaker?.matched_calendar_invitee_email || '').toLowerCase();
              const k = `${name}|${email}`;
              voices.set(k, { name, email, segments: (voices.get(k)?.segments || 0) + 1 });
            }
            Object.assign(rec, { hostEmail: host, hostName: String(m.recorded_by?.name || ''), voices: [...voices.values()] });
          }
          out.push(rec);
        }
        cursor = body.next_cursor || null;
        if (!cursor) break;
      }
    } catch (e) { logger.error(`Fathom account #${index + 1} failed`, e.message.slice(0, 120)); } // one account down must not block the others
  }
  return out;
}

// One recording per call: the Meet room first, then an external guest's e-mail, then the hour.
// Several recordings of the same call (cut, restarted): the longest one wins.
function matchRecordings(calls, recordings, { before = 15 * MIN, after = 30 * MIN } = {}) {
  const gap = (c, r) => Math.abs(new Date(r.start) - new Date(c.start));
  const nearest = (list, r) => list.slice().sort((a, b) => gap(a, r) - gap(b, r))[0];
  const keyOf = c => `${c.id}@${c.start}`;
  const picked = new Map();
  const keep = (call, rec) => { const cur = picked.get(keyOf(call)); if (!cur || rec.minutes > cur.minutes) picked.set(keyOf(call), rec); };
  const live = calls.filter(c => !c.cancelled);
  const loose = [];
  for (const rec of recordings) {
    const byRoom = rec.meetCode ? live.filter(c => c.meetCode === rec.meetCode) : [];
    if (byRoom.length) { keep(nearest(byRoom, rec), rec); continue; }
    const byMail = rec.emails.length ? live.filter(c => c.email && rec.emails.includes(c.email)) : [];
    if (byMail.length) { keep(nearest(byMail, rec), rec); continue; }
    loose.push(rec);
  }
  // By the hour: only when it is unambiguous on both sides, and the call has nothing better.
  const within = (t, s) => t >= s - before && t <= s + after;
  for (const rec of loose) {
    const t = new Date(rec.start).getTime();
    const near = live.filter(c => within(t, new Date(c.start).getTime()));
    if (near.length !== 1) continue;
    const call = near[0], s = new Date(call.start).getTime();
    const rivals = loose.filter(r => within(new Date(r.start).getTime(), s));
    if (picked.has(keyOf(call)) && !rivals.includes(picked.get(keyOf(call)))) continue;
    keep(call, rec);
  }
  return picked;
}

module.exports = { fetchRecordings, matchRecordings };
