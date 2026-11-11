# ROZEFLOW — notes for Claude

- Product spec (Arabic, authoritative): docs/SPEC.md. Talk to the owner (ward) in Arabic.
- Money paths: BIGINT centi-points only, never floats. Ledger and audit tables are append-only; wallet changes only through server-side SQL functions in one transaction (spec 5, 7.5).
- Fairness: HMAC message is encode(domain, client_seed, nonce, counter) only — never add server-chosen values like round ids (spec 6.4). Any change to src/lib/fairness/rng.ts must be mirrored in scripts/fairness_reference.py and vectors regenerated with `npm run vectors`.
- Odds are global per config version; never per player (spec 2.4).
- Brand: spec section 23. Orange buttons take navy text; cyan for one key element per screen; numbers use the .num class (JetBrains Mono); loss is muted grey, not red.
- Before pushing: npm run lint && npm run typecheck && npm test && npm run build, plus npm run test:db when SQL changes.
