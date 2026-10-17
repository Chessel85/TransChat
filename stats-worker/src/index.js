// TransChat usage statistics. Browsers send anonymous reports to POST /event
// (with navigator.sendBeacon, so they get through as a page closes); GET /
// shows an accessible summary page.
//
// Reports (JSON, sent as text/plain so no CORS preflight is needed):
//   { type: 'start', room, langs }          the room's creator, on opening it
//   { type: 'leave', room, people, langs }  everyone, on leaving
// room: random hex ID (never the room code). people: most seen at once.
// langs: language codes of everyone seen in the room.

const TIME_ZONE = 'Europe/London';
const DAYS_SHOWN = 30;
const MAX_PEOPLE = 8;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === '/event' && request.method === 'POST') return recordEvent(request, env);
    if (url.pathname === '/' && request.method === 'GET') return statsPage(env);
    return new Response('Not found', { status: 404 });
  },
};

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };
}

// ---------- Recording ----------

async function recordEvent(request, env) {
  const body = await request.text();
  if (body.length > 2000) return new Response('Too large', { status: 413, headers: cors() });
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Bad JSON', { status: 400, headers: cors() });
  }
  const room = typeof event.room === 'string' && /^[0-9a-f]{16,32}$/.test(event.room) ? event.room : null;
  if (!room || !['start', 'leave'].includes(event.type)) return new Response('Bad event', { status: 400, headers: cors() });
  const people = Math.min(MAX_PEOPLE, Math.max(1, Math.floor(Number(event.people)) || 1));
  const langs = Array.isArray(event.langs)
    ? [...new Set(event.langs.filter(l => typeof l === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l)))].slice(0, MAX_PEOPLE)
    : [];
  const now = Date.now();

  const statements = [
    event.type === 'start'
      ? env.DB.prepare(`INSERT INTO rooms (id, started, ended, max_people) VALUES (?1, ?2, ?2, 1)
          ON CONFLICT(id) DO UPDATE SET started = COALESCE(started, excluded.started)`).bind(room, now)
      : env.DB.prepare(`INSERT INTO rooms (id, started, ended, max_people) VALUES (?1, NULL, ?2, ?3)
          ON CONFLICT(id) DO UPDATE SET ended = MAX(ended, excluded.ended), max_people = MAX(max_people, excluded.max_people)`).bind(room, now, people),
    ...langs.map(lang => env.DB.prepare('INSERT OR IGNORE INTO room_langs (room, lang) VALUES (?1, ?2)').bind(room, lang)),
  ];
  await env.DB.batch(statements);
  return new Response(null, { status: 204, headers: cors() });
}

// ---------- Stats page ----------

const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const english = new Intl.DisplayNames(['en'], { type: 'language' });

// Sortable "2026-10-17" for a time, in UK time.
function dayKey(ms) {
  const parts = Object.fromEntries(dayFormat.formatToParts(ms).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function languageName(code) {
  try { return english.of(code) ?? code; } catch { return code; }
}

function duration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under 1 minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function table(caption, headers, rows) {
  if (!rows.length) return `<p>${escape(caption)}: none yet.</p>`;
  const head = headers.map(h => `<th scope="col">${escape(h)}</th>`).join('');
  const body = rows.map(cells => `<tr><th scope="row">${escape(cells[0])}</th>${cells.slice(1).map(c => `<td>${escape(c)}</td>`).join('')}</tr>`).join('\n');
  return `<table>\n<caption>${escape(caption)}</caption>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

async function statsPage(env) {
  const since = Date.now() - DAYS_SHOWN * 86400000;
  const [{ results: rooms }, { results: langRows }, totals] = await Promise.all([
    env.DB.prepare('SELECT id, started, ended, max_people FROM rooms WHERE ended >= ?1').bind(since).all(),
    env.DB.prepare('SELECT l.room, l.lang FROM room_langs l JOIN rooms r ON r.id = l.room WHERE r.ended >= ?1').bind(since).all(),
    env.DB.prepare('SELECT COUNT(*) AS rooms, MIN(COALESCE(started, ended)) AS first FROM rooms').first(),
  ]);

  // Per day, by the day each room started.
  const days = new Map();
  for (const r of rooms) {
    const key = dayKey(r.started ?? r.ended);
    const day = days.get(key) ?? { label: dayLabel.format(r.started ?? r.ended), rooms: 0, durations: [], people: 0 };
    day.rooms++;
    if (r.started) day.durations.push(r.ended - r.started);
    day.people = Math.max(day.people, r.max_people);
    days.set(key, day);
  }
  const dayRows = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, d]) => {
    const avg = d.durations.length ? d.durations.reduce((a, b) => a + b, 0) / d.durations.length : null;
    return [d.label, d.rooms, avg === null ? 'unknown' : duration(avg), d.durations.length ? duration(Math.max(...d.durations)) : 'unknown', d.people];
  });

  // Room sizes.
  const sizes = new Map();
  for (const r of rooms) sizes.set(r.max_people, (sizes.get(r.max_people) ?? 0) + 1);
  const sizeRows = [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([n, count]) => [`${n} ${n === 1 ? 'person' : 'people'}`, count]);

  // Languages: how many rooms used each, and which combinations met.
  const byRoom = new Map();
  for (const { room, lang } of langRows) byRoom.set(room, [...(byRoom.get(room) ?? []), lang]);
  const langCounts = new Map();
  const combos = new Map();
  for (const list of byRoom.values()) {
    for (const lang of list) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
    const names = list.map(languageName).sort();
    const combo = names.length === 1 ? `${names[0]} only` : names.join(' + ');
    combos.set(combo, (combos.get(combo) ?? 0) + 1);
  }
  const byCount = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
  const langTable = [...langCounts.entries()].map(([code, n]) => [languageName(code), n]).sort(byCount);
  const comboTable = [...combos.entries()].sort(byCount);

  const allDurations = rooms.filter(r => r.started).map(r => r.ended - r.started);
  const summary = [
    `Rooms in the last ${DAYS_SHOWN} days: ${rooms.length}.`,
    allDurations.length ? `Average length: ${duration(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)}.` : '',
    `Rooms since records began: ${totals?.rooms ?? 0}${totals?.first ? `, starting ${dayLabel.format(totals.first)}` : ''}.`,
  ].filter(Boolean);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TransChat statistics</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fff; --line: #999; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #121212; --line: #666; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 1.125rem/1.5 system-ui, sans-serif; }
  main { max-width: 48rem; margin: 0 auto; padding: 1rem; }
  table { border-collapse: collapse; margin: 0.5rem 0 1.5rem; width: 100%; }
  caption { text-align: left; font-weight: bold; padding-bottom: 0.25rem; }
  th, td { border: 1px solid var(--line); padding: 0.25rem 0.5rem; text-align: left; }
</style>
</head>
<body>
<main>
<h1>TransChat statistics</h1>
<p>Anonymous counts only: no names, messages or room codes are recorded. Days are UK time. A room's length runs from when it was started until the last report from anyone in it, so it can be short if the last person's browser crashed.</p>
<h2>Summary</h2>
${summary.map(s => `<p>${escape(s)}</p>`).join('\n')}
<h2>Rooms per day</h2>
${table(`Rooms per day, last ${DAYS_SHOWN} days, newest first`, ['Day', 'Rooms', 'Average length', 'Longest', 'Most people'], dayRows)}
<h2>Room sizes</h2>
${table('Most people in a room at once', ['Size', 'Rooms'], sizeRows)}
<h2>Languages</h2>
${table('Rooms using each language', ['Language', 'Rooms'], langTable)}
${table('Language combinations in a room', ['Languages', 'Rooms'], comboTable)}
</main>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
