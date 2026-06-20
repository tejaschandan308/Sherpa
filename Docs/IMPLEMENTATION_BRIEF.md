# Sherpa rebuild — implementation brief

Read this top to bottom before writing code. It's organized as a build
order: each section assumes the ones before it exist. The five companion
spec files referenced throughout (in this same folder) contain the detailed
contracts — this document is the map and the rationale connecting them.

## 0. What's changing and why

The existing Sherpa is a curation product: given a destination, it generates
a list of recommended places with editorial write-ups. It's a strong writing
voice wrapped around something any travel blog already does.

The rebuild's core value is different: **Sherpa surfaces the few decisions
that actually shape a trip — what to cut, what to split, what to skip — each
with an honest tradeoff, and renders the result as a day-by-day skeleton.**
The product is a judgment engine, not a recommendation list. Read that
sentence again before touching any code — almost every design choice below
exists to protect that one idea.

### What this means for the existing codebase

Reusable as-is: auth/account scaffolding, the Google Maps API client wiring,
the Claude API client wiring, the app shell/routing, the visual design
tokens (warm background, serif wordmark, terracotta accent — extend, don't
replace).

Not reusable, needs replacing: anything that generates a "list of N places"
output, the old trip-save data model (if it stores place lists rather than
decisions/legs), any prompt written for the old "here's what's worth seeing"
voice.

Recommendation: keep the existing repo and infrastructure. Replace the
domain logic (data model, generation pipeline, the screens listed below)
cleanly rather than incrementally patching the old place-list logic into
the new shape — the two data models are different enough that patching in
place will leave confusing half-migrated state.

## 1. The non-negotiable architectural rule

**Facts and judgment are separate, and never trust an LLM for a fact.**

- Anything checkable (distances, transit times, whether a place exists) comes
  from Google Maps APIs or the hand-curated place-tier dataset — never from
  Claude's own knowledge or recall.
- Claude's only job is reasoning over facts it's explicitly handed, and
  writing the prose voice. It never invents or estimates a number.
- Once a decision is confirmed, turning it into a skeleton itinerary
  (legs, day-blocks) is **deterministic application code, not another LLM
  call.** This is what makes "revisit a decision" safe and what makes the
  whole product checkably trustworthy rather than just plausible-sounding.

If a future feature seems to require breaking this rule, stop and reconsider
the feature rather than the rule.

## 2. Data model

Build this first — everything else reads from or writes to it.

Core entities: `Trip`, `TripShapeInput`, `Decision`, `DecisionHistory`,
`Leg`, `TransitEdge`, `DayBlock`, `Document`, `FactCache`.

Key relationships and rules:
- A `Trip` has many `Decision`s, `Leg`s, and `Document`s.
- `Decision.status` is `recommended | confirmed | overridden`; every change
  writes a `DecisionHistory` row — this is what makes the revisit-a-decision
  impact preview possible (you need the prior state to diff against).
- `Leg`s are generated FROM confirmed decisions, never authored independently.
- `DayBlock.provenance` is `generated | manual` — this flag is what stops a
  decision change from silently overwriting a user's hand-edit.
- `DayBlock.locked` becomes true automatically when a `Document` is attached
  to it (or to its parent `Leg`) — uploading a document and marking
  something "booked" are the same action, not two separate steps.
- `FactCache` is keyed by `(fact_type, place_a, place_b, mode)` — **never
  by trip_id or user_id.** A fact like "Lisbon to Porto by train" is true
  once, for everyone, not once per trip. Getting this wrong means re-paying
  for the same Maps API call on every overlapping trip across every user.
- Add a `sequence_order` integer on `Leg` (called out as a gap in design —
  legs need explicit ordering, not implicit ordering by creation time, since
  editing/reordering needs to be possible).

## 3. Facts layer

Implement before any decision-generation logic.

- Google Distance Matrix + Places API wrappers, writing through the
  `FactCache` described above.
- Cache TTL: 90 days for place-pair transit facts and place metadata —
  these don't change fast enough to justify shorter caching or per-trip
  re-fetching. See `caching_strategy.md` for the full tiering, including the
  one real exception (live traffic-aware estimates, which should NOT be
  cached at all if you ever build that — keep it visibly separate).
- Watch the direction-symmetry trap: train/driving durations can be treated
  as roughly symmetric (Lisbon→Porto ≈ Porto→Lisbon) and share a cache
  entry; flight durations cannot (wind/routing make them genuinely
  asymmetric) and must be cached per-direction. Don't apply one shortcut to
  both.
- **Place-tier dataset**: hand-curated, not fetched from anywhere. Start
  with `place_tiers.md`'s v0 dataset (Lisbon, Porto, Sintra, Douro Valley,
  Peneda-Gerês, Algarve) and extend it deliberately, one place at a time,
  against the four curation criteria in that doc — never auto-generate new
  entries with an LLM call. If a user enters a destination with no curated
  entry, the product should say so explicitly rather than guessing (see
  Section 7, empty/edge states).

## 4. Decision generation (Claude call #1)

Full contract in `decision_generation.md` — implement exactly as specified,
not loosely. The two load-bearing rules:

- Output is strict typed JSON (`stance` from a fixed enum per decision
  type — never free text the app has to re-parse).
- `reasoning` must cite at least one `fact_id` from the supplied
  `verified_facts`; a response with `confidence: high` and zero
  `facts_cited` is a generation failure, not a style issue — reject and
  regenerate.
- `confidence` is `high | close_call | worth_a_gut_check`, scored against
  the explicit rubric in the spec (facts alone decide it vs. genuinely
  depends on preference vs. mostly a feel/pace question). Don't let the
  model self-report confidence without that rubric in the system prompt.

Decision types to implement for v0 (single-region scope): `base_city`,
`region_cut`, `splurge_or_skip`, `pace`. These map directly to the four
example decisions used throughout design (Portugal: Lisbon/Porto split,
Algarve vs. north, Douro day trip, rest day).

## 5. Swipe-to-prior mapping

Full spec in `swipe_mapping.md`. Two rules that are easy to accidentally
violate while coding quickly:

- Swipe-derived priors are capped at ±0.6 strength, not ±1.0 — they're
  gut-reaction signals, not deliberate input.
- Swipe priors may only ever break ties on `close_call` /
  `worth_a_gut_check` decisions. They must never be allowed to influence a
  `high` confidence decision — confidence is computed from facts first, and
  swipe data should not even be passed into a high-confidence decision's
  prompt in a way that could shift its stance.
- Any explicit input (typed text, a button the user deliberately pressed)
  always overrides a swipe outright — not blended/averaged with it.

## 6. Leg and day-block generation (deterministic, no LLM)

Full spec and pseudocode in `leg_generation.md`. Build this as ordinary,
testable application code — unit tests should cover: base_city=split vs.
single producing the right leg set, region_cut removing the right leg and
its transit edges, pace=relaxed inserting open day-blocks at the right
cadence, and the splurge/skip decisions adding or omitting specific blocks.

After structure is generated, one Claude call per leg (the "voice pass")
writes the short "why this is here" captions. This call may only write
prose — if its output references a place or number not already present in
the input structure handed to it, discard and retry. It must never be
allowed to alter night counts, reorder blocks, or add a block.

## 7. Screens, in build order

Each screen's underlying design rationale is in the conversation history;
this section is just the punch list plus the one or two implementation
notes that matter most per screen.

1. **Landing page** — hero shows a real, static example decision card
   (stance + crossed-out alternative), not a generic illustration. Entry
   input collects destination only — dates come on the next screen.
2. **Destination + dates** — minimal, two fields. Validate destination
   against the curated place-tier dataset; if unrecognized, show the honest
   "we don't have a confident read on this yet" message rather than
   proceeding into the swipe quiz with nothing to ground it.
3. **Swipe quiz** — 6 cards, one card per dimension (depth_breadth, pace,
   risk_tolerance, transit_tolerance, food_vs_culture, structure), generated
   per-trip using the real destination (statements should name real places/
   distances where possible, not be generic). No personality-result screen
   at the end — go straight to a bridge screen instead.
4. **Bridge screen** — surfaces only the 2-3 strongest swipe signals, phrased
   softly ("you'd lean toward...") to match the ±0.6 strength of the
   underlying data. This is the receipt for the swipe quiz, not a results page.
5. **Decisions screen** — ask-first pattern: show the question/tension,
   wait for the user's answer (or an open-ended reply), THEN show the
   stance + tradeoff framed as a response to what they said. Never lead
   with an unprompted verdict — this was a deliberate correction made
   during design after testing the alternative.
6. **Skeleton itinerary** — render from `Leg`/`DayBlock` data only, never a
   separate generative pass. No clock times, no specific restaurant
   picks — the deliberate restraint here is a feature; resist scope creep
   toward hour-by-hour precision.
7. **My trips dashboard** — cards show decision-completion status
   ("4 of 4 decisions made") and locked/booked count, not the old
   "places curated" framing. Sort by proximity to departure date, not by
   creation date or alphabetically.
8. **Revisit a decision** — changing a confirmed decision must show an
   impact preview (which legs/day-blocks would change, which of those are
   locked or manually edited) BEFORE committing the change. Sherpa never
   claims to cancel real-world bookings on the user's behalf — state
   explicitly that the user needs to handle that themselves.
9. **Trip documents** — upload attaches to a `Leg` or specific `DayBlock`
   (nullable — can be unattached, resolved later from the all-documents
   shelf). Attaching a document sets `locked = true` automatically. No
   parsing/extraction of document contents in v0 — it's a tagged file
   shelf, not an ingestion pipeline.
10. **Share/export** — read-only view for a travel companion. Reasoning/
    "why this" text is present but collapsed by default, not the headline.
    No swipe-quiz or decision-editing access for the viewer; "copy to my
    trips" forks a new, independently-editable trip rather than allowing
    shared edit access to one trip's decisions.
11. **Empty/edge states** — no-trips-yet, vague destination ("Europe" is
    too broad — ask for a country or region), and decision-vs-manual-edit
    conflict (lightweight banner: "keep my edit" / "use the decision",
    no auto-resolution either direction).

## 8. Explicitly out of scope for this build

- **Multi-country trip composition** (e.g. Budapest + Berlin + Amsterdam +
  Brussels as one trip) — the architecture generalizes (legs/transit edges
  don't care about country borders) but the product doesn't yet, because
  it would need a new upstream decision type for choosing the city set
  itself, plus far broader place-tier curation up front. Documented in
  detail in `place_tiers.md`. Don't design around this in v0; don't block
  on it either.
- **Booking ingestion/parsing** — documents are stored and tagged, never
  parsed for structured data (dates, confirmation numbers). If a future
  version wants the revisit-a-decision warnings to show parsed booking
  details, that requires real document parsing — out of scope here.
- **Live traffic-aware transit estimates** — flagged in the caching spec as
  a deliberately separate, uncached category if it's ever built; not
  needed for v0 decisions, which rely on static transit facts.

## 9. Suggested build order, end to end

1. Data model + migrations
2. Facts layer (Maps client + cache + place-tier dataset, seeded with the
   v0 places list)
3. Decision generation call + validation (facts_cited check, confidence
   rubric)
4. Leg/day-block deterministic generator + unit tests
5. Swipe-to-prior mapping
6. Voice-pass caption generation
7. Screens, in the order listed in Section 7
8. Revisit-a-decision impact preview (depends on everything above existing
   first)
9. Documents + locking
10. Share/export
11. Empty/edge states (can be threaded in throughout, but verify all of
    them explicitly before considering this done)

Companion files in this folder: `decision_generation.md`,
`leg_generation.md`, `place_tiers.md`, `swipe_mapping.md`,
`caching_strategy.md`.
