# TransChat — status and next steps

Last updated: 2026-10-16. Read this first when picking the work back up; [design.md](design.md) has the full design.

## Where things are

- Live site: https://chessel85.github.io/TransChat/ (GitHub Pages from `main` of `Chessel85/TransChat`).
- Translator test page: https://chessel85.github.io/TransChat/diag.html (tests one language pair in isolation).
- Built so far (v0.1): two-person rooms over PeerJS, language picker, receiver-side translation with Chrome's built-in Translator API only, hidden polite live region for announcements, per-message `lang` attributes, Alt+1–9 re-read, Alt+Shift+1–9 original text, Alt+P / Alt+L / Alt+M, sound cues.
- Decisions: 2 people is the main case; desktop first; built-in browser translator only until its quality is judged.

## Fixed

- **Language pack never downloaded.** TransChat called `Translator.create()` without a user action when the peer joined; Chrome left it hanging, so the download offer never appeared. Now packs are only requested from a key press in the message box or the Download button, and messages that arrived earlier are re-translated once ready. (Commit "Only download language packs after a key press or click".)

## Open problem (pick up here)

User's manual test on one machine, two Chrome tabs/windows, same profile:

- Tab 1: "Chessel", English. Tab 2: "Ralph", French.
- Chessel → Ralph: **translated correctly** (en→fr on Ralph's side worked).
- Ralph → Chessel: **not translated**; Chessel's side reported an error that the translator could not be loaded (exact wording not captured).

Working theory: Chrome limits on-device translation when two tabs in the same profile each need a different pair at the same time (en→fr in one, fr→en in the other). In an automated two-tab test, Chrome logged the undocumented error "The translation service count exceeded the limitation". Not yet confirmed. Note the automated en↔es test later worked in both directions, so it may be pair-, timing- or download-order-specific.

Next steps:

1. Make failures diagnosable: include the browser's actual error name/message in the spoken announcement and the visible status (currently the `failed` path in `translate.js` only logs it to the console).
2. Retest with the second person in a **separate Chrome profile or a Guest window**, then on a **second computer** — the real use case is two machines, so a same-profile limit may not matter in practice.
3. Retest the same en↔fr pair on diag.html in both directions (fr→en as well as en→fr) to rule out the pair itself.
4. If it is a concurrency limit: add a retry (on failure, offer "Retry translation" via key press, and retry once automatically after a short delay), and document "use two computers or two profiles" for testing.
5. Then continue with screen-reader testing (NVDA first): do messages auto-read once, does the voice switch per `lang`, are own messages silent?

## Testing notes

- Local automated test: Puppeteer two-tab script (kept in the session scratchpad, not the repo). Use `--disable-background-timer-throttling` and node-side polling; `waitForFunction` stalls in background tabs.
- Both tabs in one profile share `localStorage`, so the second tab pre-fills the first tab's name.
- After deploying, reload with Ctrl+F5 to avoid a cached copy.
