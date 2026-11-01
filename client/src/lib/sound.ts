// Sons synthétisés (Web Audio), aucun fichier à charger : motte posée, papier du bon, graine, racines arrachées, pierre, tondeuse.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number; sweep?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t0 + dur);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

export const sfx = {
  /** Une plaque choisie dans la file : une étiquette qu'on feuillette. */
  tap: () => noise(0.04, { gain: 0.1, freq: 3600, q: 1.2, fade: 3 }),
  /** La plaque tourne : un petit froissement. */
  flop: () => noise(0.07, { gain: 0.1, freq: 1400, sweep: 2400, q: 0.8, fade: 2 }),
  /** Une motte posée : un choc mat dans la terre. */
  plop: () => {
    tone(120, 0.16, { gain: 0.16, slide: 0.55 });
    noise(0.1, { gain: 0.16, freq: 520, type: 'lowpass', fade: 3 });
    noise(0.06, { gain: 0.05, freq: 3000, q: 0.8, fade: 3, delay: 0.03 });
  },
  /** Refusé : un petit coup sourd. */
  nope: () => tone(150, 0.12, { type: 'triangle', gain: 0.07, slide: 0.8 }),
  /** Un bon : le papier qu'on déchire. */
  paper: () => noise(0.16, { gain: 0.1, freq: 2200, sweep: 5200, q: 0.7, fade: 1.5 }),
  /** Une graine : un grain qui tinte. */
  seed: () => {
    tone(1760, 0.09, { type: 'triangle', gain: 0.05 });
    tone(2349, 0.14, { type: 'triangle', gain: 0.04, delay: 0.07 });
  },
  /** Des racines arrachées. */
  rip: () => {
    noise(0.4, { gain: 0.24, freq: 500, sweep: 3800, q: 0.6, fade: 1.2 });
    tone(180, 0.3, { type: 'sawtooth', gain: 0.03, slide: 2.2 });
  },
  /** Une pierre posée. */
  stone: () => {
    noise(0.05, { gain: 0.26, freq: 1900, q: 2.4, fade: 4 });
    tone(620, 0.07, { type: 'square', gain: 0.03, slide: 0.7 });
    noise(0.05, { gain: 0.12, freq: 2500, q: 2.4, fade: 4, delay: 0.08 });
  },
  /** Une case spéciale entourée : un petit carillon. */
  chime: () => [880, 1108.7, 1318.5].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.05, delay: i * 0.08 })),
  /** À toi : deux notes de bois. */
  turn: () => {
    tone(587.3, 0.14, { type: 'triangle', gain: 0.07 });
    tone(784, 0.18, { type: 'triangle', gain: 0.07, delay: 0.12 });
  },
  /** Plaque perdue. */
  lost: () => noise(0.22, { gain: 0.09, freq: 900, sweep: 300, q: 0.6, fade: 1.4 }),
  /** Début de partie : la terre qu'on retourne. */
  start: () => {
    noise(0.5, { gain: 0.14, freq: 400, sweep: 160, type: 'lowpass', fade: 1.4 });
    tone(392, 0.2, { type: 'triangle', gain: 0.05, delay: 0.3 });
    tone(523.25, 0.3, { type: 'triangle', gain: 0.05, delay: 0.42 });
  },
  /** La tondeuse passe sur un carré. */
  mow: (seconds: number) => {
    const a = audio();
    if (!a) return;
    noise(seconds, { gain: 0.09, freq: 1600, q: 0.7, fade: 0.2 });
    tone(92, seconds, { type: 'sawtooth', gain: 0.022, attack: 0.04 });
  },
  /** Le tampon du carré. */
  stamp: () => {
    noise(0.05, { gain: 0.2, freq: 700, type: 'lowpass', fade: 3 });
    tone(160, 0.1, { gain: 0.1, slide: 0.7 });
  },
  /** Fin de partie : modeste ou triomphale. */
  fanfare: (good: boolean) => {
    const notes = good ? [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5] : [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.9 : 0.2, { type: 'triangle', gain: 0.06, delay: i * 0.13 }));
  },
};
