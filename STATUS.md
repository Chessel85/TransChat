# TransChat — status and next steps

Last updated: 2026-10-17. Read this first when picking the work back up; [design.md](design.md) has the full design.

## Where things are

- Live site: https://chessel85.github.io/TransChat/ (GitHub Pages from `main` of `Chessel85/TransChat`).
- Translator test page: https://chessel85.github.io/TransChat/diag.html (tests Chrome's built-in translator only).
- Built so far: two-person rooms over PeerJS, language picker, receiver-side translation, hidden polite live region for announcements, per-message `lang` attributes, Alt+1–9 re-read, Alt+Shift+1–9 original text, Alt+P / Alt+L / Alt+M, sound cues.
- Decisions: 2 people is the main case; desktop first; **translation must work in any browser** (2026-10-17).

## Translation (changed 2026-10-17)

- Main engine: Google Translate's free web endpoint (`translate.googleapis.com/translate_a/single?client=gtx`), the same kind of service NVDA's Instant Translate uses. No key; allows calls from any site. Unofficial, so Google could throttle (HTTP 429) or change it.
- Fallback: Chrome's built-in translator, only for language pairs already on the computer (no downloads, so no key-press step any more).
- On failure: original text shown as "not translated", the reason and the actual error detail are announced once; when translation works again, earlier untranslated messages are re-translated and "Translation is working again" is announced.
- This replaced Chrome-only translation, so the old open bug (fr→en failing in a same-profile two-tab Chrome test) no longer applies.
- Join screen, README and design.md now say messages are sent to Google Translate.

Tested automatically (Puppeteer, two separate browser contexts, local server): en↔fr both directions in Firefox and in Chrome; failure (Google blocked) and recovery in Chrome.

## Next steps

1. User retest on the live site with NVDA: Firefox and Chrome, ideally two computers or two browsers.
2. Screen-reader checks: do messages auto-read once, does the voice switch per `lang`, are own messages silent?
3. Consider widening the language list (it is still Chrome's original set; Google supports many more).
4. diag.html still only tests Chrome's built-in translator; update or retire it.

## Testing notes

- Automated test: Puppeteer two-context script (kept in the session scratchpad, not the repo); works with Firefox via `browser: 'firefox'`. Use node-side polling; `waitForFunction` stalls in background tabs.
- Both tabs in one profile share `localStorage`, so the second tab pre-fills the first tab's name.
- After deploying, reload with Ctrl+F5 to avoid a cached copy.
