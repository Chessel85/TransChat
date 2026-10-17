// Screen reader announcements and sound cues.

const announcer = document.getElementById('announcer');

let lastAnnounced = 0;

// Speaks text (or a node with lang attributes) through the polite live
// region without moving focus. Each announcement is a new child so repeats
// are still read. Removing a child makes Chrome read the whole region again,
// so earlier ones are only cleared out together with the next announcement,
// unless they came just before it (a burst must not lose its first lines).
export function announce(content, lang) {
  let node;
  if (content instanceof Node) {
    node = content;
  } else {
    node = document.createElement('p');
    node.textContent = content;
    if (lang) node.lang = lang;
  }
  const now = Date.now();
  if (now - lastAnnounced < 1000) announcer.append(node);
  else announcer.replaceChildren(node);
  lastAnnounced = now;
}

let audio = null;

export const sounds = {
  enabled: true,
  // Must be called from a user action (click/key) so audio may start.
  unlock() {
    try {
      audio ??= new AudioContext();
      audio.resume();
    } catch { /* no audio */ }
  },
  receive() { play([660, 880]); },
  send() { play([520], 0.05); },
  join() { play([523, 659, 784]); },
  leave() { play([784, 523]); },
  error() { play([220, 180], 0.15); },
};

function play(freqs, duration = 0.08) {
  if (!sounds.enabled || !audio) return;
  let t = audio.currentTime;
  for (const freq of freqs) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    t += duration;
  }
}
