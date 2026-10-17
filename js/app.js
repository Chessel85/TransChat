import { LANGUAGE_CODES, languageName, nativeName, defaultLanguage } from './languages.js';
import * as translation from './translate.js';
import { openRoom, makeRoomCode, normalizeCode } from './net.js';
import { announce, sounds } from './ui.js';

const APP_VERSION = '0.1.0';
const UI_LANG = document.documentElement.lang;

const $ = id => document.getElementById(id);

const store = {
  get(key) { try { return localStorage.getItem(`transchat.${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`transchat.${key}`, value); } catch { /* private mode */ } },
};

const state = {
  me: { name: '', lang: 'en' },
  other: null,          // { name, lang } once their hello arrives
  session: null,
  code: '',
  asHost: false,
  inChat: false,
  messages: [],         // { mine, name, text, lang, original, originalLang, untranslated }
  seq: 0,
  displayChain: Promise.resolve(),
  lastErrorAnnounced: null,
};

// ---------- Join screen ----------

function initJoinScreen() {
  const select = $('lang');
  for (const code of LANGUAGE_CODES) {
    const option = document.createElement('option');
    const native = nativeName(code);
    const eng = languageName(code);
    option.value = code;
    option.lang = code;
    option.textContent = native === eng ? native : `${native} (${eng})`;
    select.append(option);
  }
  select.value = store.get('lang') || defaultLanguage();
  $('name').value = store.get('name') || '';
  $('room').value = location.hash.slice(1);
  $('sounds').checked = store.get('sounds') !== 'off';
  sounds.enabled = $('sounds').checked;

  $('join-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = normalizeCode($('room').value);
    if (code) startSession(false, code);
    else startSession(true, makeRoomCode());
  });
  $('new-btn').addEventListener('click', () => startSession(true, makeRoomCode()));

  focusJoinScreen();
}

function focusJoinScreen() {
  if (!$('name').value) $('name').focus();
  else if ($('room').value) $('join-btn').focus();
  else $('new-btn').focus();
}

function showJoinError(text) {
  $('join-error').textContent = text;
  sounds.error();
}

function setJoinBusy(busy) {
  for (const id of ['join-btn', 'new-btn']) $(id).disabled = busy;
}

function startSession(asHost, code) {
  const name = $('name').value.trim();
  if (!name) {
    showJoinError('Please enter your name.');
    $('name').focus();
    return;
  }
  state.me = { name, lang: $('lang').value };
  store.set('name', name);
  store.set('lang', state.me.lang);
  sounds.unlock();

  state.code = code;
  state.asHost = asHost;
  state.other = null;
  $('join-error').textContent = '';
  setJoinBusy(true);
  announce(asHost ? 'Opening a new room…' : `Connecting to room ${spoken(code)}…`);

  state.session = openRoom({
    code,
    asHost,
    onReady: () => {
      if (asHost) {
        showChatScreen();
        setStatus(`Room ${code} is open. Waiting for someone to join. Share the room code or the invite link.`, true);
      }
    },
    onConnected: () => {
      if (!state.inChat) showChatScreen();
      state.session.send({ type: 'hello', name: state.me.name, lang: state.me.lang, appVersion: APP_VERSION });
    },
    onMessage: handleMessage,
    onPeerLeft: handlePeerLeft,
    onError: handleNetError,
  });
}

// ---------- Chat screen ----------

function showChatScreen() {
  state.inChat = true;
  setJoinBusy(false);
  history.replaceState(null, '', `#${state.code}`);
  $('chat-heading').textContent = `TransChat — room ${state.code}`;
  $('join-screen').hidden = true;
  $('chat-screen').hidden = false;
  renderPeople();
  $('message').focus();
}

function leaveChat() {
  state.session?.close();
  state.session = null;
  state.inChat = false;
  state.other = null;
  state.messages = [];
  state.lastErrorAnnounced = null;
  $('log').replaceChildren();
  $('chat-screen').hidden = true;
  $('join-screen').hidden = false;
  $('room').value = '';
  history.replaceState(null, '', location.pathname);
  setJoinBusy(false);
  announce('You left the chat.');
  focusJoinScreen();
}

function setStatus(text, speak = false) {
  $('status').textContent = text;
  if (speak) announce(text);
}

function renderPeople() {
  const list = $('people');
  list.replaceChildren();
  const people = [{ ...state.me, you: true }];
  if (state.other) people.push(state.other);
  for (const p of people) {
    const li = document.createElement('li');
    li.textContent = `${p.you ? `${p.name} (you)` : p.name}, ${languageName(p.lang)}`;
    list.append(li);
  }
}

function peopleSummary() {
  const you = `You, ${state.me.name}, ${languageName(state.me.lang)}.`;
  return state.other
    ? `${you} ${state.other.name}, ${languageName(state.other.lang)}.`
    : `${you} Nobody else is here yet.`;
}

function possessive(name) {
  return name ? `${name}'s` : 'their';
}

// Spell room codes with spaces so screen readers say "blue tiger 42".
function spoken(code) {
  return code.replace(/-/g, ' ');
}

// ---------- Incoming messages ----------

function handleMessage(data) {
  switch (data.type) {
    case 'hello':
      handleHello(data);
      break;
    case 'chat':
      if (typeof data.text === 'string' && typeof data.lang === 'string') receiveChat(data);
      break;
    case 'full':
      state.session?.close();
      state.session = null;
      backToJoin('That room already has two people in it.');
      break;
    case 'bye':
      // The connection closing follows; handlePeerLeft announces it.
      break;
  }
}

function handleHello(data) {
  const name = String(data.name || 'Guest').slice(0, 40);
  const lang = LANGUAGE_CODES.includes(data.lang) ? data.lang : String(data.lang || 'en').slice(0, 20);
  state.other = { name, lang };
  renderPeople();
  sounds.join();
  const sameLanguage = lang === state.me.lang;
  announce(`${name} joined. Speaks ${languageName(lang)}.${sameLanguage ? ' Same language as you, so no translation is needed.' : ''}`);
  setStatus(`Chatting with ${name}.`);
}

function handlePeerLeft() {
  const name = state.other?.name ?? 'The other person';
  state.other = null;
  renderPeople();
  sounds.leave();
  if (state.asHost) {
    setStatus(`${name} left. Room ${state.code} is still open; waiting for someone to join.`);
    announce(`${name} left.`);
  } else {
    setStatus(`${name} left and the room has closed. Use the Leave button to go back and start or join another room.`, true);
  }
}

function receiveChat(data) {
  const from = state.other ?? { name: 'Unknown' };
  // Translations can finish out of order; chain them so messages appear in sending order.
  state.displayChain = state.displayChain.then(async () => {
    const result = await translation.translate(data.text.slice(0, 4000), data.lang, state.me.lang);
    addMessage({
      mine: false,
      name: from.name,
      text: result.text,
      lang: result.lang,
      original: data.text,
      originalLang: data.lang,
      untranslated: !!result.error,
    }, true);
    if (result.error) reportTranslationError(result, data.lang);
    else if (state.lastErrorAnnounced) await translationRecovered();
  });
}

function reportTranslationError({ error, detail }, from) {
  if (state.lastErrorAnnounced === error) return;
  state.lastErrorAnnounced = error;
  const original = 'so messages are shown in the original language until it works again.';
  const messages = {
    'offline': `This computer seems to be offline, ${original}`,
    'network': `Could not reach the translation service, ${original}`,
    'timeout': `The translation service did not reply in time, ${original}`,
    'busy': `The translation service is refusing requests for now because there have been too many, ${original}`,
    'failed': `Translation from ${languageName(from)} failed, ${original}`,
  };
  const text = `${messages[error] ?? messages.failed}${detail ? ` Details: ${detail}.` : ''}`;
  setStatus(text);
  announce(text);
}

// Translation works again: translate the messages that arrived untranslated
// and update the log quietly.
async function translationRecovered() {
  state.lastErrorAnnounced = null;
  let fixed = 0;
  for (const msg of state.messages) {
    if (msg.mine || !msg.untranslated) continue;
    const result = await translation.translate(msg.original, msg.originalLang, state.me.lang);
    if (result.error) continue;
    Object.assign(msg, { text: result.text, lang: result.lang, untranslated: false });
    msg.node?.replaceWith(msg.node = messageNode(msg));
    fixed++;
  }
  const earlier = fixed ? ` ${fixed === 1 ? '1 earlier message has' : `${fixed} earlier messages have`} been translated; use Alt+number to hear them.` : '';
  setStatus(state.other ? `Chatting with ${state.other.name}.` : '');
  announce(`Translation is working again.${earlier}`);
}

// ---------- Sending ----------

function sendMessage() {
  const input = $('message');
  const text = input.value.trim();
  if (!text) return;
  if (!state.session?.connected) {
    announce('Nobody else is here yet, so the message was not sent.');
    sounds.error();
    return;
  }
  state.session.send({ type: 'chat', id: crypto.randomUUID(), seq: ++state.seq, lang: state.me.lang, text, ts: Date.now() });
  input.value = '';
  addMessage({ mine: true, name: 'You', text, lang: state.me.lang, original: text, originalLang: state.me.lang, untranslated: false }, false);
  sounds.send();
}

// ---------- Message log ----------

function messageNode(msg, { original = false } = {}) {
  const li = document.createElement('li');
  if (msg.mine) li.className = 'mine';
  const name = document.createElement('span');
  name.className = 'name';
  name.lang = UI_LANG;
  name.textContent = `${msg.name}: `;
  li.append(name);
  if (original || msg.untranslated) {
    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.lang = UI_LANG;
    flag.textContent = original
      ? `original, ${languageName(msg.originalLang)}: `
      : `not translated, ${languageName(msg.originalLang)}: `;
    li.append(flag);
  }
  const text = document.createElement('span');
  text.lang = original ? msg.originalLang : msg.lang;
  text.textContent = original ? msg.original : msg.text;
  li.append(text);
  return li;
}

function addMessage(msg, speak) {
  state.messages.push(msg);
  const log = $('log');
  msg.node = messageNode(msg);
  log.append(msg.node);
  log.scrollTop = log.scrollHeight;
  if (speak) {
    const p = document.createElement('p');
    p.append(...messageNode(msg).childNodes);
    announce(p);
    sounds.receive();
  }
}

function rereadMessage(n, original) {
  const msg = state.messages[state.messages.length - n];
  if (!msg) {
    announce(state.messages.length ? `There is no message ${n}.` : 'No messages yet.');
    return;
  }
  const p = document.createElement('p');
  p.append(...messageNode(msg, { original }).childNodes);
  announce(p);
}

// ---------- Errors ----------

function handleNetError(type, err) {
  console.warn('TransChat network error', type, err);
  const code = spoken(state.code);
  const messages = {
    'peer-unavailable': `No room called ${code} was found. Check the code, or ask the other person to start the room first.`,
    'unavailable-id': `The room code ${code} is already in use. Choose Start a new room to get a different code.`,
    'timeout': `Could not connect to room ${code}. The network may be blocking direct connections.`,
    'browser-incompatible': 'This browser does not support direct connections (WebRTC).',
    'network': 'Lost contact with the connection server.',
    'server-error': 'The connection server is not responding. Try again in a minute.',
    'socket-error': 'Lost contact with the connection server.',
    'socket-closed': 'Lost contact with the connection server.',
  };
  const text = messages[type] ?? `Connection problem: ${err?.message ?? type}.`;

  if (!state.inChat) {
    state.session?.close();
    state.session = null;
    backToJoin(text);
  } else if (!['network', 'socket-error', 'socket-closed', 'connection'].includes(type) || !state.session?.connected) {
    // In a live chat, signalling-server hiccups don't matter while the direct link is up.
    sounds.error();
    setStatus(text, true);
  }
}

function backToJoin(text) {
  if (state.inChat) {
    state.inChat = false;
    $('chat-screen').hidden = true;
    $('join-screen').hidden = false;
  }
  setJoinBusy(false);
  showJoinError(text);
  $('room').focus();
}

// ---------- Keyboard ----------

function initChatScreen() {
  $('send-form').addEventListener('submit', e => {
    e.preventDefault();
    sendMessage();
  });

  $('message').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  $('leave-btn').addEventListener('click', leaveChat);
  $('sounds').addEventListener('change', e => {
    sounds.enabled = e.target.checked;
    store.set('sounds', sounds.enabled ? 'on' : 'off');
  });

  $('copy-btn').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#${state.code}`;
    try {
      await navigator.clipboard.writeText(link);
      announce(`Invite link copied. The room code is ${spoken(state.code)}.`);
    } catch {
      announce(`Could not copy. The invite link is ${link}`);
    }
  });

  $('log').addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      $('message').focus();
    }
  });

  document.addEventListener('keydown', e => {
    if (!state.inChat || !e.altKey || e.ctrlKey || e.metaKey) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      rereadMessage(Number(digit[1]), e.shiftKey);
    } else if (e.code === 'KeyP' && !e.shiftKey) {
      e.preventDefault();
      announce(peopleSummary());
    } else if (e.code === 'KeyL' && !e.shiftKey) {
      e.preventDefault();
      $('log').focus();
      if (!state.messages.length) announce('No messages yet.');
    } else if (e.code === 'KeyM' && !e.shiftKey) {
      e.preventDefault();
      $('message').focus();
    }
  });

  window.addEventListener('pagehide', () => state.session?.close());
}

// GitHub Pages sends each deploy's time as the page's Last-Modified date, so
// this shows which version of the site is loaded.
function showPublished() {
  const published = new Date(document.lastModified);
  if (isNaN(published)) return;
  $('published').textContent = `Web site published ${published.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`;
}

showPublished();
initJoinScreen();
initChatScreen();
