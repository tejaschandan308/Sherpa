// ============================================================================
// Trip structure assembly — server-only (reads the global FactCache)
// ============================================================================
//
// Wraps the PURE deterministic generator (legGeneration.ts) and fills transit
// edge durations from the Maps facts layer. This is the only async part of
// structure generation; it does not change WHAT the structure is — it only
// attaches real, cached numbers to edges that already exist. An edge whose
// transit fact can't be fetched keeps duration 0 and an empty fact_id rather
// than inventing a number.
//
// This lives apart from legGeneration.ts so the pure functions stay importable
// by client code (the seeded demo) without pulling in @vercel/kv / server env.

import {
  generateDayBlockSpecs,
  generateLegSpecs,
  type DecisionMap,
  type GeneratorTrip,
} from './legGeneration'
import { getTransitFact } from './maps'
import type { DayBlock, Leg, TransitEdge } from './types'

export async function generateTripStructure(
  trip: GeneratorTrip,
  decisions: DecisionMap,
  tripId: string
): Promise<{ legs: Leg[]; edges: TransitEdge[]; dayBlocks: DayBlock[] }> {
  const { legs: legSpecs, edges: edgeSpecs } = generateLegSpecs(trip, decisions)
  const now = Date.now()

  const legs: Leg[] = legSpecs.map((s) => ({
    id: `leg_${tripId}_${s.sequence_order}`,
    trip_id: tripId,
    place: s.place,
    role: s.role,
    nights: s.nights,
    sequence_order: s.sequence_order,
    locked: false,
    created_at: now,
  }))

  const edges: TransitEdge[] = await Promise.all(
    edgeSpecs.map(async (e, i) => {
      const fact = await getTransitFact(e.from_place, e.to_place, e.mode)
      return {
        id: `edge_${tripId}_${i}`,
        trip_id: tripId,
        from_place: e.from_place,
        to_place: e.to_place,
        mode: e.mode,
        duration_minutes: fact?.duration_minutes ?? 0,
        distance_meters: fact?.distance_meters,
        fact_id: fact?.fact_id ?? '',
      }
    })
  )

  const dayBlocks: DayBlock[] = []
  legSpecs.forEach((leg, legIdx) => {
    const specs = generateDayBlockSpecs(leg, decisions, legIdx === 0, trip.pace)
    specs.forEach((b, blockIdx) => {
      dayBlocks.push({
        id: `block_${tripId}_${legIdx}_${blockIdx}`,
        trip_id: tripId,
        leg_id: `leg_${tripId}_${leg.sequence_order}`,
        kind: b.kind,
        order: blockIdx,
        target: b.target,
        note: b.note,
        provenance: 'generated',
        locked: false,
      })
    })
  })

  return { legs, edges, dayBlocks }
}
