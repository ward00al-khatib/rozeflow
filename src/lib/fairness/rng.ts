/**
 * ROZEFLOW fairness RNG — spec sections 6.4–6.7 (docs/SPEC.md).
 *
 * Every outcome is derived from HMAC-SHA-256(server_seed, encode(domain, client_seed, nonce, counter)).
 * Nothing the server chooses after committing to server_seed (such as round ids) enters the hash,
 * so the operator cannot grind for a preferred result.
 *
 * This file must stay dependency-free and deterministic: the public verifier re-implements it
 * and must produce byte-identical results.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

export const RNG_ALGORITHM_VERSION = "1.0";

/** Domain string per game, e.g. "rozeflow:v1:dice". Keeps random material separate between games. */
export function gameDomain(game: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(game)) throw new Error(`invalid game slug: ${game}`);
  return `rozeflow:v1:${game}`;
}

/** New secret server seed: 32 bytes from the OS CSPRNG, hex encoded. */
export function newServerSeed(): string {
  return randomBytes(32).toString("hex");
}

/** Public commitment published before the seed is used. */
export function commitServerSeed(serverSeedHex: string): string {
  return createHash("sha256").update(Buffer.from(serverSeedHex, "hex")).digest("hex");
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function u64be(n: bigint): Buffer {
  if (n < 0n || n >= 1n << 64n) throw new Error("u64 out of range");
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n);
  return b;
}

/** Length-prefixed encoding: each field is u32be(len) || bytes. Strings are UTF-8, integers u64be. */
export function encode(...fields: Array<string | number | bigint>): Buffer {
  const parts: Buffer[] = [];
  for (const f of fields) {
    let b: Buffer;
    if (typeof f === "string") b = Buffer.from(f, "utf8");
    else {
      if (typeof f === "number" && (!Number.isSafeInteger(f) || f < 0)) {
        throw new Error(`integer field must be a non-negative safe integer: ${f}`);
      }
      b = u64be(BigInt(f));
    }
    parts.push(u32be(b.length), b);
  }
  return Buffer.concat(parts);
}

export function randomBlock(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  domain: string,
  counter: number,
): Buffer {
  const msg = encode(domain, clientSeed, nonce, counter);
  return createHmac("sha256", Buffer.from(serverSeedHex, "hex")).update(msg).digest();
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
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly input: SeedInput) {
    if (!/^[0-9a-f]{64}$/.test(input.serverSeedHex)) throw new Error("server seed must be 32 bytes hex");
  }

  readBytes(n: number): Buffer {
    while (this.buffer.length < n) {
      const { serverSeedHex, clientSeed, nonce, domain } = this.input;
      const block = randomBlock(serverSeedHex, clientSeed, nonce, domain, this.counter);
      this.counter += 1;
      this.buffer = Buffer.concat([this.buffer, block]);
    }
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }
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
    const x = stream.readBytes(nbytes).readUIntBE(0, nbytes) % (mask + 1);
    if (x < upper) return x;
  }
}

/** Uniform float in [0, 1) with 52 bits of precision (used by Crash). */
export function unitFloat(stream: RandomStream): number {
  const b = stream.readBytes(7);
  const x = Number(BigInt("0x" + b.toString("hex")) >> 4n);
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
