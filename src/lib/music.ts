"use client";
/**
 * Quiet background music, generated live with Web Audio: no audio files, nothing to license.
 * Each game has its own theme (key, tempo, chords, timbre). A small look-ahead scheduler plays a soft pad,
 * a bass note per bar and a sparse arpeggio drawn from the chord, so the loop never repeats exactly.
 * It plays only while sound is on, the music toggle is on and the tab is visible.
 */

export type MusicTheme = "dice" | "roulette" | "plinko" | "mines" | "crash" | "slots" | "reef" | "bolt";

interface Theme {
  bpm: number;
  root: number; // MIDI note of the key's root
  chords: number[][]; // semitones from root, one chord per bar
  pad: OscillatorType;
  lead: OscillatorType;
  density: number; // chance an eighth note sounds in the arpeggio
  cutoff: number; // pad low-pass, Hz
  pulse: boolean; // soft kick on beats 1 and 3
}

export const THEMES: Record<MusicTheme, Theme> = {
  // bright and light: D dorian
  dice: { bpm: 100, root: 50, chords: [[0, 3, 7, 10], [5, 9, 12, 15], [-2, 2, 5, 9], [0, 3, 7, 14]], pad: "triangle", lead: "triangle", density: 0.45, cutoff: 1400, pulse: false },
  // lounge: major sevenths, slow
  roulette: { bpm: 80, root: 48, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]], pad: "sawtooth", lead: "sine", density: 0.3, cutoff: 900, pulse: false },
  // playful: major pentatonic colours
  plinko: { bpm: 112, root: 53, chords: [[0, 4, 7, 9], [5, 9, 12, 14], [7, 11, 14, 16], [0, 4, 9, 12]], pad: "triangle", lead: "square", density: 0.5, cutoff: 1600, pulse: false },
  // tense: natural minor, low and sparse
  mines: { bpm: 72, root: 45, chords: [[0, 3, 7, 12], [-4, 0, 3, 8], [-2, 2, 5, 10], [-5, -1, 2, 7]], pad: "sawtooth", lead: "sine", density: 0.22, cutoff: 700, pulse: true },
  // driving: minor with a pulse
  crash: { bpm: 124, root: 45, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 5], [-2, 2, 5, 9]], pad: "sawtooth", lead: "triangle", density: 0.55, cutoff: 1100, pulse: true },
  // Night Lab: mysterious, phrygian flavour
  slots: { bpm: 96, root: 52, chords: [[0, 3, 7, 10], [1, 5, 8, 13], [0, 3, 7, 12], [-2, 1, 5, 8]], pad: "sawtooth", lead: "triangle", density: 0.4, cutoff: 1000, pulse: false },
  // Bubble Reef: sunny island major, bouncy plucks
  reef: { bpm: 116, root: 55, chords: [[0, 4, 7, 12], [5, 9, 12, 16], [-3, 0, 4, 9], [7, 11, 14, 17]], pad: "triangle", lead: "sine", density: 0.55, cutoff: 1800, pulse: true },
  // Little Bolt: playful chiptune in mixolydian, square-wave bleeps over a soft pulse
  bolt: { bpm: 112, root: 50, chords: [[0, 4, 7, 10], [-2, 2, 5, 9], [5, 9, 12, 16], [3, 7, 10, 14]], pad: "triangle", lead: "square", density: 0.6, cutoff: 1500, pulse: true },
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Deterministic little PRNG so the tests can check the pattern; seeded per bar. */
export function arpeggio(theme: Theme, bar: number, seed: number): (number | null)[] {
  let s = (seed * 2654435761 + bar * 40503) >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const chord = theme.chords[bar % theme.chords.length];
  const notes: (number | null)[] = [];
  for (let i = 0; i < 8; i++) {
    if (i !== 0 && rnd() > theme.density) {
      notes.push(null);
      continue;
    }
    const n = chord[Math.floor(rnd() * chord.length)] + (rnd() < 0.3 ? 24 : 12);
    notes.push(theme.root + n);
  }
  return notes;
}

class Player {
  private ctx: AudioContext;
  private master: GainNode;
  private filter: BiquadFilterNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar = 0;
  private bar = 0;
  private seed = Math.floor(Math.random() * 1e6);

  constructor(ctx: AudioContext, private theme: Theme) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = theme.cutoff;
    this.filter.connect(this.master).connect(ctx.destination);
  }

  start() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), t);
    this.master.gain.exponentialRampToValueAtTime(0.55, t + 2.5);
    this.nextBar = t + 0.1;
    this.timer = setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    const m = this.master;
    setTimeout(() => m.disconnect(), 1200);
  }

  private schedule() {
    const barLen = (60 / this.theme.bpm) * 4;
    while (this.nextBar < this.ctx.currentTime + 1.2) {
      this.playBar(this.nextBar, barLen);
      this.nextBar += barLen;
      this.bar++;
    }
  }

  private voice(type: OscillatorType, freq: number, t0: number, dur: number, peak: number, dest: AudioNode, attack = 0.02) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private playBar(t: number, barLen: number) {
    const th = this.theme;
    const chord = th.chords[this.bar % th.chords.length];
    // pad: each chord tone, two detuned voices, slow attack
    for (const n of chord) {
      for (const detune of [-0.15, 0.15]) {
        this.voice(th.pad, hz(th.root + n + 12 + detune), t, barLen * 1.05, 0.018, this.filter, barLen * 0.35);
      }
    }
    // bass on the chord root
    this.voice("sine", hz(th.root + chord[0] - 12), t, barLen * 0.9, 0.09, this.master, 0.03);
    // arpeggio in eighths
    const eighth = barLen / 8;
    arpeggio(th, this.bar, this.seed).forEach((n, i) => {
      if (n !== null) this.voice(th.lead, hz(n), t + i * eighth, eighth * 1.6, 0.03, this.master, 0.008);
    });
    // soft pulse
    if (th.pulse) {
      for (const beat of [0, 2]) {
        const t0 = t + beat * (barLen / 4);
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.frequency.setValueAtTime(110, t0);
        o.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
        g.gain.setValueAtTime(0.09, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.connect(g).connect(this.master);
        o.start(t0);
        o.stop(t0 + 0.25);
      }
    }
  }
}

let current: { theme: MusicTheme; player: Player } | null = null;

/** Starts the theme (or keeps it playing). Pass null to fade out. */
export function setMusic(ctx: AudioContext | null, theme: MusicTheme | null) {
  if (current && (!theme || current.theme !== theme || !ctx)) {
    current.player.stop();
    current = null;
  }
  if (!theme || !ctx || current) return;
  const player = new Player(ctx, THEMES[theme]);
  player.start();
  current = { theme, player };
}
