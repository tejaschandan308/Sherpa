---
name: factcache-kv-scope
description: FactCache uses a server-side Vercel KV store that must stay scoped to facts only
metadata:
  type: project
---

In the Sherpa rebuild, FactCache (Maps place-pair facts) lives in a server-side Vercel KV store while trips/decisions stay in browser localStorage per CLAUDE.md.

**Why:** A global fact cache keyed by `(fact_type, place_a, place_b, mode)` must be shared across all users to avoid re-paying Maps API calls per browser — localStorage can't do that. Vercel KV free Hobby tier (30k req/mo) covers current demo traffic.

**How to apply:** The KV store must hold ONLY fact entries keyed by `(fact_type, place_a, place_b, mode)` — never trip data, never user data. Tejas explicitly wants to avoid a second informal database growing inside what is meant to be a narrow single-purpose cache. Confirm this scoping back to him whenever the KV setup changes. See [[sherpa-rebuild-judgment-engine]].
