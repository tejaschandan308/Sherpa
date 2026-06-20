// ============================================================================
// Revisit-a-decision impact preview — DETERMINISTIC, no LLM
// ============================================================================
//
// "What would change if I switched this confirmed decision?" is answered the
// same way the skeleton is built in the first place: by running the PURE
// generators (legGeneration.ts) over the proposed decision set and diffing the
// result against the current one. Because generation is deterministic, this
// preview is exact — it is literally what the commit would produce, not an
// estimate. No Claude call is involved.
//
// The diff is reported at the altitude the product cares about — legs, nights,
// day-trips, rest days — not block-by-block. Crucially it also flags any
// CURRENT item that is locked (a booking attached) or manually edited and would
// be removed or changed, so the user is warned before committing. Sherpa never
// claims to undo a real booking; the UI states the user must handle that.

import {
  generateDayBlockSpecs,
  generateLegSpecs,
  type DecisionMap,
  type DayBlockSpec,
} from './legGeneration'
import type { DecisionType, Pace, TripBundle } from './types'

export interface NightChange {
  place: string
  from: number
  to: number
}

/** A current, user-owned item (booking or hand-edit) that the change would
 *  disturb — surfaced as a warning, never auto-resolved here. */
export interface AffectedItem {
  label: string
  reason: 'locked' | 'manual'
}

export interface RevisitImpact {
  /** False when the proposed stance produces an identical skeleton (no-op). */
  changed: boolean
  legsAdded: string[]
  legsRemoved: string[]
  nightChanges: NightChange[]
  dayTripsAdded: string[]
  dayTripsRemoved: string[]
  /** Net change in deliberate rest (open) days: + added, − removed. */
  restDaysDelta: number
  /** Locked or manually-edited current items the change would remove/alter. */
  affected: AffectedItem[]
}

/** Builds the decision→stance map the generator reads, from the bundle's
 *  settled decisions, optionally overriding one decision type's stance. */
function stanceMap(bundle: TripBundle, override?: { type: DecisionType; stance: string }): DecisionMap {
  const map: DecisionMap = {}
  for (const d of bundle.decisions) {
    if (d.status === 'confirmed' || d.status === 'overridden') {
      map[d.decision_type] = { stance: d.stance }
    }
  }
  if (override) map[override.type] = { stance: override.stance }
  return map
}

/** The pace the generator should use for a given stance map (mirrors the legs
 *  route: a confirmed relaxed/packed pace wins, otherwise standard). */
function paceOf(map: DecisionMap): Pace {
  const p = map.pace?.stance
  return p === 'relaxed' || p === 'packed' ? p : 'standard'
}

/** Runs the pure generators for one stance map → the legs (place→nights), a
 *  flat list of every day-block spec, and the blocks grouped by leg place (used
 *  to spot when a surviving leg's day structure changes). */
function structureOf(
  destination: string,
  daysTotal: number,
  map: DecisionMap
): {
  legNights: Map<string, number>
  blocks: DayBlockSpec[]
  blocksByPlace: Map<string, DayBlockSpec[]>
} {
  const pace = paceOf(map)
  const { legs } = generateLegSpecs({ destination, days_total: daysTotal, pace }, map)

  const legNights = new Map<string, number>()
  const blocksByPlace = new Map<string, DayBlockSpec[]>()
  const blocks: DayBlockSpec[] = []
  legs.forEach((leg, i) => {
    legNights.set(leg.place, leg.nights)
    const legBlocks = generateDayBlockSpecs(leg, map, i === 0, pace)
    blocksByPlace.set(leg.place, legBlocks)
    blocks.push(...legBlocks)
  })
  return { legNights, blocks, blocksByPlace }
}

/** Order-sensitive signature of a leg's day-block sequence, for change detection. */
function blockSignature(specs: DayBlockSpec[]): string {
  return specs.map((b) => `${b.kind}:${b.target ?? ''}`).join(',')
}

const dayTripTargets = (blocks: DayBlockSpec[]): string[] =>
  blocks.filter((b) => b.kind === 'day_trip' && b.target).map((b) => b.target as string)

const countOpen = (blocks: DayBlockSpec[]): number =>
  blocks.filter((b) => b.kind === 'open').length

const BLOCK_NOUN: Record<string, string> = {
  arrival: 'the arrival day',
  explore: 'an open day',
  day_trip: 'the day trip',
  open: 'a rest day',
}

/**
 * Computes the exact structural impact of switching `decisionType` to
 * `newStance`, plus any locked/manual current items it would disturb. Pure and
 * synchronous — safe to call on every hover/selection in the preview UI.
 */
export function computeImpact(
  bundle: TripBundle,
  decisionType: DecisionType,
  newStance: string
): RevisitImpact {
  const { destination, days_total } = bundle.trip
  const before = structureOf(destination, days_total, stanceMap(bundle))
  const after = structureOf(
    destination,
    days_total,
    stanceMap(bundle, { type: decisionType, stance: newStance })
  )

  const beforePlaces = [...before.legNights.keys()]
  const afterPlaces = [...after.legNights.keys()]
  const legsAdded = afterPlaces.filter((p) => !before.legNights.has(p))
  const legsRemoved = beforePlaces.filter((p) => !after.legNights.has(p))

  const nightChanges: NightChange[] = []
  for (const place of beforePlaces) {
    if (!after.legNights.has(place)) continue
    const from = before.legNights.get(place) as number
    const to = after.legNights.get(place) as number
    if (from !== to) nightChanges.push({ place, from, to })
  }

  const beforeTrips = dayTripTargets(before.blocks)
  const afterTrips = dayTripTargets(after.blocks)
  const dayTripsAdded = afterTrips.filter((t) => !beforeTrips.includes(t))
  const dayTripsRemoved = beforeTrips.filter((t) => !afterTrips.includes(t))

  const restDaysDelta = countOpen(after.blocks) - countOpen(before.blocks)

  // Cross-reference the STORED entities (which carry locked/manual flags) for
  // anything the change would remove or shrink.
  const affected: AffectedItem[] = []
  const flagBlock = (
    b: { locked: boolean; provenance: string; kind: string; target?: string },
    label: string
  ) => {
    if (b.locked) affected.push({ label, reason: 'locked' })
    else if (b.provenance === 'manual') affected.push({ label, reason: 'manual' })
  }

  for (const place of legsRemoved) {
    const leg = bundle.legs.find((l) => l.place === place)
    if (!leg) continue
    if (leg.locked) affected.push({ label: `${place} (whole leg)`, reason: 'locked' })
    for (const b of bundle.day_blocks.filter((x) => x.leg_id === leg.id)) {
      flagBlock(b, `${place} — ${BLOCK_NOUN[b.kind] ?? 'a day'}`)
    }
  }
  for (const target of dayTripsRemoved) {
    const b = bundle.day_blocks.find((x) => x.kind === 'day_trip' && x.target === target)
    if (b) flagBlock(b, `${target} day trip`)
  }
  if (restDaysDelta < 0) {
    // The rest days most at risk are the surplus ones being removed.
    const openBlocks = bundle.day_blocks.filter((x) => x.kind === 'open')
    for (const b of openBlocks.slice(restDaysDelta)) flagBlock(b, 'a rest day')
  }

  // Surviving legs whose day structure changes: any booked/edited block on them
  // is in conflict too (e.g. a pace change reshuffles a leg you've booked a day
  // in). Dedup against anything already flagged above.
  const seen = new Set(affected.map((a) => a.label))
  for (const place of beforePlaces) {
    if (!after.legNights.has(place)) continue // removed legs handled above
    const beforeSig = blockSignature(before.blocksByPlace.get(place) ?? [])
    const afterSig = blockSignature(after.blocksByPlace.get(place) ?? [])
    if (beforeSig === afterSig) continue
    const leg = bundle.legs.find((l) => l.place === place)
    if (!leg) continue
    for (const b of bundle.day_blocks.filter((x) => x.leg_id === leg.id)) {
      if (!b.locked && b.provenance !== 'manual') continue
      const label = `${place} — ${BLOCK_NOUN[b.kind] ?? 'a day'}`
      if (seen.has(label)) continue
      seen.add(label)
      affected.push({ label, reason: b.locked ? 'locked' : 'manual' })
    }
  }

  const changed =
    legsAdded.length > 0 ||
    legsRemoved.length > 0 ||
    nightChanges.length > 0 ||
    dayTripsAdded.length > 0 ||
    dayTripsRemoved.length > 0 ||
    restDaysDelta !== 0

  return {
    changed,
    legsAdded,
    legsRemoved,
    nightChanges,
    dayTripsAdded,
    dayTripsRemoved,
    restDaysDelta,
    affected,
  }
}

/** Turns an impact into short, human preview lines (structural changes only —
 *  the locked/manual warnings render separately, with their own emphasis). */
export function impactLines(impact: RevisitImpact): string[] {
  const lines: string[] = []
  for (const p of impact.legsAdded) lines.push(`Adds ${p} to your route`)
  for (const p of impact.legsRemoved) lines.push(`Drops ${p} from your route`)
  for (const c of impact.nightChanges) {
    lines.push(`${c.place}: ${c.from} → ${c.to} nights`)
  }
  for (const t of impact.dayTripsAdded) lines.push(`Adds the ${t} day trip`)
  for (const t of impact.dayTripsRemoved) lines.push(`Removes the ${t} day trip`)
  if (impact.restDaysDelta > 0) {
    lines.push(`Adds ${impact.restDaysDelta} rest day${impact.restDaysDelta === 1 ? '' : 's'}`)
  } else if (impact.restDaysDelta < 0) {
    const n = -impact.restDaysDelta
    lines.push(`Removes ${n} rest day${n === 1 ? '' : 's'}`)
  }
  return lines
}
