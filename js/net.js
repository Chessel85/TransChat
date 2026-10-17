// Rooms of up to MAX_PEOPLE equal people over WebRTC using PeerJS (global
// `Peer` from the CDN script). Everyone connects directly to everyone else.
// One browser at a time also holds the room code's peer ID as the
// "doorkeeper": it only tells newcomers who is already in the room. When the
// doorkeeper leaves, the others race to take the room code over, so a room
// lasts until the last person leaves. PeerJS's public server is only used
// for handshakes.

const PREFIX = 'transchat-v2-';
export const MAX_PEOPLE = 8;
const PEER_OPTIONS = { debug: 1 };
const CONNECT_OPTIONS = { reliable: true, serialization: 'json' };
const CONNECT_TIMEOUT_MS = 20000;
const KNOCK_RETRY_MS = 3000;     // while a doorkeeper hand-over may be under way
const KNOCK_GIVE_UP_MS = 9000;
const CLAIM_RETRY_MS = 5000;     // the server may hold a vanished doorkeeper's ID for a while
const CLAIM_GIVE_UP_MS = 120000;
const PENDING_MS = 30000;        // how long a newcomer counts as in the room before connecting
const PING_MS = 5000;
const SILENCE_MS = 20000;        // nothing heard for this long: treat them as gone
const NEW_CODE_TRIES = 5;

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

// handlers: onOpen(code, { alone }), onPeerConnected(id, { existing }),
// onMessage(id, data), onPeerLeft(id), onConnectFailed(id), onFull(max),
// onError(type, err)
export function openRoom({ code, create, ...handlers }) {
  const conns = new Map();      // peer id -> open DataConnection
  const connecting = new Map(); // peer id -> DataConnection not yet open
  const pending = new Map();    // newcomer id -> timer (doorkeeper only)
  const lastHeard = new Map();  // DataConnection -> time anything last arrived on it
  let door = null;              // our Peer holding the room code, while we are doorkeeper
  let doorId = null;            // personal peer ID of the current doorkeeper
  let opened = false;
  let closed = false;
  let knockStarted = 0;
  let knockTimer = null;
  let claimUntil = 0;
  let claimTimer = null;
  let codeTries = 0;
  // Random ID for anonymous statistics; passed on to newcomers, never the code.
  let roomId = create ? [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('') : null;

  const me = new Peer(PEER_OPTIONS);

  function broadcast(message) {
    for (const c of conns.values()) if (c.open) c.send(message);
  }

  // ---- Connections between members ----

  function attach(c, existing) {
    connecting.set(c.peer, c);
    const timer = setTimeout(() => {
      if (connecting.get(c.peer) !== c) return;
      connecting.delete(c.peer);
      c.close();
      handlers.onConnectFailed(c.peer);
    }, CONNECT_TIMEOUT_MS);

    c.on('open', () => {
      clearTimeout(timer);
      if (connecting.get(c.peer) === c) connecting.delete(c.peer);
      if (closed) return c.close();
      clearTimeout(pending.get(c.peer));
      pending.delete(c.peer);
      const old = conns.get(c.peer);
      if (old) {
        // Both sides connected at once: keep the connection the lower ID started.
        const startedBy = existing ? me.id : c.peer;
        if (startedBy !== [me.id, c.peer].sort()[0]) return c.close();
        conns.set(c.peer, c);
        lastHeard.set(c, Date.now());
        old.close();
        return;
      }
      conns.set(c.peer, c);
      lastHeard.set(c, Date.now());
      handlers.onPeerConnected(c.peer, { existing });
    });
    c.on('data', data => {
      if (!data || typeof data !== 'object' || conns.get(c.peer) !== c) return;
      lastHeard.set(c, Date.now());
      switch (data.type) {
        case 'ping':
          return;
        case 'bye':
          return drop(c);
        case 'door':
          doorId = c.peer;
          stopClaiming();
          return;
      }
      handlers.onMessage(c.peer, data);
    });
    c.on('close', () => {
      clearTimeout(timer);
      drop(c);
    });
    c.on('error', err => console.warn('TransChat connection error', c.peer, err));
  }

  // Someone left, said goodbye, or went silent (closed tab, crash, lost network).
  function drop(c) {
    if (conns.get(c.peer) !== c) return;
    conns.delete(c.peer);
    lastHeard.delete(c);
    c.close();
    if (closed) return;
    handlers.onPeerLeft(c.peer);
    if (c.peer === doorId) startClaiming();
  }

  // A vanished browser may never close its connections properly, so everyone
  // pings everyone and drops whoever has been silent too long.
  const keepAlive = setInterval(() => {
    const now = Date.now();
    for (const c of [...conns.values()]) {
      if (now - (lastHeard.get(c) ?? now) > SILENCE_MS) drop(c);
      else if (c.open) c.send({ type: 'ping' });
    }
  }, PING_MS);

  me.on('connection', c => {
    if (closed || conns.size + connecting.size >= MAX_PEOPLE - 1) {
      c.on('open', () => c.close());
      return;
    }
    attach(c, false);
  });

  // ---- Joining: ask the doorkeeper who is here ----

  function knock() {
    if (closed) return;
    knockStarted ||= Date.now();
    const c = me.connect(PREFIX + code, CONNECT_OPTIONS);
    clearTimeout(knockTimer);
    knockTimer = setTimeout(() => {
      c.close();
      if (!opened && !closed) handlers.onError('timeout');
    }, CONNECT_TIMEOUT_MS);
    c.on('data', data => {
      clearTimeout(knockTimer);
      c.close();
      if (opened || closed) return;
      if (data?.type === 'full') return handlers.onFull(data.max ?? MAX_PEOPLE);
      if (data?.type !== 'members' || !Array.isArray(data.peers)) return;
      opened = true;
      doorId = data.door;
      if (typeof data.room === 'string') roomId = data.room;
      handlers.onOpen(code, { alone: false });
      for (const id of data.peers) {
        if (typeof id === 'string' && id !== me.id && !conns.has(id)) attach(me.connect(id, CONNECT_OPTIONS), true);
      }
    });
  }

  function retryKnock() {
    clearTimeout(knockTimer);
    if (Date.now() - knockStarted < KNOCK_GIVE_UP_MS) setTimeout(knock, KNOCK_RETRY_MS);
    else handlers.onError('peer-unavailable');
  }

  // ---- Being the doorkeeper ----

  function admit(c) {
    const members = [me.id, ...conns.keys(), ...pending.keys()].filter(id => id !== c.peer);
    if (members.length >= MAX_PEOPLE) {
      c.send({ type: 'full', max: MAX_PEOPLE });
    } else {
      c.send({ type: 'members', peers: members, door: me.id, room: roomId });
      clearTimeout(pending.get(c.peer));
      pending.set(c.peer, setTimeout(() => pending.delete(c.peer), PENDING_MS));
    }
    setTimeout(() => c.close(), 1000);
  }

  function claimDoor() {
    if (door || closed) return;
    const p = new Peer(PREFIX + code, PEER_OPTIONS);
    p.on('open', () => {
      if (closed) return p.destroy();
      door = p;
      doorId = me.id;
      stopClaiming();
      broadcast({ type: 'door' });
      if (!opened) {
        opened = true;
        handlers.onOpen(code, { alone: true });
      }
    });
    p.on('connection', c => c.on('open', () => admit(c)));
    p.on('disconnected', () => {
      if (door === p && !closed && !p.destroyed) p.reconnect();
    });
    p.on('error', err => {
      if (err.type === 'unavailable-id') {
        p.destroy();
        claimRefused();
      } else if (door === p || !opened) {
        handlers.onError(err.type, err);
      }
    });
  }

  function claimRefused() {
    if (closed) return;
    if (!opened) {
      // A new room whose code is taken: quietly pick another.
      if (++codeTries >= NEW_CODE_TRIES) return handlers.onError('unavailable-id');
      code = makeRoomCode();
      claimDoor();
    } else if (Date.now() < claimUntil) {
      claimTimer = setTimeout(claimDoor, CLAIM_RETRY_MS);
    }
  }

  // The doorkeeper left: everyone left tries to take over; the first wins.
  function startClaiming() {
    if (door || closed) return;
    claimUntil = Date.now() + CLAIM_GIVE_UP_MS;
    clearTimeout(claimTimer);
    claimTimer = setTimeout(claimDoor, Math.random() * 1500);
  }

  function stopClaiming() {
    claimUntil = 0;
    clearTimeout(claimTimer);
  }

  // ---- Our own peer ----

  me.on('open', () => {
    if (create) claimDoor();
    else knock();
  });

  me.on('disconnected', () => {
    // Lost the signalling server; open chats keep working, but reconnect so
    // new people can still reach us.
    if (!closed && !me.destroyed) me.reconnect();
  });

  me.on('error', err => {
    if (err.type === 'peer-unavailable') {
      const id = /(\S+)$/.exec(err.message ?? '')?.[1];
      if (id === PREFIX + code) {
        if (!opened) retryKnock();
        return;
      }
      // Someone we were told about has already gone.
      const c = connecting.get(id);
      if (c) {
        connecting.delete(id);
        c.close();
      }
      return;
    }
    handlers.onError(err.type, err);
  });

  return {
    get connected() { return conns.size > 0; },
    get code() { return code; },
    get roomId() { return roomId; },
    send(message) {
      broadcast(message);
      return conns.size > 0;
    },
    sendTo(id, message) {
      const c = conns.get(id);
      if (c?.open) c.send(message);
    },
    close() {
      if (closed) return;
      closed = true;
      stopClaiming();
      clearTimeout(knockTimer);
      clearInterval(keepAlive);
      for (const timer of pending.values()) clearTimeout(timer);
      try { broadcast({ type: 'bye' }); } catch { /* already gone */ }
      // Give the goodbyes a moment to leave before tearing down.
      setTimeout(() => {
        door?.destroy();
        me.destroy();
      }, 200);
    },
  };
}
