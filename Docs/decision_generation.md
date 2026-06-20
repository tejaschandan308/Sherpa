# Decision generation — technical contract

## Why this needs to be strict

The decisions screen is the core product. If Claude's output here is loose prose
that gets re-interpreted downstream, every other screen (skeleton itinerary,
revisit-a-decision, dashboard status) inherits that ambiguity. This call must
return typed, enum-constrained JSON — never free text that the app has to parse
with string matching.

## Input to the model (per decision type)

```json
{
  "decision_type": "base_city",
  "trip": {
    "destination": "Portugal",
    "days_total": 14,
    "start_date": "2026-06-04"
  },
  "trip_shape": {
    "first_time": true,
    "depth_breadth_prior": "depth",
    "depth_breadth_strength": 0.7,
    "pace": "standard"
  },
  "verified_facts": [
    {
      "fact_id": "transit_lisbon_porto",
      "type": "transit_time",
      "from": "Lisbon",
      "to": "Porto",
      "duration_minutes": 190,
      "mode": "train",
      "source": "google_distance_matrix"
    },
    {
      "fact_id": "place_tier_porto",
      "type": "place_tier",
      "place": "Porto",
      "tier": "multi_day_city",
      "source": "sherpa_place_heuristics"
    }
  ],
  "prior_answers": [
    {
      "card_id": "swipe_depth_1",
      "statement": "I'd rather know two places well than skim six.",
      "answer": "agree"
    }
  ]
}
```

Note: `verified_facts` are always fetched from Maps/heuristics and injected here.
Claude is never asked to supply or recall a distance, duration, or place fact —
only to reason over facts it's handed.

## Required output schema

```json
{
  "decision_type": "base_city",
  "stance": "split",
  "headline": "Split Lisbon and Porto — don't day-trip Porto from Lisbon.",
  "reasoning": "Porto is roughly 3 hours from Lisbon by train, so a day trip means about 6 hours of travel for half a day on the ground. With 14 days, there's room to actually stay in both.",
  "tradeoff": "Costs one hotel switch and a travel day. Staying Lisbon-only is simpler, but Porto becomes a thin sample, not a real visit.",
  "confidence": "high",
  "confidence_rationale": "The transit time alone makes a day trip impractical regardless of preference; this isn't primarily a taste call.",
  "facts_cited": ["transit_lisbon_porto"],
  "depends_on": [],
  "enables": ["region_cut", "splurge_douro"]
}
```

### Field rules

- `stance` — must be one value from a fixed enum defined per `decision_type`.
  Never free text. This is what downstream rendering branches on.
- `headline` — single sentence, the stance in plain language. This is what's
  shown big on the decisions screen.
- `reasoning` — 1-2 sentences. Validation rule: must reference at least one
  `fact_id` from the input (checked via `facts_cited`, not by re-parsing prose).
  If reasoning can't be tied to a supplied fact, regenerate — this is the
  guardrail against the model inventing plausible-sounding but unverified claims.
- `tradeoff` — the honest cost, always required, never empty. A decision with
  no stated tradeoff should fail validation and not ship to the screen.
- `confidence` — one of `high` / `close_call` / `worth_a_gut_check`. Prompted
  against explicit criteria (see below), not left to the model's own judgment
  of "how sure do I feel."
- `facts_cited` — array of fact_ids actually used. Empty array should be
  treated as a generation failure for any decision with `confidence: high`.
- `depends_on` / `enables` — which other decisions this one's stance affects
  downstream (e.g. base_city's outcome determines whether `region_cut` even
  needs to be asked). This is what lets the legs generator know the decision
  graph, not just a flat list.

## Confidence rubric (given to the model as part of the system prompt)

- `high` — the verified facts alone make one stance clearly better regardless
  of the traveler's preferences. Example: a 3-hour one-way transit time makes
  a "day trip" stance impractical on its own.
- `close_call` — verified facts support either stance reasonably; the right
  answer genuinely depends on what the traveler values. Example: cutting the
  Algarve vs. cutting Porto.
- `worth_a_gut_check` — the stance is more about trip *feel* (pace, energy)
  than hard constraints, and reasonable travelers disagree on principle, not
  just on this trip's specifics.

The model should never default to `high` — `close_call` is the expected
common case. A decision set where every item is `high` confidence is itself
a signal of bad calibration and should be flagged in eval, not shipped.

## What happens to a decision after generation

1. Stored as a row: `{trip_id, decision_type, stance, headline, reasoning,
   tradeoff, confidence, facts_cited, status: 'recommended' | 'confirmed' |
   'overridden', user_answer}`
2. Rendered on the decisions screen using the "ask first" framing pattern —
   the headline/reasoning are NOT shown until after the user responds to the
   framed question (see decisions_screen_v2 design).
3. Once confirmed or overridden, `stance` becomes the actual input to leg
   generation — a plain deterministic function, not another model call.
