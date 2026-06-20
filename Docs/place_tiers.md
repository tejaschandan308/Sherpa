# Place tiers — hand-curated dataset (v0)

## Why hand-curated, and how to keep it defensible

This data answers one question per place: "how much time does this place
genuinely deserve, before either rushing it or running out of things to do."
That's a judgment call, which is exactly why it shouldn't be sourced from an
LLM right now — an LLM asked this question will produce a plausible-sounding
number with no accountability behind it, and the whole product's credibility
rests on these numbers being right (a user can check "is Porto really not a
day trip" against their own quick research in five minutes).

Hand-curating doesn't mean unstructured opinion. Every entry below is scored
against the same four criteria, so a reviewer (including future-you) can
audit a single entry without re-deriving the whole judgment from scratch.

## Curation criteria (applied consistently to every place)

1. **Density of things worth doing** — could a reasonably interested visitor
   fill the proposed time without padding, and would they still want more?
2. **Effort to access vs. effort to experience** — is most of a visit spent
   getting there, or being there?
3. **Risk of "tourist skim"** — does the minimum reasonable visit actually
   deliver the place's character, or just its postcard version?
4. **Local pace** — does the place itself reward slowness (a city you live in
   for a few days) or is it inherently a single concentrated experience
   (a specific site, a single hike)?

## v0 dataset

```json
[
  {
    "place": "Lisbon",
    "tier": "multi_day_city",
    "min_nights": 4,
    "max_reasonable_nights": 8,
    "justification": "Dense, walkable, multiple distinct neighborhoods with real character differences. Under 4 nights skims the surface; rewards staying."
  },
  {
    "place": "Porto",
    "tier": "multi_day_city",
    "min_nights": 3,
    "max_reasonable_nights": 6,
    "justification": "Smaller than Lisbon but still a real city, not a single site. A day trip only covers the riverside postcard view."
  },
  {
    "place": "Sintra",
    "tier": "day_trippable",
    "min_nights": 0,
    "max_reasonable_nights": 1,
    "justification": "A cluster of palaces and a forested hill, all within a small radius. One full day covers it properly; an overnight is a preference, not a necessity."
  },
  {
    "place": "Douro Valley",
    "tier": "half_day_stop",
    "min_nights": 0,
    "max_reasonable_nights": 0,
    "justification": "The experience is the view and a winery visit, not a place you live in for a day. A single day trip delivers the full experience; more time has diminishing return unless staying at a specific quinta is the point of the trip."
  },
  {
    "place": "Peneda-Geres National Park",
    "tier": "multi_day_region",
    "min_nights": 2,
    "max_reasonable_nights": 4,
    "justification": "A spread-out hiking region, not a single site — different valleys and trailheads are genuinely far apart inside the park itself. One day only reaches whichever single trailhead you picked."
  },
  {
    "place": "Algarve (Tavira / Lagos area)",
    "tier": "multi_day_region",
    "min_nights": 2,
    "max_reasonable_nights": 5,
    "justification": "A coastline of distinct towns and beaches, not one location. Rewards picking 1-2 bases rather than rushing between towns."
  }
]
```

## Process for adding a new place

1. Apply the four criteria above explicitly — write one line against each,
   not just a final number.
2. Cross-check `min_nights` against real transit data (a place 5+ hours from
   the nearest other leg effectively raises its own minimum, since getting
   there is now a cost that has to be amortized over more days).
3. New entries should be reviewed before being trusted by decision generation
   — this is a deliberate manual gate while the dataset is small. At v0
   scale (a handful of destinations), there's no good reason to skip it.

## What happens when a place isn't in the dataset yet

Decision generation should treat an unrecognized place as a hard stop, not a
guess: surface "we don't have a confident read on [place] yet" rather than
asking Claude to estimate a tier on the fly. This is the same discipline as
the facts_cited validation in decision generation — better to admit a gap
than to quietly degrade into the thing this whole architecture was built to
avoid.

## Known scope boundary: multi-country trip composition (v0 non-goal)

Sherpa v0 assumes the user has already chosen a region/country and is
reasoning about HOW to spend time within it (which cities, how to split
nights, what to cut) — not WHICH cities across multiple countries belong on
the trip at all (e.g. "Budapest, Berlin, Amsterdam, Brussels").

This was evaluated deliberately, not overlooked. Supporting it well would
require:
- A new upstream decision type (`trip_composition`) proposing or evaluating
  a city *set*, not just splitting time within one already-chosen region
- Pairwise transit-cost fetching across an entire candidate set before any
  recommendation can be made (O(n^2) Maps calls, speculative, pre-commitment)
- City-level place-tier curation across many countries up front — the
  hand-curated dataset (place_tiers.md) would need to scale far beyond a
  single region before this mode could work credibly

None of this breaks the existing architecture (legs/transit edges already
generalize across country borders fine) — it's a content-coverage and
upstream-decision-type gap, not a structural one. Worth revisiting once the
single-region product is built and validated.
