# TransChat — Design

A browser-based text chat for two or more blind people who speak different languages.
Each person reads and writes only in their own language; the app translates in between
and speaks everything through the user's own screen reader.

Hosted as static files on GitHub Pages. No server of our own.

---

## 1. Goals and non-goals

**Goals**

- Fully usable with a screen reader and keyboard alone (NVDA, JAWS, Narrator, VoiceOver on Mac/iOS, TalkBack).
- Each person picks their language once; they never have to know or choose anyone else's.
- Works for 2 people first, and for small groups (up to ~8) where everyone may speak a different language.
- Zero cost, zero install, zero accounts: open a link, type your name, chat.
- Nothing stored on any server; chat history lives only in the open browser tabs.

**Non-goals (for v1)**

- Voice/video calls, file sharing, message history across sessions, large public rooms.
- Perfect translation. Machine translation will make mistakes; the design gives people tools to notice and recover (see §5.4).

---

## 2. What changes from the Gemini outline

The Gemini outline is a sound starting point (GitHub Pages + PeerJS/WebRTC + translation API + ARIA live region). I'm keeping that skeleton but changing four things:

| Topic | Gemini outline | This design | Why |
|---|---|---|---|
| Who translates | **Sender** translates into the recipient's language | **Each receiver** translates into their own language | With 3+ people speaking 3+ languages, sender-side would need one translation per language per message. Receiver-side is always exactly one translation per reader, and each person's language stays private to their own browser. |
| Language choice | Not addressed | Chosen on the join screen, defaulted from the browser/OS language, remembered for next time, shared in the join handshake | Your point — this was the missing piece. Details in §4. |
| Translation engine | Public REST API only | Google Translate's free web endpoint (as NVDA Instant Translate uses), with the browser's built-in translator as a fallback | Works in every browser with no key or downloads; good quality. See §5.1. |
| Screen reader voice | Not addressed | Every message element carries a `lang` attribute | Screen readers switch to the correct voice/pronunciation based on `lang`. Without it, NVDA reading Spanish text with an English voice is nearly unintelligible. Critical for this audience. |

---

## 3. Architecture overview

```
 ┌──────────────── Browser A (English) ────────────────┐          ┌──────────── Browser B (Spanish) ────────────┐
 │  UI (semantic HTML + ARIA)                          │          │  UI                                         │
 │  ├─ Message input  ──► "Hello"                      │          │                                             │
 │  │                                                  │          │                                             │
 │  ├─ Protocol: {type:"chat", text:"Hello", lang:"en"}│ ─WebRTC─►│  Protocol receives message                  │
 │  │                                                  │ data     │  ├─ Translator: en → es  ("Hola")           │
 │  │                                                  │ channel  │  └─ Log: <li lang="es">Alice: Hola</li>     │
 │  └─ Log: <li lang="en">You: Hello</li>              │          │       (screen reader speaks it, Spanish voice)
 └─────────────────────────────────────────────────────┘          └─────────────────────────────────────────────┘
            │                                                                  │
            └─────── one-time handshake via PeerJS public signalling server ───┘
```

Three layers, each a separate small JS module:

1. **Connection layer** (`net.js`) — PeerJS; rooms, peers, join/leave, relaying.
2. **Translation layer** (`translate.js`) — one function `translate(text, from, to)` with pluggable engines, caching and error handling.
3. **UI layer** (`ui.js`) — DOM, keyboard handling, live-region announcements, settings.

Plus `app.js` that wires them together, `index.html`, `style.css`, and a `strings/` folder for interface text in multiple languages (§4.3).

No build step: plain ES modules, PeerJS loaded from a pinned CDN version. Opening `index.html` from GitHub Pages is the whole deployment.

---

## 4. Languages

### 4.1 How a user sets their language

On the **join screen** (the first thing anyone sees):

```
TransChat
  Your name:      [ Alice              ]
  Your language:  [ English ▾ ]          ← <select>, pre-filled
  Room code:      [ blue-tiger-42      ]  ← pre-filled if you came via an invite link
  [ Start a new room ]   [ Join room ]
```

- The language `<select>` is pre-selected from `navigator.languages[0]` (the OS/browser language), so most people just press Enter.
- Each option is written **in its own language** with the English name after it — "Español (Spanish)", "Français (French)", "Deutsch (German)" — and each `<option>` carries its own `lang` attribute so the screen reader pronounces it properly. Someone who doesn't read English can still find their language.
- The name and language are saved in `localStorage`, so returning users get them pre-filled.
- Language can be changed later from the Settings dialog; the change is broadcast to the room (§4.2).
- Option list: the intersection of languages supported by the active translation engines (~30–50 common languages to start). Language codes are BCP-47 (`en`, `es`, `pt-BR`, `zh-Hans`…).

### 4.2 How the other side learns your language

Every peer announces itself with a `hello` message as soon as its connection opens:

```json
{ "type": "hello", "id": "peer-abc", "name": "Alice", "lang": "en" }
```

Each person sends a `hello` (name, language) to everyone they connect to. So every browser always knows everyone's name and language, and can announce it: *"María joined. Speaks Spanish."*

Important consequence of receiver-side translation: **nobody actually needs anyone else's language to send a message.** You just send your text tagged with *your* language. Each receiver translates from your language into theirs. The roster's language info is used for announcements, for the "who's here" list, and for the back-translation feature (§5.4) — not for the core send path.

### 4.3 Interface language

The app's own interface (buttons, announcements like "connected", "María joined") should also be in the user's language — a Spanish-speaking user shouldn't need to understand "Join room".

- Ship hand-checked string files for a few languages (`strings/en.json`, `es.json`, `fr.json`…).
- For any other language, machine-translate the English strings once on first use and cache them in `localStorage`.
- Set `<html lang="…">` to the chosen language so the screen reader uses the right voice for the interface too.

---

## 5. Translation

### 5.1 Engines (tried in order)

1. **Google Translate's free web endpoint** (`translate.googleapis.com/translate_a/single?client=gtx`), the same kind of service NVDA's Instant Translate add-on uses. No key, allows calls from any website (`Access-Control-Allow-Origin: *`), so it works in every browser. Sent as a form POST so long messages fit. Unofficial and undocumented: Google may throttle it (HTTP 429) or change it without notice. Messages are sent to Google.
2. **Browser built-in Translator API** (Chrome 138+ desktop), only as a fallback and only for pairs already on the computer (`availability()` is `available`), because downloading a language pack needs a key press or click.
3. Otherwise the original text is shown, marked "not translated", and the reason (including the actual error detail) is announced once. When a later message translates again, earlier untranslated messages are re-translated quietly and "Translation is working again" is announced.

Possible later engines if the Google endpoint proves unreliable: MyMemory (free, small daily quota), a paid service behind a small proxy, or Mozilla's Bergamot engine running in the page.

### 5.2 Rules

- **Same language → no translation.** Two English speakers in a mixed room see each other's text untouched.
- **Cache** `(text, from, to) → result` in memory so repeated phrases ("ok", "thanks") cost nothing.
- **Failure is never silent and never blocks delivery.** If translation fails, the original is shown with a marker, e.g. *"María (not translated, Spanish): hola, ¿qué tal?"* — and its `lang="es"` still makes the screen reader read it in a Spanish voice. A status announcement explains why ("Translation limit reached for today").
- **Order is preserved.** Translations finish at different speeds; messages are inserted into the log in their send order, not completion order (each message has a sequence number per sender).

### 5.3 Language detection (safety net)

People sometimes type in a language other than the one they declared (e.g. a Spanish speaker writing English). If the browser offers a Language Detector API, the receiver checks short messages' actual language and uses that as the source if confidence is high. Without detection we trust the declared language. Low priority; v2.

### 5.4 Checking what the other person will see ("back-translation")

Blind users can't glance at the other person's screen to see if their message came out garbled. Offer an optional setting:

- **"Check my messages before sending"** (off by default): pressing Enter first translates your message into each other participant's language and back into yours, then reads it to you: *"María will read something like: 'Hello, how are you going?' Press Enter to send, Escape to edit."*
- Lighter alternative available at any time: a shortcut to hear the *original* text of the last received message (useful if you know a bit of the other language, or to paste into another translator).

---

## 6. Connections and rooms

### 6.1 Rooms

- Rooms hold up to 8 people (`MAX_PEOPLE` in `net.js`), all equal. The practical limits are listening (every message is spoken) and the free translation endpoint's rate limits, not the network.
- Every browser has its own random PeerJS ID. The room code maps to a second ID, `transchat-v2-<room code>`, held by one browser at a time: the **doorkeeper**.
- The room code is three easy words plus a number, e.g. `blue-tiger-42` — easy to read out over a phone call, type, or dictate, with no ambiguous characters. Words come from a short English list (they are just tokens; they don't need translating). If a new code is taken, another is picked quietly.
- The app builds an **invite link**: `https://<user>.github.io/TransChat/#blue-tiger-42`. A "Copy invite link" button puts it on the clipboard (announced: "Invite link copied"). Opening the link pre-fills the room code.
- **Start a new room** claims the room code's ID, making that browser the first doorkeeper.
- **Join room** "knocks": connects to the room code's ID, gets back the list of members' personal IDs (or "full"), closes that connection, and connects directly to every member. Members already there are announced as "is here"; people arriving later as "joined".

### 6.2 Topology: everyone connected to everyone (mesh)

```
   Alice ── Bob
     │  ╲  ╱ │
     │   ╳   │
     │  ╱  ╲ │
   María ── Kenji
```

- Each browser connects directly to every other (8 people: 7 connections each, 28 in all — trivial for text). Messages go straight from the sender to each reader; nobody relays.
- The doorkeeper's only job is answering knocks. It also counts newcomers it has just told about the room as members for 30 seconds, so two people joining at the same moment learn about each other.
- **Hand-over:** when the doorkeeper leaves, everyone remaining tries to claim the room code's ID after a random delay of up to 1.5 s; the server gives it to the first, who tells the others (`door` message). If the server still holds the old ID (the doorkeeper's browser froze rather than closed), claims are retried every 5 s for 2 minutes. Measured: about 1–4 s after a clean leave or closed tab; about 80 s after a frozen browser.
- Newcomers knocking during a hand-over get "not found" and retry for about 9 s before giving up.
- **Liveness:** everyone pings everyone every 5 s; a connection silent for 20 s is dropped and announced as "left". A `bye` is treated as leaving immediately.
- The room ends only when the last person leaves.
- Known gap: if one pair of members cannot connect at all, even through a TURN relay, they don't see each other's messages; the newcomer is told. A fix would be others relaying for that pair — only if it turns up in real use.

### 6.3 Message protocol

All messages are JSON over PeerJS data channels.

| type | fields | purpose |
|---|---|---|
| `members` | `peers: [id]`, `door` | doorkeeper → knocking newcomer |
| `full` | `max` | doorkeeper → knocking newcomer when the room is full |
| `hello` | `name`, `lang`, `appVersion` | sent to each person on connecting |
| `door` | — | "I am the doorkeeper now", after a hand-over |
| `chat` | `id`, `seq`, `lang`, `text`, `ts` | a message, in the sender's language |
| `ping` | — | liveness, every 5 s |
| `bye` | — | clean leave |
| `typing`, `lang-change` | | not built yet |

The original text is always what's transmitted; translation happens only at the edges. This also means the original is always available to show on request (§5.4).

### 6.4 Network realities

- PeerJS's public signalling server is used only for the handshake; then data flows browser-to-browser, encrypted (DTLS) by WebRTC.
- Some networks (strict corporate/hotel/mobile NAT) block direct connections. PeerJS's default settings already cover this: Google's STUN server tells each browser its public address, and PeerJS's free TURN relays (`eu-0` and `us-0.turn.peerjs.com`) carry the connection when a direct one is impossible, still encrypted end to end. If a pair still cannot connect, the newcomer is told.
- Reconnect automatically on brief drops; announce "Connection lost, retrying" / "Reconnected".

---

## 7. Accessibility design

This is the heart of the app, so it gets the most detail.

### 7.1 Page layout (chat screen)

In DOM / reading order:

1. `<h1>` TransChat — room `blue-tiger-42`
2. **Status region** — visually small, `role="status"` (polite live region). Connection and roster announcements.
3. **Messages** — `<h2>Messages</h2>` then `<ol id="log" role="log" aria-live="polite">`. Each message is an `<li>`:
   ```html
   <li lang="es"><span lang="en">Alice:</span> Hola, ¿cómo estás?</li>
   ```
   (Name in a span so the name itself isn't mispronounced by the Spanish voice.)
4. **People here** — `<h2>` + a list: "Alice (you), English", "María, Spanish".
5. **Message input** — `<label>` "Message" + `<textarea>`. Focus lives here.
6. Buttons: Copy invite link, Settings, Leave.

Headings let users jump with H; landmarks (`<main>`, `<aside>` for People) let them jump with D/R.

### 7.2 Announcements

- Incoming messages: appended to the log; the screen reader reads them automatically while focus stays in the input box. Read as *"María: Hola, ¿cómo estás?"* (or translated).
- **Own messages are added to the log but NOT announced** (`aria-live` suppressed for them, e.g. by inserting into the log via a non-live path or briefly marking `aria-hidden` on insert — to be verified per screen reader). Hearing your own message echoed back is noise.
- Joins/leaves/language changes go to the status region.
- **Known quirk:** `role="log"` support varies — some combinations repeat or skip messages. Mitigation: a settings toggle "Announcement method": (a) live log (default), (b) a separate hidden announcer `<div aria-live="polite">` that receives a copy of each message text while the visible log is non-live. Pick defaults after testing (§10).

### 7.3 Keyboard

| Key | Action |
|---|---|
| Enter | Send message |
| Shift+Enter | New line |
| Escape (in input) | Clear input (with confirm if long) / cancel back-translation check |
| Alt+1 … Alt+9 | Re-read the 1st…9th most recent message without moving focus (pattern familiar from accessible chat clients) |
| Alt+Shift+1 … 9 | Read the *original* (untranslated) text of that message |
| Alt+P | Read who's here and their languages |
| Alt+L | Move focus to the message log for reviewing history (Escape returns to input) |
| Alt+S | Open Settings |

Notes: avoid NVDA/JAWS reserved combos (Insert+…, CapsLock+…); Alt+number is free in browsers on Windows but conflicts on some Mac keyboard layouts — Mac uses Ctrl+Option variants or a configurable modifier. Every shortcut is also reachable as a button so nobody has to memorise anything; a "Keyboard help" button (and `?` in log mode) reads the list.

### 7.4 Optional sound cues

Short, distinct earcons (generated with Web Audio, no files): message received, message sent, someone joined, someone left, error. On by default, toggle in Settings. Helpful when the screen reader is busy or muted.

### 7.5 Other

- Visible focus outline, high contrast, respects OS dark mode and text zoom — some users will have low vision rather than none.
- No timeouts, no auto-dismissing toasts, no CAPTCHA, no drag-and-drop.
- Mobile: same page works with VoiceOver/TalkBack; Enter-to-send is less natural on touch keyboards, so the Send button is prominent there.

---

## 8. Settings (all stored per browser, `localStorage`)

- Name, my language (broadcast on change)
- Translation engine preference, optional MyMemory email, optional own API key
- Check my messages before sending (back-translation) — off
- Show/announce original alongside translation — off
- Sound cues — on
- Announcement method — live log / separate announcer
- Typing indicators — off

---

## 9. Privacy & safety

- Shown once on the join screen, in the user's language: *"Messages go directly between your browsers. To translate them, each message is sent to Google Translate. Nothing is saved by TransChat after you close the page."*
- No cookies. Anonymous usage statistics only (2026-10-17): a Cloudflare Worker (`stats-worker/`, D1 database `transchat-stats`) receives a "start" report from a room's creator and a "leave" report from everyone, sent with `navigator.sendBeacon`. Each carries a random room ID (not the room code), the most people seen at once, and language codes. No names, messages, room codes or IP addresses are stored. Summary page: https://transchat-stats.ckgoodwin85.workers.dev/
- Room codes are guessable in principle; for v1 that's acceptable (rooms are short-lived, everyone hears every join announced). v2: a way to lock the room or approve joiners.

---

## 10. Testing plan

- **Screen readers** (manual, the real test): NVDA + Firefox, NVDA + Chrome, JAWS + Chrome, Narrator + Edge, VoiceOver + Safari (Mac), VoiceOver + Safari (iPhone), TalkBack + Chrome (Android). For each: messages auto-read? read once only? correct voice for `lang`? own messages silent? shortcuts work?
- **Language pairs:** at least en↔es, en↔fr, en↔zh, en↔ar (right-to-left), plus a 3-person, 3-language room.
- **Failure cases:** translation API down/limit hit, doorkeeper leaves or freezes, network drop, two tabs on one machine.
- Ideally a session with real blind users from two language communities before calling v1 done.
- Automated: unit tests for the translation layer (mocked engines, ordering, caching) and the protocol; axe-core accessibility scan in CI.

---

## 11. Build plan

1. **Skeleton** — join screen, two-person PeerJS connection, plain send/receive, accessible log. *(No translation yet; proves connection + screen-reader behaviour.)*
2. **Languages & translation** — language picker, `hello`/roster, receiver-side translation, `lang` attributes, failure handling.
3. **Groups** — everyone-connected rooms with doorkeeper hand-over, join/leave announcements, People list.
4. **Accessibility polish** — shortcuts, re-read last N, sound cues, announcement-method toggle, localized interface strings.
5. **Built-in translator** engine + optional API key.
6. **Back-translation check**, view original.
7. **Hardening** — reconnects, room lock.

Steps 1–3 give a usable two-language, multi-person chat; that's the natural first milestone to try with real people.

---

## 12. Decisions so far

- **Rooms of up to 8 equal people** (2026-10-17). No host: everyone connects to everyone, and the room code is held by a doorkeeper role that passes on automatically, so the room lasts until the last person leaves (§6.2). Replaced "2 people first".
- **Desktop first.** Testing priority: NVDA, JAWS, Narrator on Windows; VoiceOver on Mac. Mobile later.
- **Translation must not depend on the browser** (2026-10-17). Google Translate's free endpoint is the main engine for every browser; Chrome's built-in translator is a fallback only. This replaced the earlier "Chrome built-in translator only" decision, which tied users to Chrome and needed language-pack downloads.
- **v0.1 announcements** use a separate hidden polite live region (the visible log is not live), so your own messages are naturally silent. Revisit after screen-reader testing.
- **Hosting:** GitHub repo `Chessel85/TransChat`, served by GitHub Pages.

## 13. Open questions for you

1. **Translation reliability:** is Google's free endpoint reliable enough in real use, or is a paid service with a small proxy needed later?
2. **Interface languages:** which languages should have hand-checked interface text first?
