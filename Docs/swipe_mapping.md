# Swipe-to-prior mapping

## What a swipe is allowed to influence, and what it isn't

A swipe is a fast, low-deliberation signal — useful for breaking ties and
shaping framing, not strong enough to override what verified facts say.

Hard rule: swipe priors may only affect decisions where
`confidence != "high"`. A high-confidence decision (the facts alone settle
it) is generated and framed the same way regardless of swipe answers. This
keeps a single careless swipe from quietly overruling something like "Porto
isn't a day trip," which would undermine the one thing this product can't
afford to get wrong: being checkably correct on hard facts.

## Card-to-dimension mapping (v0: one card per dimension)

```json
[
  {"card_id": "swipe_1", "dimension": "depth_breadth", "agree_direction": "depth"},
  {"card_id": "swipe_2", "dimension": "pace", "agree_direction": "relaxed"},
  {"card_id": "swipe_3", "dimension": "risk_tolerance", "agree_direction": "low_risk"},
  {"card_id": "swipe_4", "dimension": "transit_tolerance", "agree_direction": "high_tolerance"},
  {"card_id": "swipe_5", "dimension": "food_vs_culture", "agree_direction": "food"},
  {"card_id": "swipe_6", "dimension": "structure", "agree_direction": "loose"}
]
```

One card per dimension is a deliberate v0 simplification — it keeps the deck
at 6 cards. It also means a single swipe IS the dimension's entire signal, so
the per-swipe strength has to stay moderate (see below) precisely because
there's no second data point to average against.

## Mapping a swipe to a numeric prior

```python
def swipe_to_prior(card, answer):
    # answer: "agree" or "disagree"
    direction = 1 if answer == "agree" else -1
    raw_value = direction * SWIPE_STRENGTH   # not +-1.0 — see below
    return {
        "dimension": card.dimension,
        "value": raw_value,          # range: -0.6 to +0.6
        "source": "swipe",
        "card_id": card.card_id
    }

SWIPE_STRENGTH = 0.6
```

`0.6`, not `1.0`: leaves headroom. If a later input (e.g. the explicit
"one thing you don't want to miss" free-text field) contradicts the swipe,
that explicit, deliberate input should be able to outweigh a fast gut-reaction
swipe. Reserve the ±0.8-1.0 range for inputs the user gave deliberately and
in detail, not in half a second.

## How priors enter the decision-generation input

The `trip_shape` object passed into decision generation (see
decision_generation.md) is the merge point:

```python
def build_trip_shape(swipe_priors, explicit_inputs):
    shape = {}
    for dim in ALL_DIMENSIONS:
        swipe_value = next((p.value for p in swipe_priors if p.dimension == dim), 0)
        explicit_value = explicit_inputs.get(dim)  # None if not given

        if explicit_value is not None:
            # explicit input always wins outright — not blended, replaced
            shape[dim] = {"value": explicit_value, "source": "explicit"}
        else:
            shape[dim] = {"value": swipe_value, "source": "swipe"}
    return shape
```

Explicit inputs (the depth/breadth toggle if we ever add one back, the pace
buttons, the "don't want to miss" field) always override a swipe outright —
they are not averaged together. A swipe is a fallback prior for dimensions
the user didn't explicitly weigh in on, not a vote that competes with
deliberate input.

## Surfacing this in the bridge screen

The bridge screen (sherpa_post_swipe_bridge) should only narrate the
strongest 2-3 priors by absolute value, not all six — a |0.6| value isn't
strong enough to claim as a confident read on its own, so the bridge screen's
phrasing should stay soft ("you'd lean toward...") rather than declarative
("you are a depth traveler"). This matches the moderate strength chosen
above — the UI tone and the underlying number need to agree with each other,
or the interface will sound more certain than the data actually supports.

## What this means for decision generation's confidence rubric

When a `close_call` or `worth_a_gut_check` decision is generated and a
relevant swipe prior exists, the model should be given that prior explicitly
and instructed to let it break the tie in framing and stance — but the
`reasoning` field must still cite a verified fact first; the swipe prior may
only tip which side of a genuine tie the stance lands on, never substitute
for a missing fact.
