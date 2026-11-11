/**
 * ROZEFLOW fairness RNG — spec sections 6.4–6.7 (docs/SPEC.md).
 *
 * Every outcome is derived from HMAC-SHA-256(server_seed, encode(domain, client_seed, nonce, counter)).
 * Nothing the server chooses after committing to server_seed (such as round ids) enters the hash,
 * so the operator cannot grind for a preferred result.
 *
 * This file must stay deterministic and run unchanged in Node, the browser and Deno (Edge Functions):
 * it uses only Uint8Array, Web Crypto's getRandomValues, and @noble/hashes (pure JS, audited).
 * The public verifier re-implements it and must produce byte-identical results.
 */
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";

export const RNG_ALGORITHM_VERSION = "1.0";

const utf8 = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Domain string per game, e.g. "rozeflow:v1:dice". Keeps random material separate between games. */
export function gameDomain(game: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(game)) throw new Error(`invalid game slug: ${game}`);
  return `rozeflow:v1:${game}`;
}

/** New secret server seed: 32 bytes from the platform CSPRNG, hex encoded. */
export function newServerSeed(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** Public commitment published before the seed is used. */
export function commitServerSeed(serverSeedHex: string): string {
  return toHex(sha256(fromHex(serverSeedHex)));
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

function u64be(n: bigint): Uint8Array {
  if (n < 0n || n >= 1n << 64n) throw new Error("u64 out of range");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n);
  return b;
}

/** Length-prefixed encoding: each field is u32be(len) || bytes. Strings are UTF-8, integers u64be. */
export function encode(...fields: Array<string | number | bigint>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    let b: Uint8Array;
    if (typeof f === "string") b = utf8.encode(f);
    else {
      if (typeof f === "number" && (!Number.isSafeInteger(f) || f < 0)) {
        throw new Error(`integer field must be a non-negative safe integer: ${f}`);
      }
      b = u64be(BigInt(f));
    }
    parts.push(u32be(b.length), b);
  }
  return concat(parts);
}

export function randomBlock(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  domain: string,
  counter: number,
): Uint8Array {
  return hmac(sha256, fromHex(serverSeedHex), encode(domain, clientSeed, nonce, counter));
}

export interface SeedInput {
  serverSeedHex: string;
  clientSeed: string;
  nonce: number;
  domain: string;
}

/** Deterministic byte stream built from consecutive HMAC blocks (counter = 0, 1, 2, ...). */
export class RandomStream {
  private counter = 0;
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(private readonly input: SeedInput) {
    if (!/^[0-9a-f]{64}$/.test(input.serverSeedHex)) throw new Error("server seed must be 32 bytes hex");
  }

  readBytes(n: number): Uint8Array {
    while (this.buffer.length < n) {
      const { serverSeedHex, clientSeed, nonce, domain } = this.input;
      const block = randomBlock(serverSeedHex, clientSeed, nonce, domain, this.counter);
      this.counter += 1;
      this.buffer = concat([this.buffer, block]);
    }
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }
}

/** Big-endian unsigned integer from up to 6 bytes (exact in a JS number). */
function readUintBE(bytes: Uint8Array): number {
  let x = 0;
  for (const b of bytes) x = x * 256 + b;
  return x;
}

function bitLength(n: number): number {
  // Exact integer arithmetic: never use floating-point log2 here (spec 6.6).
  return n === 0 ? 0 : n.toString(2).length;
}

const MAX_UPPER = 2 ** 48;

/** Uniform integer in [0, upper) by rejection sampling (no modulo bias). */
export function unbiasedInteger(stream: RandomStream, upper: number): number {
  if (!Number.isSafeInteger(upper) || upper < 1 || upper > MAX_UPPER) {
    throw new Error(`upper must be an integer in [1, 2^48]: ${upper}`);
  }
  if (upper === 1) return 0;
  const bits = bitLength(upper - 1);
  const nbytes = Math.ceil(bits / 8);
  const mask = 2 ** bits - 1;
  for (;;) {
    const x = readUintBE(stream.readBytes(nbytes)) % (mask + 1);
    if (x < upper) return x;
  }
}

/** Uniform float in [0, 1) with 52 bits of precision (used by Crash). */
export function unitFloat(stream: RandomStream): number {
  const x = Number(BigInt("0x" + toHex(stream.readBytes(7))) >> 4n);
  return x / 2 ** 52;
}

/** Unbiased Fisher–Yates shuffle (used by Mines). Returns a new array. */
export function shuffle<T>(stream: RandomStream, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i >= 1; i--) {
    const j = unbiasedInteger(stream, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
