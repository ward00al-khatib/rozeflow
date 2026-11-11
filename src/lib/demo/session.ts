"use client";
/**
 * Demo mode: games run entirely in this browser with practice points, until rounds move to the
 * server (Supabase) and the real wallet. The fairness flow is the real one: the server seed is
 * committed (hash shown) before any round, and revealed when the player rotates seeds, so the
 * player can re-check every past round.
 *
 * Nothing here is trusted by the server; it is for trying the games and the verifier.
 */
import { useCallback, useEffect, useState } from "react";
import { commitServerSeed, newServerSeed } from "../fairness/rng";

export const DEMO_START_BALANCE = 100000; // 1,000 points, same as the signup grant

export interface RevealedSeed {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  lastNonce: number; // rounds 0..lastNonce-1 used this pair
}

export interface DemoRound<B = unknown, O = unknown> {
  game: string;
  nonce: number;
  serverSeedHash: string;
  clientSeed: string;
  bet: B;
  outcome: O;
  stake: number;
  gross: number;
  at: number;
}

interface DemoState {
  balance: number;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  rounds: DemoRound[];
  revealed: RevealedSeed[];
}

const KEY = "rozeflow:demo:v1";
const MAX_ROUNDS = 50;

function randomClientSeed(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fresh(): DemoState {
  return {
    balance: DEMO_START_BALANCE,
    serverSeed: newServerSeed(),
    clientSeed: randomClientSeed(),
    nonce: 0,
    rounds: [],
    revealed: [],
  };
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as DemoState;
      if (Number.isSafeInteger(s.balance) && /^[0-9a-f]{64}$/.test(s.serverSeed)) return s;
    }
  } catch {
    /* storage unavailable or corrupt: start over */
  }
  return fresh();
}

function save(s: DemoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: the session still works until the tab closes */
  }
}

export function useDemoSession() {
  const [state, setState] = useState<DemoState | null>(null);

  useEffect(() => setState(load()), []);

  const update = useCallback((fn: (s: DemoState) => DemoState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  /**
   * Plays one round: `resolve` gets the seed material and returns the outcome and gross payout.
   * The stake is taken and the payout credited in one step, like settlement on the server.
   */
  function play<B, O>(
    game: string,
    bet: B,
    stake: number,
    resolve: (seeds: { serverSeedHex: string; clientSeed: string; nonce: number }) => { outcome: O; gross: number },
  ): DemoRound<B, O> {
    if (!state) throw new Error("الجلسة لم تُحمّل بعد.");
    if (stake > state.balance) throw new Error("الرصيد التجريبي لا يكفي لهذه القيمة.");
    const { outcome, gross } = resolve({ serverSeedHex: state.serverSeed, clientSeed: state.clientSeed, nonce: state.nonce });
    const round: DemoRound<B, O> = {
      game,
      nonce: state.nonce,
      serverSeedHash: commitServerSeed(state.serverSeed),
      clientSeed: state.clientSeed,
      bet,
      outcome,
      stake,
      gross,
      at: Date.now(),
    };
    update((s) => ({
      ...s,
      balance: s.balance - stake + gross,
      nonce: s.nonce + 1,
      rounds: [round as DemoRound, ...s.rounds].slice(0, MAX_ROUNDS),
    }));
    return round;
  }

  /** Reveal the current server seed and commit to a new one (spec 6.3). */
  function rotateSeeds(nextClientSeed?: string) {
    update((s) => ({
      ...s,
      revealed: [
        { serverSeed: s.serverSeed, serverSeedHash: commitServerSeed(s.serverSeed), clientSeed: s.clientSeed, lastNonce: s.nonce },
        ...s.revealed,
      ].slice(0, 20),
      serverSeed: newServerSeed(),
      clientSeed: nextClientSeed?.trim() || randomClientSeed(),
      nonce: 0,
    }));
  }

  function reset() {
    const s = fresh();
    save(s);
    setState(s);
  }

  return {
    ready: state !== null,
    balance: state?.balance ?? 0,
    clientSeed: state?.clientSeed ?? "",
    nonce: state?.nonce ?? 0,
    serverSeedHash: state ? commitServerSeed(state.serverSeed) : "",
    rounds: state?.rounds ?? [],
    revealed: state?.revealed ?? [],
    play,
    rotateSeeds,
    reset,
  };
}

/** The revealed seed for a past round, if the player has rotated since. */
export function revealedSeedFor(round: DemoRound, revealed: RevealedSeed[]): string | null {
  return revealed.find((r) => r.serverSeedHash === round.serverSeedHash)?.serverSeed ?? null;
}
