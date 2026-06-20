# Leg and day-block generation — deterministic, not generative

## Core rule

Once decisions are confirmed, generating legs and day-blocks is ordinary
application logic — branching on enum values, doing arithmetic on day counts,
looking up cached transit times. No LLM call should be involved in deciding
WHAT the structure is. An LLM call may be used afterward only to write the
short prose caption attached to an already-decided block (see voice pass,
below) — and that call cannot alter dates, durations, or which leg exists.

This is the guarantee the whole "revisit a decision" feature depends on:
if generation were itself generative, two runs over identical decision state
could produce different skeletons, and the contradiction-detection feature
(flagging when a skeleton disagrees with a stated decision) becomes
meaningless, because there's no longer a deterministic expectation to check
the output against.

## Pseudocode

```python
def generate_legs(trip, decisions):
    legs = []

    base_city = decisions["base_city"].stance       # "split" | "single"
    region_cut = decisions.get("region_cut")          # may not exist if N/A
    splurge_douro = decisions.get("splurge_douro")
    pace = trip.trip_shape.pace                       # "relaxed"|"standard"|"packed"

    if base_city == "split":
        legs.append(Leg(place="Lisbon", role="primary"))
        legs.append(Leg(place="Porto", role="primary"))
        edges.append(TransitEdge(
            from_leg="Lisbon", to_leg="Porto",
            **lookup_cached_transit("Lisbon", "Porto")  # real Maps data, cached
        ))
    else:
        legs.append(Leg(place="Lisbon", role="primary"))

    if region_cut and region_cut.stance == "cut_algarve":
        legs.append(Leg(place="Peneda-Geres", role="secondary"))
    elif region_cut and region_cut.stance == "cut_porto":
        legs.append(Leg(place="Algarve", role="secondary"))
        legs = [l for l in legs if l.place != "Porto"]
        edges = [e for e in edges if "Porto" not in (e.from_leg, e.to_leg)]

    nights_total = trip.days_total - 1
    legs = allocate_nights(legs, nights_total, pace)
    # allocate_nights is a real, testable function: distributes nights across
    # legs proportional to place-tier weight (a multi_day_city tier gets more
    # nights per visit than a day_trippable tier), then adjusts ±1 night to
    # hit the exact total. This is arithmetic, not a model call.

    return legs, edges


def generate_day_blocks(leg, decisions):
    blocks = []
    pace = ...  # from trip_shape

    if leg.is_first_leg_of_trip:
        blocks.append(DayBlock(kind="arrival", note="light_day"))

    # Splurge/skip decisions add or remove specific day-blocks within a leg
    if decisions.get("splurge_douro") and decisions["splurge_douro"].stance == "add":
        blocks.append(DayBlock(kind="day_trip", target="Douro Valley"))

    remaining_days = leg.nights - len(blocks)
    blocks += fill_remaining_days(remaining_days, leg, pace)
    # fill_remaining_days applies the pace decision: "relaxed" inserts an
    # explicit open/no-plan block roughly every 4-5 days, "packed" doesn't.
    # This is the ONLY place pace.rest_day logic lives — single source,
    # so it can't silently diverge from what the pace decision said.

    return blocks
```

## Correction: fact cache is global, not trip-scoped

The earlier persistence diagram showed FACT_CACHE as trip-scoped
(`trip_id` caches facts). That's wrong for cost reasons: Lisbon-Porto transit
time is the same fact regardless of which trip or which user asks for it.
The cache should be keyed purely on `(fact_type, place_from, place_to)` —
or `(fact_type, place)` for single-place facts — with NO trip_id or user_id
in the key at all. See caching_strategy.md for the full design. This is a
genuine correction to the schema, not a refinement: a trip-scoped cache
means the same Distance Matrix call gets re-paid for every overlapping trip
across every user, which is the exact cost problem caching exists to avoid.

## Where the LLM re-enters: the voice pass

After legs and day-blocks exist as plain data, a single Claude call per leg
(not per day-block, to control cost) generates the "why this is here" caption
for the leg and each of its blocks in one shot.

Input: the already-decided leg/day-block structure (place names, night
counts, which decisions produced them) plus the same verified_facts used for
decision generation.

Output: short captions only — a `{leg_id / block_id: caption_text}` map. This
call is NOT permitted to change night counts, reorder blocks, or invent a
place not already in the structure. If a response includes a place or number
not present in the input structure, discard and retry — same validation
discipline as the decision-generation contract.

## Validating against contradictions (the Day 11 case)

Because day-block generation is deterministic and reads directly from
decisions, the "contradicts what you said" bug from the early mockup
shouldn't be reachable through normal generation — it can only happen if:

1. The user hand-edits a block directly (covered by the provenance flag /
   manual-edit-conflict design), or
2. A decision is changed AFTER legs were generated, and regeneration hasn't
   run yet (covered by the revisit-a-decision impact-preview flow).

Both cases are already designed for. This is worth stating explicitly: the
contradiction-checking UI we built earlier is not patching over a flaw in
generation — it's handling the two legitimate cases where stored state and
decisions can honestly diverge (user intervention, or a pending decision
change), not covering for an unreliable generator.
