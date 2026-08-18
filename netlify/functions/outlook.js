// Netlify Function: reads the published Outlook calendar feed.
//
// Set OUTLOOK_ICS_URL in Netlify: Site settings > Environment variables.
// That URL is unauthenticated — anyone holding it can read the calendar — so it
// lives here on the server and is never sent to the browser.
//
// Nothing is written to Blobs or anywhere else. Events are fetched, parsed, and
// returned for this page load only.

const { checkAuth } = require('./_auth');

// How far around today we expand recurring meetings.
const DAYS_BACK = 120;
const DAYS_FORWARD = 400;
const MAX_OCCURRENCES = 400;

// ---------- ICS text helpers ----------

// Long ICS lines wrap onto continuation lines starting with a space or tab.
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

// "DTSTART;TZID=Mountain Standard Time:20260818T090000" ->
//   { name:'DTSTART', params:{TZID:'Mountain Standard Time'}, value:'20260818T090000' }
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const bits = left.split(';');
  const name = bits[0].toUpperCase();
  const params = {};
  for (let i = 1; i < bits.length; i++) {
    const eq = bits[i].indexOf('=');
    if (eq === -1) continue;
    params[bits[i].slice(0, eq).toUpperCase()] = bits[i].slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

// ---------- date parts ----------
// Kept as plain parts rather than Date objects so we never accidentally shift a
// wall-clock time into the server's timezone. UTC values keep the Z; floating
// and TZID values stay as written and are treated as local time by the browser.

function parseDT(value, params) {
  const v = String(value || '').trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const dateOnly = !m[4] || (params && params.VALUE === 'DATE');
  return {
    y: +m[1], mo: +m[2], d: +m[3],
    h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0),
    utc: m[7] === 'Z',
    dateOnly,
  };
}

function toMs(p) { return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s); }

function fromMs(ms, proto) {
  const d = new Date(ms);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
    utc: proto.utc, dateOnly: proto.dateOnly,
  };
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }

function fmt(p) {
  const date = `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
  if (p.dateOnly) return date;
  return `${date}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${p.utc ? 'Z' : ''}`;
}

// Same calendar day, shifted by n days.
function addDays(p, n) { return fromMs(toMs(p) + n * 86400000, p); }

function addMonths(p, n) {
  let mo = p.mo - 1 + n;
  const y = p.y + Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  // Clamp so 31 Jan + 1 month lands on 28/29 Feb rather than rolling into March.
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return { ...p, y, mo: mo + 1, d: Math.min(p.d, lastDay) };
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------- recurrence ----------

function parseRRule(value) {
  const out = {};
  String(value || '').split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  });
  return out;
}

// Expands a recurring event into concrete start times inside [winStart, winEnd].
// Handles the patterns Outlook actually produces for meetings: daily, weekly
// (with BYDAY), monthly, and yearly, plus INTERVAL / COUNT / UNTIL.
function expandRecurrence(start, rrule, winStartMs, winEndMs) {
  const freq = (rrule.FREQ || '').toUpperCase();
  const interval = Math.max(1, parseInt(rrule.INTERVAL, 10) || 1);
  const count = rrule.COUNT ? parseInt(rrule.COUNT, 10) : null;
  const untilParts = rrule.UNTIL ? parseDT(rrule.UNTIL, {}) : null;
  const untilMs = untilParts ? toMs(untilParts) : null;

  const results = [];
  let emitted = 0;
  let guard = 0;

  const emit = (p) => {
    const ms = toMs(p);
    if (untilMs !== null && ms > untilMs) return false;
    emitted++;
    if (count !== null && emitted > count) return false;
    if (ms >= winStartMs && ms <= winEndMs) results.push(p);
    return true;
  };

  if (freq === 'WEEKLY') {
    const days = (rrule.BYDAY || '')
      .split(',')
      .map((s) => s.replace(/^[-+]?\d+/, '').toUpperCase())
      .filter((s) => WEEKDAYS.includes(s));
    const dow = days.length ? days : [WEEKDAYS[new Date(toMs(start)).getUTCDay()]];
    // Back up to the Sunday of the start's week, then step week by week.
    let weekStart = addDays(start, -new Date(toMs(start)).getUTCDay());
    const startMs = toMs(start);
    while (guard++ < 2000) {
      for (const code of dow) {
        const p = addDays(weekStart, WEEKDAYS.indexOf(code));
        const ms = toMs(p);
        if (ms < startMs) continue;
        if (!emit(p)) return results;
      }
      weekStart = addDays(weekStart, 7 * interval);
      if (toMs(weekStart) > winEndMs) break;
      if (results.length > MAX_OCCURRENCES) break;
    }
    return results;
  }

  let cur = start;
  let step = 0;
  while (guard++ < 2000) {
    if (toMs(cur) > winEndMs) break;
    if (!emit(cur)) break;
    if (results.length > MAX_OCCURRENCES) break;
    step++;
    // Always measured from the original start, so a meeting on the 31st doesn't
    // creep backwards through months that are shorter.
    if (freq === 'DAILY') cur = addDays(start, interval * step);
    else if (freq === 'MONTHLY') cur = addMonths(start, interval * step);
    else if (freq === 'YEARLY') cur = addMonths(start, 12 * interval * step);
    else break; // unknown frequency — treat as a one-off
  }
  return results;
}

// ---------- parse the feed ----------

function parseICS(text, winStartMs, winEndMs) {
  const lines = unfold(text).split('\n');
  const bases = [];
  const overrides = []; // modified instances of a recurring series

  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (cur) (cur.recurrenceId ? overrides : bases).push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    const p = parseLine(line);
    if (!p) continue;

    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'STATUS': cur.status = p.value.toUpperCase(); break;
      case 'DTSTART': cur.start = parseDT(p.value, p.params); break;
      case 'DTEND': cur.end = parseDT(p.value, p.params); break;
      case 'RRULE': cur.rrule = parseRRule(p.value); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDT(p.value, p.params); break;
      case 'EXDATE':
        p.value.split(',').forEach((v) => {
          const d = parseDT(v, p.params);
          if (d) cur.exdates.push(fmt(d));
        });
        break;
      default: break;
    }
  }

  // A moved or edited instance replaces the generated one at its original time.
  const overrideKeys = new Set();
  overrides.forEach((o) => { if (o.uid && o.recurrenceId) overrideKeys.add(o.uid + '|' + fmt(o.recurrenceId)); });

  const out = [];

  const push = (ev, startParts) => {
    if (!startParts) return;
    // Preserve each occurrence's duration rather than reusing the first end time.
    let endParts = null;
    if (ev.end && ev.start) {
      const dur = toMs(ev.end) - toMs(ev.start);
      endParts = fromMs(toMs(startParts) + dur, ev.end);
    }
    out.push({
      uid: ev.uid || '',
      title: ev.title || '(no title)',
      location: ev.location || '',
      allDay: !!startParts.dateOnly,
      start: fmt(startParts),
      end: endParts ? fmt(endParts) : null,
    });
  };

  bases.forEach((ev) => {
    if (ev.status === 'CANCELLED') return;
    if (!ev.start) return;

    if (ev.rrule) {
      const occurrences = expandRecurrence(ev.start, ev.rrule, winStartMs, winEndMs);
      occurrences.forEach((p) => {
        const key = fmt(p);
        if (ev.exdates.includes(key)) return;
        if (ev.uid && overrideKeys.has(ev.uid + '|' + key)) return;
        push(ev, p);
      });
    } else {
      const ms = toMs(ev.start);
      if (ms >= winStartMs && ms <= winEndMs) push(ev, ev.start);
    }
  });

  overrides.forEach((ev) => {
    if (ev.status === 'CANCELLED') return;
    if (!ev.start) return;
    const ms = toMs(ev.start);
    if (ms >= winStartMs && ms <= winEndMs) push(ev, ev.start);
  });

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

// ---------- handler ----------

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const denied = checkAuth(event);
  if (denied) return denied;

  const url = process.env.OUTLOOK_ICS_URL;
  if (!url) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'not_configured',
        message: 'No calendar connected. Add OUTLOOK_ICS_URL in Netlify site settings, then redeploy.',
      }),
    };
  }

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Dispatch/1.0' } });
    if (!resp.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'feed_error',
          message: `Outlook returned ${resp.status}. The calendar may have been unpublished.`,
        }),
      };
    }

    const text = await resp.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'bad_feed', message: 'That URL did not return a calendar feed.' }),
      };
    }

    const now = Date.now();
    const events = parseICS(text, now - DAYS_BACK * 86400000, now + DAYS_FORWARD * 86400000);

    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ events, fetchedAt: new Date().toISOString() }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'fetch_failed', message: e.message || 'Unknown error' }) };
  }
};
