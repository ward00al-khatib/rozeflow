import { describe, expect, it } from "vitest";
import {
  RandomStream,
  commitServerSeed,
  encode,
  gameDomain,
  newServerSeed,
  randomBlock,
  shuffle,
  toHex,
  unbiasedInteger,
  unitFloat,
} from "./rng";
import vectors from "./test-vectors.json";

const SEED = "0".repeat(63) + "1";
const same = (a: Uint8Array, b: Uint8Array) => toHex(a) === toHex(b);

function stream(nonce = 0, game = "dice", clientSeed = "player-seed") {
  return new RandomStream({ serverSeedHex: SEED, clientSeed, nonce, domain: gameDomain(game) });
}

describe("encode", () => {
  it("length-prefixes fields so different splits never collide", () => {
    expect(same(encode("ab", "c"), encode("a", "bc"))).toBe(false);
  });
  it("rejects negative and unsafe integers", () => {
    expect(() => encode(-1)).toThrow();
    expect(() => encode(2 ** 60)).toThrow();
  });
});

describe("commit", () => {
  it("is SHA-256 of the raw seed bytes", () => {
    expect(commitServerSeed(SEED)).toMatch(/^[0-9a-f]{64}$/);
    expect(commitServerSeed(SEED)).toBe(vectors.commit);
  });
  it("new seeds are 32 random bytes", () => {
    const a = newServerSeed();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(newServerSeed());
  });
});

describe("determinism and separation", () => {
  it("same inputs give the same block", () => {
    expect(same(randomBlock(SEED, "c", 1, "d", 0), randomBlock(SEED, "c", 1, "d", 0))).toBe(true);
  });
  it("nonce, client seed and game domain each change the output", () => {
    const base = stream().readBytes(32);
    expect(same(stream(1).readBytes(32), base)).toBe(false);
    expect(same(stream(0, "dice", "other").readBytes(32), base)).toBe(false);
    expect(same(stream(0, "roulette").readBytes(32), base)).toBe(false);
  });
  it("reading across block boundaries is consistent", () => {
    const a = stream().readBytes(70);
    const s = stream();
    const b = new Uint8Array([...s.readBytes(30), ...s.readBytes(40)]);
    expect(same(a, b)).toBe(true);
  });
});

describe("unbiasedInteger", () => {
  it("handles edge bounds", () => {
    expect(unbiasedInteger(stream(), 1)).toBe(0);
    for (const upper of [2, 3, 8, 37, 256, 257, 10000, 2 ** 48]) {
      const v = unbiasedInteger(stream(5), upper);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(upper);
    }
    expect(() => unbiasedInteger(stream(), 0)).toThrow();
    expect(() => unbiasedInteger(stream(), 2 ** 48 + 1)).toThrow();
  });

  it("is uniform (chi-square, 37 buckets, 200k draws)", () => {
    const buckets = new Array(37).fill(0);
    const s = stream(42, "roulette");
    const n = 200_000;
    for (let i = 0; i < n; i++) buckets[unbiasedInteger(s, 37)]++;
    const expected = n / 37;
    const chi = buckets.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
    // df = 36; p = 0.001 critical value ≈ 67.99
    expect(chi).toBeLessThan(68);
  });
});

describe("unitFloat and shuffle", () => {
  it("unitFloat is in [0, 1)", () => {
    const s = stream(7, "crash");
    for (let i = 0; i < 1000; i++) {
      const u = unitFloat(s);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
  it("shuffle is a permutation", () => {
    const out = shuffle(stream(3, "mines"), [...Array(25).keys()]);
    expect([...out].sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
  });
});

describe("published test vectors", () => {
  it("match exactly", () => {
    for (const v of vectors.cases) {
      const s = new RandomStream({
        serverSeedHex: vectors.serverSeed,
        clientSeed: v.clientSeed,
        nonce: v.nonce,
        domain: gameDomain(v.game),
      });
      const got =
        v.kind === "integer"
          ? unbiasedInteger(s, v.upper!)
          : v.kind === "float"
            ? unitFloat(s)
            : shuffle(s, [...Array(v.size!).keys()]);
      expect(got).toEqual(v.expected);
    }
  });
});
