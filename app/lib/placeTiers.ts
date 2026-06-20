// ============================================================================
// Place-tier dataset — hand-curated, first-party data (v0)
// ============================================================================
//
// This answers one question per place: "how much time does this place genuinely
// deserve, before either rushing it or running out of things to do." That is a
// judgment call, which is exactly why it is NOT sourced from an LLM — an LLM
// asked this produces a plausible number with no accountability, and the whole
// product's credibility rests on these numbers being right (a user can fact-
// check "is Porto really not a day trip" against their own research in minutes).
//
// Every entry is scored against the same four criteria (see place_tiers.md):
//   1. Density of things worth doing
//   2. Effort to access vs. effort to experience
//   3. Risk of "tourist skim"
//   4. Local pace (rewards slowness vs. single concentrated experience)
//
// HARD RULE: never auto-generate new entries with an LLM. Add them one at a
// time, by hand, against the four criteria. A destination with no entry is a
// hard stop (see `lookupPlaceTier` returning null), not a guess.

import type { PlaceTier } from './types'

export interface PlaceTierEntry {
  place: string
  tier: PlaceTier
  min_nights: number
  max_reasonable_nights: number
  /** One-line defense of the numbers — lets a reviewer audit a single entry
   *  without re-deriving the whole judgment. */
  justification: string
}

/** The v0 dataset: single-region Portugal coverage. Extend deliberately. */
export const PLACE_TIERS: readonly PlaceTierEntry[] = [
  {
    place: 'Lisbon',
    tier: 'multi_day_city',
    min_nights: 4,
    max_reasonable_nights: 8,
    justification:
      'Dense, walkable, multiple distinct neighborhoods with real character differences. Under 4 nights skims the surface; rewards staying.',
  },
  {
    place: 'Porto',
    tier: 'multi_day_city',
    min_nights: 3,
    max_reasonable_nights: 6,
    justification:
      'Smaller than Lisbon but still a real city, not a single site. A day trip only covers the riverside postcard view.',
  },
  {
    place: 'Sintra',
    tier: 'day_trippable',
    min_nights: 0,
    max_reasonable_nights: 1,
    justification:
      'A cluster of palaces and a forested hill, all within a small radius. One full day covers it properly; an overnight is a preference, not a necessity.',
  },
  {
    place: 'Douro Valley',
    tier: 'half_day_stop',
    min_nights: 0,
    max_reasonable_nights: 0,
    justification:
      'The experience is the view and a winery visit, not a place you live in for a day. A single day trip delivers the full experience; more time has diminishing return unless staying at a specific quinta is the point of the trip.',
  },
  {
    place: 'Peneda-Gerês National Park',
    tier: 'multi_day_region',
    min_nights: 2,
    max_reasonable_nights: 4,
    justification:
      'A spread-out hiking region, not a single site — different valleys and trailheads are genuinely far apart inside the park itself. One day only reaches whichever single trailhead you picked.',
  },
  {
    place: 'Algarve (Tavira / Lagos area)',
    tier: 'multi_day_region',
    min_nights: 2,
    max_reasonable_nights: 5,
    justification:
      'A coastline of distinct towns and beaches, not one location. Rewards picking 1-2 bases rather than rushing between towns.',
  },
] as const

/** Relative weight per tier, used by the deterministic night-allocation step in
 *  leg generation: a multi-day city earns more of the trip's nights than a
 *  day-trippable stop. These are weights, not night counts. */
export const TIER_WEIGHT: Record<PlaceTier, number> = {
  multi_day_city: 4,
  multi_day_region: 3,
  day_trippable: 1,
  half_day_stop: 0,
}

/** Normalizes a place string for matching: lowercased, trimmed, and matched
 *  against either the canonical name or its leading word (so "Algarve" matches
 *  "Algarve (Tavira / Lagos area)" and "Peneda-Geres" matches the accented
 *  canonical name). */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accent marks
    .toLowerCase()
    .trim()
}

/** Looks up a place's curated tier entry. Returns null when the place is not in
 *  the dataset — callers MUST treat null as a hard stop ("we don't have a
 *  confident read on this yet"), never fall back to an LLM-estimated tier. */
export function lookupPlaceTier(place: string): PlaceTierEntry | null {
  const needle = normalize(place)
  for (const entry of PLACE_TIERS) {
    const canonical = normalize(entry.place)
    // Match full name, the part before any parenthetical, or a leading-word
    // prefix so partial user input ("Peneda-Geres") still resolves.
    const head = normalize(entry.place.split('(')[0])
    if (canonical === needle || head === needle || head.startsWith(needle) || needle.startsWith(head)) {
      return entry
    }
  }
  return null
}

/** True if we have a confident curated read on this place. */
export function isCuratedPlace(place: string): boolean {
  return lookupPlaceTier(place) !== null
}

// Regions Sherpa can reason about in v0. A destination is "supported" if it's a
// curated region OR itself a curated place. Anything else is a hard stop — we
// say so honestly rather than guessing (place_tiers.md "unrecognized = hard
// stop"). This list grows one region at a time alongside the place dataset.
export const SUPPORTED_REGIONS: readonly string[] = ['Portugal']

// Destinations too broad to ground a trip around (Section 7 edge state) — we
// ask for a country or region instead of proceeding into the quiz with nothing.
const TOO_BROAD: readonly string[] = ['europe', 'asia', 'africa', 'south america', 'the world', 'anywhere']

export type DestinationCheck =
  | { status: 'supported' }
  | { status: 'too_broad' }
  | { status: 'unrecognized' }
  // A place Sherpa knows, but only as a COMPONENT of a region trip (a leg or a
  // day-trip), not a standalone destination. v0's decision types (base_city,
  // region_cut, splurge_or_skip) all assume a multi-region trip, so a single
  // sub-place can't be built around — we redirect the user to the region.
  | { status: 'component_place'; place: string; region: string }

/** Classifies a free-text destination for the dest+dates screen. */
export function checkDestination(dest: string): DestinationCheck {
  const needle = normalize(dest)
  if (!needle) return { status: 'unrecognized' }
  if (TOO_BROAD.includes(needle)) return { status: 'too_broad' }
  if (SUPPORTED_REGIONS.some((r) => normalize(r) === needle)) return { status: 'supported' }
  // Known to the place-tier dataset but not a standalone destination: it's a
  // component of its region's trip, so say so rather than claiming no data.
  const entry = lookupPlaceTier(dest)
  if (entry) return { status: 'component_place', place: entry.place, region: SUPPORTED_REGIONS[0] }
  return { status: 'unrecognized' }
}
