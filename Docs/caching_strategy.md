# Maps API caching strategy

## The one rule that matters most

Cache keys must never include `trip_id` or `user_id` for facts that are true
regardless of who's asking. "How far is Lisbon from Porto" has exactly one
correct cache entry across the entire product, not one per trip. Getting
this wrong doesn't just waste money — at scale, it's the difference between
O(unique place pairs) API calls and O(trips), which grows far faster and
defeats the point of caching at all.

## Cache tiers, by data type

### Tier 1 — effectively permanent facts
- **What:** Place existence/metadata (Places API), static distance/duration
  between two places by a given mode (Distance Matrix, non-traffic-aware)
- **Cache key:** `(fact_type, place_a, place_b, mode)` — alphabetically sort
  place_a/place_b so Lisbon→Porto and Porto→Lisbon share one cache entry
  where direction doesn't matter (duration does change by direction for
  some modes — e.g. flights with prevailing winds — so direction-sensitive
  fact_types should NOT be sorted; default to treating duration as symmetric
  only for train/drive, not flight)
- **TTL:** 90 days. Infrastructure between two cities doesn't meaningfully
  change faster than that. Even at 90 days this is conservative — a yearly
  refresh would likely be fine, but cheap to be safe here.
- **Invalidation:** none needed beyond TTL expiry. No write path other than
  "refetch when stale."

### Tier 2 — place-tier heuristics (hand-curated, not from Maps at all)
- **What:** `sherpa_place_heuristics` data (see place_tiers.md)
- **Cache key:** N/A — this isn't fetched, it's stored directly as
  first-party data. Mentioned here only to be explicit that this tier
  never touches the Maps API budget at all.

### Tier 3 — request-time, not cached
- **What:** Live traffic-aware driving estimates, if ever used (e.g. "how
  long will the drive to the airport take given current traffic")
- **Cache key:** N/A — deliberately not cached
- **Why:** this is the one category of fact that's genuinely time-sensitive.
  Mixing it into the Tier 1 cache would serve stale traffic data with the
  same false confidence we've designed against everywhere else in this
  product. If a future feature needs this, it should be visibly excluded
  from the long-lived cache, not an exception buried inside it.

## Cache population: lazy vs. pre-warmed

- **Lazy (default):** fetch a place-pair fact the first time any trip
  actually needs it, store it, reuse forever after (until TTL). This is
  correct for the single-region product as scoped today — there's no need
  to pre-fetch facts for places nobody's asked about yet.
- **Pre-warmed (only relevant if multi-country composition is ever built):**
  the deferred trip_composition feature would need all-pairs transit data
  for a candidate city set BEFORE any user-facing recommendation — that's
  inherently a burst of speculative, non-lazy fetches. Flagging this here
  because it's a real cost driver specific to that deferred feature, not
  something the current lazy strategy needs to handle.

## Estimating real cost at small scale

For the current single-region scope (a handful of hand-curated
destinations, each with maybe 3-6 places), the total number of unique
place-pairs needing a Distance Matrix call is small and roughly fixed —
it does NOT grow with the number of users or trips, only with the number of
curated places. This is the actual payoff of getting the cache key right:
cost is a function of curation breadth, not traffic. A trip-scoped cache
would have made cost scale with usage instead, which is the wrong shape for
a product trying to grow.

## What invalidates a cache entry early (rare, manual)

- A real-world change Sherpa becomes aware of (e.g. a rail line closes) —
  manual invalidation of that specific key, not a systemic concern at
  current scale.
- Otherwise: nothing. Let TTL expiry handle staleness.
