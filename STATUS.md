# TransChat — status and next steps

Last updated: 2026-10-17. Read this first when picking the work back up; [design.md](design.md) has the full design.

## Where things are

- Live site: https://chessel85.github.io/TransChat/ (GitHub Pages from `main` of `Chessel85/TransChat`).
- Translator test page: https://chessel85.github.io/TransChat/diag.html (tests Chrome's built-in translator only).
- Built so far: rooms of up to 8 equal people over PeerJS (see below), language picker, receiver-side translation, hidden polite live region for announcements, per-message `lang` attributes, Alt+1–9 re-read, Alt+Shift+1–9 original text, Alt+P / Alt+L / Alt+M, sound cues.
- Decisions: rooms of up to 8 equal people, no host (2026-10-17); desktop first; **translation must work in any browser** (2026-10-17).
- Footer shows "Web site published …" from the page's Last-Modified header, to spot a cached old copy.

## Rooms (changed 2026-10-17, v0.2.0)

- Everyone connects directly to everyone. The room code is held by a "doorkeeper" browser that only tells newcomers who is there; when it leaves, the others take the code over automatically, so the room lasts until the last person leaves. Details in design.md §6.
- Peer ID prefix changed to `transchat-v2-`, so old cached pages can't mix with new ones.
- Tested automatically (Puppeteer, local server): 3 people in en/fr/de with translations both ways; first person leaves by button, by closing the tab, and by freezing; newcomer joins after the hand-over (1–4 s after leave/close, about 80 s after a freeze); 8 people incl. simultaneous joins, 9th refused; wrong code reported after about 14 s. Chrome and Firefox.
- Live-region fix: Chrome re-read all old announcements when the oldest was removed; now earlier announcements are cleared together with the next one. Verified with NVDA in Chrome.

## Translation (changed 2026-10-17)

- Main engine: Google Translate's free web endpoint (`translate.googleapis.com/translate_a/single?client=gtx`), the same kind of service NVDA's Instant Translate uses. No key; allows calls from any site. Unofficial, so Google could throttle (HTTP 429) or change it.
- Fallback: Chrome's built-in translator, only for language pairs already on the computer (no downloads, so no key-press step any more).
- On failure: original text shown as "not translated", the reason and the actual error detail are announced once; when translation works again, earlier untranslated messages are re-translated and "Translation is working again" is announced.
- This replaced Chrome-only translation, so the old open bug (fr→en failing in a same-profile two-tab Chrome test) no longer applies.
- Join screen, README and design.md now say messages are sent to Google Translate.

Tested automatically (Puppeteer, two separate browser contexts, local server): en↔fr both directions in Firefox and in Chrome; failure (Google blocked) and recovery in Chrome.

## Next steps

1. User retest of group rooms with NVDA on the live site: 3+ people, the first person leaving, someone joining afterwards.
2. Screen-reader checks: do messages auto-read once, does the voice switch per `lang`, are own messages silent?
3. Consider widening the language list (it is still Chrome's original set; Google supports many more).
4. diag.html still only tests Chrome's built-in translator; update or retire it.

## Testing notes

- Automated test: Puppeteer two-context script (kept in the session scratchpad, not the repo); works with Firefox via `browser: 'firefox'`. Use node-side polling; `waitForFunction` stalls in background tabs.
- Both tabs in one profile share `localStorage`, so the second tab pre-fills the first tab's name.
- After deploying, reload with Ctrl+F5 to avoid a cached copy.
