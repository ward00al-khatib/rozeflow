"use client";
/**
 * Game sounds, synthesised with Web Audio so there are no audio files to download or license.
 * Muted by default until the player turns sound on; the choice is kept in this browser.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "rozeflow:sound";
let ctx: AudioContext | null = null;
let enabled = false;
const listeners = new Set<(on: boolean) => void>();

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.12, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type SoundName = "click" | "tick" | "start" | "win" | "bigWin" | "lose" | "cashout" | "pop";

const SOUNDS: Record<SoundName, () => void> = {
  click: () => tone(660, 0, 0.05, "triangle", 0.06),
  tick: () => tone(1200 + Math.random() * 300, 0, 0.03, "square", 0.025),
  pop: () => tone(520, 0, 0.08, "triangle", 0.08, 880),
  start: () => tone(220, 0, 0.18, "sawtooth", 0.05, 440),
  lose: () => tone(240, 0, 0.22, "sine", 0.08, 150),
  cashout: () => {
    tone(880, 0, 0.09, "triangle", 0.09);
    tone(1320, 0.07, 0.14, "triangle", 0.09);
  },
  win: () => {
    tone(660, 0, 0.1, "triangle", 0.1);
    tone(880, 0.08, 0.1, "triangle", 0.1);
    tone(1320, 0.16, 0.22, "triangle", 0.1);
  },
  bigWin: () => {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.08, 0.28, "triangle", 0.1));
    tone(2093, 0.5, 0.6, "sine", 0.06);
  },
};

export function playSound(name: SoundName) {
  if (!enabled) return;
  try {
    SOUNDS[name]();
  } catch {
    /* audio blocked: stay silent */
  }
}

export function useSound() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      enabled = localStorage.getItem(KEY) === "on";
    } catch {
      /* storage blocked */
    }
    setOn(enabled);
    listeners.add(setOn);
    return () => void listeners.delete(setOn);
  }, []);
  const toggle = useCallback(() => {
    enabled = !enabled;
    try {
      localStorage.setItem(KEY, enabled ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    if (enabled) {
      audio();
      SOUNDS.click();
    }
    listeners.forEach((l) => l(enabled));
  }, []);
  return { on, toggle };
}
