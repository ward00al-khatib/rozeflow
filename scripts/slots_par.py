"""
Slots PAR sheet, base game, by full enumeration of all 50^5 stop combinations (spec 4.3).

Reads config/games/slots.json and prints the exact mean (in line bets), hit frequency, variance
and the largest pay of one spin. The exact RTP itself is also checked in slots.test.ts; this script
gives the numbers stored under payout_model.par. Needs numpy; takes about a minute.

    python3 -I scripts/slots_par.py
"""
import json
import pathlib
import time
from fractions import Fraction

import numpy as np

cfg = json.loads((pathlib.Path(__file__).resolve().parent.parent / "config/games/slots.json").read_text())
rules, pm = cfg["rules"], cfg["payout_model"]
syms = rules["symbols"]["high"] + rules["symbols"]["low"]
WILD, SCATTER = len(syms), len(syms) + 1
names = syms + [rules["symbols"]["wild"], rules["symbols"]["scatter"]]
S = np.array([[names.index(x) for x in st] for st in rules["strips"]])
L = S.shape[1]
assert all(len(st) == L for st in rules["strips"])
pay = np.zeros((len(names), 6), dtype=np.int64)
for i, s in enumerate(syms):
    pay[i, 3:] = pm["pays"][s]

idx = np.arange(L)
g2, g3, g4 = (g.ravel() for g in np.meshgrid(idx, idx, idx, indexing="ij"))
tot = tot2 = hits = mx = 0
t = time.time()
for r0 in range(L):
    for r1 in range(L):
        units = np.zeros(g2.size, dtype=np.int64)
        for ln in rules["lines"]:
            a = S[0, (r0 + ln[0]) % L]
            if a >= WILD:
                continue
            b = S[1, (r1 + ln[1]) % L]
            if not (b == a or b == WILD):
                continue
            c = S[2, (g2 + ln[2]) % L]
            d = S[3, (g3 + ln[3]) % L]
            e = S[4, (g4 + ln[4]) % L]
            mc = (c == a) | (c == WILD)
            md = mc & ((d == a) | (d == WILD))
            me = md & ((e == a) | (e == WILD))
            units += pay[a][2 + mc.astype(np.int64) + md + me]
        tot += int(units.sum())
        tot2 += int((units * units).sum())
        hits += int((units > 0).sum())
        mx = max(mx, int(units.max()))
N = L**5
lines = len(rules["lines"])
print(f"enumerated {N:,} spins in {time.time() - t:.0f}s")
print("base RTP (exact):", Fraction(tot, N * lines), float(Fraction(tot, N * lines)))
print("base hit frequency:", hits / N)
print("base SD per spin (stakes):", ((tot2 / N) / lines**2 - (tot / N / lines) ** 2) ** 0.5)
print("largest pay of one spin (line bets):", mx)
