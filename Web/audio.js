// Every sound in Duck Duel is made in code, once, as the game starts.
import { sound } from './lamp-game.js';

export const S = {};

// A little tune, written note by note: a bouncy bass, a bright pluck melody and a soft hat, in C major.
function tune(bpm, melody, bass, bars) {
  const rate = 48000, beat = 60 / bpm, total = Math.round(bars * 4 * beat * rate), out = new Float32Array(total);
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const pluck = (start, midi, len, vol, wave) => {
    const f = hz(midi), n = Math.min(total - start, Math.round(len * rate));
    for (let i = 0; i < n; i++) {
      const t = i / rate, ph = (t * f) % 1, v = wave === 'tri' ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(ph * 2 * Math.PI) + 0.3 * Math.sin(ph * 4 * Math.PI);
      out[start + i] += v * vol * Math.min(1, t * 400) * Math.exp(-t * (wave === 'tri' ? 5 : 7));
    }
  };
  melody.forEach((m, i) => { if (m) pluck(Math.round(i * beat / 2 * rate) % total, m, 0.4, 0.16, 'sin'); });
  bass.forEach((m, i) => { if (m) pluck(Math.round(i * beat * rate) % total, m, 0.5, 0.2, 'tri'); });
  let seed = 7;
  for (let b = 0; b < bars * 8; b++) {   // an offbeat hat
    const start = Math.round((b + 0.5) * beat / 2 * rate);
    for (let i = 0; i < 1200 && start + i < total; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[start + i] += ((seed / 0x7fffffff) * 2 - 1) * 0.04 * Math.exp(-i / 250); }
  }
  return out;
}

export function makeSounds() {
  S.squirt = sound.tone({ wave: 'triangle', from: 520, to: 1250, attack: 0.002, hold: 0.025, release: 0.07, volume: 0.45, name: 'squirt' });
  S.splat = sound.tone({ wave: 'noise', from: 400, to: 400, attack: 0.002, hold: 0.03, release: 0.09, volume: 0.5, name: 'splat' });
  S.hit = sound.tone({ wave: 'square', from: 900, to: 380, attack: 0.002, hold: 0.04, release: 0.1, volume: 0.45, name: 'hit' });
  S.squeak = sound.tone({ wave: 'square', from: 1500, to: 520, attack: 0.003, hold: 0.1, release: 0.2, volume: 0.5, name: 'squeak' });
  S.pop = sound.tone({ wave: 'triangle', from: 320, to: 70, attack: 0.002, hold: 0.04, release: 0.22, volume: 0.7, name: 'pop' });
  S.quack = sound.tone({ wave: 'saw', from: 560, to: 300, attack: 0.004, hold: 0.07, release: 0.1, volume: 0.35, name: 'quack' });
  S.dash = sound.tone({ wave: 'noise', from: 300, to: 300, attack: 0.01, hold: 0.06, release: 0.14, volume: 0.35, name: 'dash' });
  S.bonk = sound.tone({ wave: 'sine', from: 200, to: 90, attack: 0.002, hold: 0.02, release: 0.1, volume: 0.5, name: 'bonk' });
  S.pickup = sound.tone({ wave: 'sine', from: 660, to: 1320, attack: 0.003, hold: 0.06, release: 0.18, volume: 0.5, name: 'pickup' });
  S.beep = sound.tone({ wave: 'square', from: 440, to: 440, attack: 0.003, hold: 0.12, release: 0.1, volume: 0.4, name: 'beep' });
  S.go = sound.tone({ wave: 'square', from: 880, to: 1175, attack: 0.003, hold: 0.25, release: 0.2, volume: 0.45, name: 'go' });
  S.select = sound.tone({ wave: 'triangle', from: 700, to: 900, attack: 0.002, hold: 0.04, release: 0.06, volume: 0.4, name: 'select' });
  // victory: a rising arpeggio
  const fan = new Float32Array(48000 * 1.2);
  [72, 76, 79, 84, 88].forEach((m, k) => {
    const f = 440 * 2 ** ((m - 69) / 12), s = Math.round(k * 0.12 * 48000);
    for (let i = 0; s + i < fan.length; i++) { const t = i / 48000; fan[s + i] += Math.sin(2 * Math.PI * f * t) * 0.25 * Math.min(1, t * 300) * Math.exp(-t * 4); }
  });
  S.win = sound.samples(fan, 48000, 'win');
  const C = 60, E = 64, G = 67, A = 69, D = 62;
  S.lobby = sound.samples(tune(96, [72, 0, 76, 0, 79, 0, 76, 0, 77, 0, 81, 0, 79, 0, 76, 0, 74, 0, 77, 0, 79, 0, 77, 0, 76, 0, 72, 0, 74, 0, 67, 0],
    [C - 12, 0, G - 12, 0, A - 12, 0, E - 12, 0, 53 - 12, 0, C - 12, 0, G - 12, 0, G - 12, 0], 4), 48000, 'lobby tune');
  S.fight = sound.samples(tune(132, [72, 76, 79, 76, 81, 79, 76, 74, 72, 76, 79, 84, 83, 79, 76, 79, 77, 81, 84, 81, 79, 76, 74, 76, 72, 74, 76, 79, 76, 74, 72, 0],
    [C - 12, C - 12, G - 12, G - 12, A - 12, A - 12, E - 12, G - 12, C - 12, C - 12, G - 12, G - 12, 53 - 12 + 12, 55 - 12 + 12, G - 12, G - 12], 4), 48000, 'fight tune');
}
