/**
 * Little Bolt's own sound effects: robot chirps, servo whirs, metal clunks, electric zaps and a
 * power-up surge. Synthesised with Web Audio (no audio files); silent unless the player turns sound on.
 */
import { playSfx } from "@/lib/sound";

type Wave = OscillatorType;

function osc(a: AudioContext, freq: number, start: number, dur: number, type: Wave, gain: number, slideTo?: number, out?: AudioNode) {
  const t0 = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out ?? a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

let noiseBuf: AudioBuffer | null = null;
function noise(a: AudioContext, start: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, freqTo?: number) {
  if (!noiseBuf || noiseBuf.sampleRate !== a.sampleRate) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + start;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
  f.Q.value = 2;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

/** A robot "voice": quick square-wave chirps that glide between notes. */
function chirps(a: AudioContext, notes: number[], step = 0.075, start = 0) {
  notes.forEach((f, i) => osc(a, f, start + i * step, step * 1.1, "square", 0.045, f * (i % 2 ? 0.8 : 1.25)));
}

export type BoltSfx = "spin" | "stop" | "wild" | "core" | "line" | "charge" | "bonus" | "retrigger" | "bigWin" | "talk" | "end";

const DRAW: Record<BoltSfx, (a: AudioContext, n: number) => void> = {
  // servo whir rising as the reels start
  spin: (a) => {
    osc(a, 140, 0, 0.32, "sawtooth", 0.035, 420);
    noise(a, 0, 0.3, 0.05, "bandpass", 900, 2600);
  },
  // a reel locks: metal clunk
  stop: (a) => {
    osc(a, 120 + Math.random() * 20, 0, 0.09, "triangle", 0.12, 70);
    noise(a, 0, 0.05, 0.08, "highpass", 3000);
  },
  // Bolt lands: "bee-doo!" and a spark
  wild: (a) => {
    chirps(a, [880, 1320, 990]);
    noise(a, 0.05, 0.12, 0.06, "highpass", 5000);
  },
  // a power core lands: deep hum swelling up (higher for each one)
  core: (a, n) => {
    const base = 110 * Math.pow(1.26, n);
    osc(a, base, 0, 0.5, "sawtooth", 0.05, base * 2);
    osc(a, base * 1.5, 0.05, 0.45, "sine", 0.06, base * 3);
  },
  // a winning line: laser zap
  line: (a) => {
    osc(a, 1800, 0, 0.16, "sawtooth", 0.04, 300);
    osc(a, 2400, 0.02, 0.12, "square", 0.02, 600);
  },
  // the battery charges: rising blips, one per step
  charge: (a, n) => {
    for (let i = 0; i < Math.min(n, 6); i++) osc(a, 520 * Math.pow(1.12, i), i * 0.07, 0.09, "square", 0.04, 700 * Math.pow(1.12, i));
    noise(a, 0, 0.2, 0.04, "bandpass", 4000, 8000);
  },
  // the bonus starts: power-up surge and happy chatter
  bonus: (a) => {
    osc(a, 80, 0, 1.2, "sawtooth", 0.06, 640);
    osc(a, 160, 0.1, 1.1, "square", 0.025, 1280);
    noise(a, 0, 1.1, 0.05, "bandpass", 400, 6000);
    chirps(a, [1200, 1500, 1800, 1500, 2100], 0.08, 1.05);
  },
  retrigger: (a) => {
    chirps(a, [990, 1320, 1760, 2200], 0.07);
    osc(a, 220, 0, 0.6, "sawtooth", 0.05, 880);
  },
  // big win: fanfare arpeggio plus a rocket whoosh
  bigWin: (a) => {
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => osc(a, f, i * 0.07, 0.3, "triangle", 0.08));
    noise(a, 0, 1.2, 0.07, "bandpass", 300, 3000);
    chirps(a, [1500, 1900, 2300], 0.09, 0.6);
  },
  // Bolt talks when tapped: random chirps
  talk: (a) => {
    const n = 3 + Math.floor(Math.random() * 4);
    chirps(
      a,
      Array.from({ length: n }, () => 700 + Math.random() * 1300),
      0.06 + Math.random() * 0.04,
    );
  },
  // the bonus ends: power down
  end: (a) => {
    osc(a, 660, 0, 0.7, "sawtooth", 0.04, 90);
    chirps(a, [1400, 1050], 0.1, 0.65);
  },
};

const BUZZ: Partial<Record<BoltSfx, number | number[]>> = {
  wild: 15,
  bonus: [60, 40, 60, 40, 120],
  retrigger: [40, 30, 40],
  bigWin: [40, 60, 40, 60, 80],
};

export function boltSfx(name: BoltSfx, n = 0) {
  playSfx((a) => DRAW[name](a, n), BUZZ[name]);
}
