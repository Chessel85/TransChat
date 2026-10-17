// Anonymous usage reports to the TransChat stats Worker (see stats-worker/).
// Only a random room ID, room size and language codes: no names, messages or
// room codes. sendBeacon still gets through while the page is closing.

const STATS_URL = 'https://transchat-stats.ckgoodwin85.workers.dev/event';

export function report(event) {
  try {
    navigator.sendBeacon(STATS_URL, JSON.stringify(event));
  } catch { /* statistics are optional */ }
}
