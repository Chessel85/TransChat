// Two-person rooms over WebRTC using PeerJS (global `Peer` from the CDN script).
// The host registers the peer ID derived from the room code; the guest
// connects to it. PeerJS's public server is only used for the handshake.

const PREFIX = 'transchat-v1-';
const CONNECT_TIMEOUT_MS = 20000;

const COLOURS = ['red', 'blue', 'green', 'gold', 'pink', 'gray', 'black', 'white', 'brown', 'purple', 'orange', 'silver'];
const ANIMALS = ['cat', 'dog', 'fox', 'owl', 'bear', 'lion', 'wolf', 'duck', 'frog', 'goat', 'tiger', 'horse', 'mouse', 'whale', 'eagle', 'panda'];

export function makeRoomCode() {
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const number = 10 + Math.floor(Math.random() * 90);
  return `${pick(COLOURS)}-${pick(ANIMALS)}-${number}`;
}

// Accepts "Blue Tiger 42", "blue_tiger-42", etc.
export function normalizeCode(text) {
  return text.trim().toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// handlers: onReady(), onConnected(), onMessage(data), onPeerLeft(), onError(type, err)
export function openRoom({ code, asHost, onReady, onConnected, onMessage, onPeerLeft, onError }) {
  const options = { debug: 1 };
  const peer = asHost ? new Peer(PREFIX + code, options) : new Peer(options);
  let conn = null;
  let closed = false;
  let timer = null;

  function attach(c) {
    c.on('open', () => {
      clearTimeout(timer);
      conn = c;
      onConnected();
    });
    c.on('data', data => {
      if (data && typeof data === 'object') onMessage(data);
    });
    c.on('close', () => {
      if (conn === c) {
        conn = null;
        if (!closed) onPeerLeft();
      }
    });
    c.on('error', err => onError('connection', err));
  }

  peer.on('open', () => {
    onReady();
    if (!asHost) {
      attach(peer.connect(PREFIX + code, { reliable: true, serialization: 'json' }));
      timer = setTimeout(() => { if (!conn) onError('timeout'); }, CONNECT_TIMEOUT_MS);
    }
  });

  if (asHost) {
    peer.on('connection', c => {
      if (conn) {
        // Two-person rooms for now: turn away a third person.
        c.on('open', () => {
          c.send({ type: 'full' });
          setTimeout(() => c.close(), 500);
        });
        return;
      }
      attach(c);
    });
  }

  peer.on('disconnected', () => {
    // Lost the signalling server; an open chat keeps working, but reconnect
    // so the room stays joinable.
    if (!closed && !peer.destroyed) peer.reconnect();
  });

  peer.on('error', err => {
    clearTimeout(timer);
    onError(err.type, err);
  });

  return {
    get connected() { return !!conn?.open; },
    send(message) {
      if (!conn?.open) return false;
      conn.send(message);
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try { conn?.send({ type: 'bye' }); } catch { /* already gone */ }
      // Give the goodbye a moment to leave before tearing down.
      setTimeout(() => peer.destroy(), 200);
    },
  };
}
