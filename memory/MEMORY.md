# Memory index

- [Sherpa rebuild: judgment engine](sherpa-rebuild-judgment-engine.md) — old curation product → decisions+tradeoffs+skeleton; facts/judgment strictly separated; skeleton gen is deterministic, never an LLM call.
- [FactCache KV scope](factcache-kv-scope.md) — FactCache lives in Vercel KV, scoped to facts only `(fact_type, place_a, place_b, mode)`; never trip/user data.
- [UI review by seeded example](ui-review-by-seeded-example.md) — Tejas reviews UI by feel against a seeded demo matching the mockups; deliver big UI work in batches.
