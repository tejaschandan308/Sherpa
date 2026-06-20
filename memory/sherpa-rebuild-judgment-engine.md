---
name: sherpa-rebuild-judgment-engine
description: Sherpa is being rebuilt from a curation product into a judgment engine
metadata:
  type: project
---

Sherpa is being rebuilt (started 2026-06-20). Old product: given a destination, an LLM generated a list of recommended places with editorial write-ups. New core value: surface the few decisions that actually shape a trip (what to cut/split/skip), each with an honest tradeoff, rendered as a day-by-day skeleton itinerary. It's a judgment engine, not a recommendation list.

**Why:** Almost every architecture choice exists to protect that one idea. Full spec in `Docs/IMPLEMENTATION_BRIEF.md` + five companion files (decision_generation, leg_generation, place_tiers, swipe_mapping, caching_strategy).

**How to apply:** Non-negotiable rule — facts and judgment stay strictly separated; never trust an LLM for a checkable fact (distances/transit/place existence come from Google Maps or the hand-curated place-tier dataset). Once a decision is confirmed, generating the skeleton itinerary is DETERMINISTIC application code, never another LLM call. The old `app/api/recommend/route.ts` (one mega-prompt doing everything) is the anti-pattern being replaced. Build order in brief Section 9. See [[factcache-kv-scope]].
