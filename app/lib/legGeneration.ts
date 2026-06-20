// ============================================================================
// Leg & day-block generation — DETERMINISTIC, no LLM
// ============================================================================
//
// Once decisions are confirmed, turning them into legs and day-blocks is plain
// application logic: branch on enum stances, do arithmetic on day counts, look
// up cached transit times. NO LLM decides WHAT the structure is.
//
// This is the guarantee the whole "revisit a decision" feature depends on: two
// runs over identical decision state MUST produce the identical skeleton, so a
// later contradiction check has a deterministic expectation to test against.
//
// The structure functions here are pure and synchronous (and unit-tested), and
// import nothing server-only — so client code (e.g. the seeded demo) can use
// them directly. The async transit-hydration step that reads the global
// FactCache lives in tripStructure.ts, which is server-only.

import { lookupPlaceTier, TIER_WEIGHT } from './placeTiers'
import type { DayBlockKind, DecisionType, Pace, TransitMode } from './types'

// ----------------------------------------------------------------------------
// Inputs (lightweight, so tests don't need full entities)
// ----------------------------------------------------------------------------

export interface DecisionInput {
  stance: string
}
export type DecisionMap = Partial<Record<DecisionType, DecisionInput>>

export interface GeneratorTrip {
  destination: string
  days_total: number
  pace: Pace
}

// Structural specs (no ids, no durations) — the pure layer's output.
export interface LegSpec {
  place: string
  role: 'primary' | 'secondary'
  nights: number
  sequence_order: number
}
export interface EdgeSpec {
  from_place: string
  to_place: string
  mode: TransitMode
}
export interface DayBlockSpec {
  kind: DayBlockKind
  target?: string
  note?: string
}

// ----------------------------------------------------------------------------
// v0 region mapping (single-region Portugal — matches the design examples)
// ----------------------------------------------------------------------------
//
// This is the one place that encodes "base_city=split for Portugal means
// Lisbon + Porto". When the place-tier dataset grows to new regions, this
// mapping grows alongside it — but it stays plain data/branching, never an LLM
// call. The Douro day-trip attaches to the Porto leg because that's where it's
// geographically anchored.

const DOURO_HOST_LEG = 'Porto'
const DOURO_TARGET = 'Douro Valley'

/**
 * Pure: derives the set of legs and the transit edges between them from the
 * confirmed decisions. Deterministic — same decisions in, same legs out.
 */
export function generateLegSpecs(
  trip: GeneratorTrip,
  decisions: DecisionMap
): { legs: LegSpec[]; edges: EdgeSpec[] } {
  let places: { place: string; role: 'primary' | 'secondary' }[] = []
  let edges: EdgeSpec[] = []

  const baseCity = decisions.base_city?.stance ?? 'single'

  if (baseCity === 'split') {
    places.push({ place: 'Lisbon', role: 'primary' })
    places.push({ place: 'Porto', role: 'primary' })
    edges.push({ from_place: 'Lisbon', to_place: 'Porto', mode: 'train' })
  } else {
    places.push({ place: 'Lisbon', role: 'primary' })
  }

  // region_cut decides which secondary region (if any) joins the trip, and can
  // remove a primary leg + its edges.
  const regionCut = decisions.region_cut?.stance
  if (regionCut === 'cut_algarve') {
    // Algarve is cut → the northern park stays as the secondary region.
    places.push({ place: 'Peneda-Gerês National Park', role: 'secondary' })
  } else if (regionCut === 'cut_porto') {
    // Porto is cut → Algarve joins, and Porto + its edges are removed.
    places.push({ place: 'Algarve (Tavira / Lagos area)', role: 'secondary' })
    places = places.filter((p) => p.place !== 'Porto')
    edges = edges.filter((e) => e.from_place !== 'Porto' && e.to_place !== 'Porto')
  }

  const nightsTotal = Math.max(0, trip.days_total - 1)
  const withNights = allocateNights(places, nightsTotal)

  const legs: LegSpec[] = withNights.map((p, i) => ({
    place: p.place,
    role: p.role,
    nights: p.nights,
    sequence_order: i,
  }))

  return { legs, edges }
}

/**
 * Pure: distributes `nightsTotal` across legs proportional to place-tier
 * weight (a multi-day city earns more nights than a day-trippable stop), then
 * adjusts to hit the exact total while respecting each place's min/max nights.
 * Arithmetic only — never a model call.
 */
export function allocateNights(
  places: { place: string; role: 'primary' | 'secondary' }[],
  nightsTotal: number
): { place: string; role: 'primary' | 'secondary'; nights: number }[] {
  if (places.length === 0) return []

  const meta = places.map((p) => {
    const tier = lookupPlaceTier(p.place)
    return {
      ...p,
      weight: tier ? TIER_WEIGHT[tier.tier] : 1,
      min: tier ? tier.min_nights : 1,
      max: tier ? tier.max_reasonable_nights : nightsTotal,
    }
  })

  const totalWeight = meta.reduce((s, m) => s + m.weight, 0) || 1

  // Initial proportional floor allocation, with each leg's fractional remainder
  // tracked so we can hand out the leftover nights deterministically.
  const alloc = meta.map((m) => {
    const raw = (m.weight / totalWeight) * nightsTotal
    const base = Math.max(m.min, Math.floor(raw))
    return { ...m, nights: base, frac: raw - Math.floor(raw) }
  })

  // Reconcile to the exact total.
  let diff = nightsTotal - alloc.reduce((s, a) => s + a.nights, 0)

  // Too few nights handed out: add one at a time to the legs with the largest
  // fractional remainder that are still under their max.
  while (diff > 0) {
    const candidates = alloc
      .filter((a) => a.nights < a.max)
      .sort((x, y) => y.frac - x.frac)
    if (candidates.length === 0) break
    candidates[0].nights += 1
    candidates[0].frac = -1 // de-prioritize after granting
    diff -= 1
  }

  // Too many (min-night clamps overshot the total): trim from legs above their
  // min, largest allocation first.
  while (diff < 0) {
    const candidates = alloc
      .filter((a) => a.nights > a.min)
      .sort((x, y) => y.nights - x.nights)
    if (candidates.length === 0) break
    candidates[0].nights -= 1
    diff += 1
  }

  return alloc.map((a) => ({ place: a.place, role: a.role, nights: a.nights }))
}

/**
 * Pure: produces the ordered day-blocks for one leg. Branches on the splurge
 * decision and applies the pace decision via `fillRemainingDays` — which is the
 * SINGLE place rest-day cadence lives, so it can't silently diverge from what
 * the pace decision said.
 */
export function generateDayBlockSpecs(
  leg: LegSpec,
  decisions: DecisionMap,
  isFirstLegOfTrip: boolean,
  pace: Pace
): DayBlockSpec[] {
  const blocks: DayBlockSpec[] = []

  if (isFirstLegOfTrip) {
    blocks.push({ kind: 'arrival', note: 'light_day' })
  }

  const splurge = decisions.splurge_or_skip?.stance
  if (splurge === 'add' && leg.place === DOURO_HOST_LEG) {
    blocks.push({ kind: 'day_trip', target: DOURO_TARGET })
  }

  const remaining = Math.max(0, leg.nights - blocks.length)
  blocks.push(...fillRemainingDays(remaining, pace))

  return blocks
}

/**
 * Pure: fills `remaining` days with explore blocks, inserting an explicit open
 * (no-plan) block roughly every 4-5 days when pace is "relaxed". "packed"
 * never inserts one. This is the ONLY implementation of pace rest-day logic.
 */
export function fillRemainingDays(remaining: number, pace: Pace): DayBlockSpec[] {
  const out: DayBlockSpec[] = []
  for (let i = 0; i < remaining; i++) {
    const isRestSlot = pace === 'relaxed' && (i + 1) % 4 === 0
    out.push({ kind: isRestSlot ? 'open' : 'explore' })
  }
  return out
}
