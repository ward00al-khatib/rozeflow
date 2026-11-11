"""Independent reference implementation of the ROZEFLOW fairness RNG (spec 6.4-6.7).

Written separately from src/lib/fairness/rng.ts on purpose: the TypeScript tests compare
against the vectors this script produces, so a bug in one implementation shows up as a mismatch.

Usage:  python3 scripts/fairness_reference.py > src/lib/fairness/test-vectors.json
"""
import hashlib
import hmac
import json
import struct


def encode(*fields):
    out = b""
    for f in fields:
        b = f.encode("utf-8") if isinstance(f, str) else struct.pack(">Q", f)
        out += struct.pack(">I", len(b)) + b
    return out


class Stream:
    def __init__(self, server_seed_hex, client_seed, nonce, domain):
        self.key = bytes.fromhex(server_seed_hex)
        self.client_seed, self.nonce, self.domain = client_seed, nonce, domain
        self.counter, self.buf = 0, b""

    def read(self, n):
        while len(self.buf) < n:
            msg = encode(self.domain, self.client_seed, self.nonce, self.counter)
            self.buf += hmac.new(self.key, msg, hashlib.sha256).digest()
            self.counter += 1
        out, self.buf = self.buf[:n], self.buf[n:]
        return out


def unbiased_integer(s, upper):
    if upper == 1:
        return 0
    bits = (upper - 1).bit_length()
    nbytes = (bits + 7) // 8
    mask = (1 << bits) - 1
    while True:
        x = int.from_bytes(s.read(nbytes), "big") & mask
        if x < upper:
            return x


def unit_float(s):
    return (int.from_bytes(s.read(7), "big") >> 4) / 2**52


def shuffle(s, items):
    a = list(items)
    for i in range(len(a) - 1, 0, -1):
        j = unbiased_integer(s, i + 1)
        a[i], a[j] = a[j], a[i]
    return a


def domain(game):
    return f"rozeflow:v1:{game}"


SERVER_SEED = "9f" * 32

CASES = [
    ("dice", "alpha", 0, "integer", {"upper": 10000}),
    ("dice", "alpha", 1, "integer", {"upper": 10000}),
    ("dice", "beta", 0, "integer", {"upper": 10000}),
    ("roulette", "alpha", 0, "integer", {"upper": 37}),
    ("roulette", "alpha", 99, "integer", {"upper": 37}),
    ("plinko", "alpha", 0, "integer", {"upper": 2}),
    ("slots", "alpha", 0, "integer", {"upper": 257}),
    ("crash", "alpha", 0, "float", {}),
    ("crash", "alpha", 1, "float", {}),
    ("mines", "alpha", 0, "shuffle", {"size": 25}),
    ("mines", "عربي", 5, "shuffle", {"size": 25}),
]


def main():
    cases = []
    for game, cs, nonce, kind, extra in CASES:
        s = Stream(SERVER_SEED, cs, nonce, domain(game))
        if kind == "integer":
            exp = unbiased_integer(s, extra["upper"])
        elif kind == "float":
            exp = unit_float(s)
        else:
            exp = shuffle(s, range(extra["size"]))
        cases.append({"game": game, "clientSeed": cs, "nonce": nonce, "kind": kind, **extra, "expected": exp})
    commit = hashlib.sha256(bytes.fromhex("0" * 63 + "1")).hexdigest()
    print(json.dumps({"serverSeed": SERVER_SEED, "commit": commit, "cases": cases}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
