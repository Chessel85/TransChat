// Screen reader announcements and sound cues.

const announcer = document.getElementById('announcer');

// Speaks text (or a node with lang attributes) through the polite live
// region without moving focus. Each announcement is a new child so repeats
// are still read; old children are pruned.
export function announce(content, lang) {
  let node;
  if (content instanceof Node) {
    node = content;
  } else {
    node = document.createElement('p');
    node.textContent = content;
    if (lang) node.lang = lang;
  }
  announcer.append(node);
  while (announcer.children.length > 5) announcer.firstElementChild.remove();
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
