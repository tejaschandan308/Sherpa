// POST /api/plan/legs
// Turns confirmed decisions into the skeleton — legs, transit edges, day-blocks
// — DETERMINISTICALLY (no LLM decides structure), then runs the voice pass
// (Claude call #2, prose only) to caption them. This is the seam the whole
// "revisit a decision" feature depends on staying deterministic.

import type { DecisionMap, GeneratorTrip } from '../../../lib/legGeneration'
import { generateTripStructure } from '../../../lib/tripStructure'
import { getTransitFact, placeTierFact } from '../../../lib/maps'
import { generateLegCaptions } from '../../../lib/voicePass'
import type { DecisionType, Pace, VerifiedFact } from '../../../lib/types'

interface Body {
  trip_id: string
  destination: string
  days_total: number
  /** decision_type → confirmed stance */
  decisions: Partial<Record<DecisionType, string>>
}

export async function POST(request: Request) {
  const body: Body = await request.json()

  // pace comes from the confirmed pace decision if present, else standard.
  const paceStance = body.decisions.pace
  const pace: Pace =
    paceStance === 'relaxed' || paceStance === 'packed' ? paceStance : 'standard'

  const trip: GeneratorTrip = {
    destination: body.destination,
    days_total: body.days_total,
    pace,
  }

  const decisionMap: DecisionMap = {}
  for (const [type, stance] of Object.entries(body.decisions)) {
    if (stance) decisionMap[type as DecisionType] = { stance }
  }

  try {
    // Deterministic structure (legs/edges/day-blocks), with transit hydrated
    // from the global FactCache.
    const { legs, edges, dayBlocks } = await generateTripStructure(
      trip,
      decisionMap,
      body.trip_id
    )

    // Voice pass: one Claude call per leg, prose only. Captions that invent a
    // place/number are discarded inside generateLegCaptions.
    //
    // We enrich each call with read-only context derived ENTIRELY from the
    // deterministic structure above (block order, leg sequence, transit edges)
    // plus the confirmed pace — never by asking the generator to decide anything
    // new. The voice pass reads this to write captions that differ day-to-day;
    // it still cannot change night counts, ordering, or which blocks exist.
    const facts = await gatherFactsForCaptions()
    const legCount = legs.length
    await Promise.all(
      legs.map(async (leg) => {
        // Blocks in their generated order — adjacency context depends on it.
        const blocks = dayBlocks
          .filter((b) => b.leg_id === leg.id)
          .sort((a, b) => a.order - b.order)

        // How you arrive into this leg, if a transit edge feeds it (e.g. the
        // Lisbon→Porto train). First leg has none; omit it then.
        const inbound = edges.find((e) => e.to_place === leg.place)
        const arrival_from = inbound
          ? {
              place: inbound.from_place,
              mode: inbound.mode,
              duration_minutes: inbound.duration_minutes,
            }
          : undefined

        const result = await generateLegCaptions({
          leg: {
            id: leg.id,
            place: leg.place,
            role: leg.role,
            nights: leg.nights,
            sequence_order: leg.sequence_order,
            leg_count: legCount,
            arrival_from,
          },
          blocks: blocks.map((b, i) => ({
            id: b.id,
            kind: b.kind,
            target: b.target,
            note: b.note,
            day_index: i,
            day_count: blocks.length,
            prev_kind: i > 0 ? blocks[i - 1].kind : undefined,
            next_kind: i < blocks.length - 1 ? blocks[i + 1].kind : undefined,
          })),
          pace,
          verified_facts: facts,
        })
        leg.caption = result.captions[leg.id]
        for (const b of blocks) {
          if (result.captions[b.id]) b.caption = result.captions[b.id]
        }
      })
    )

    return Response.json({ legs, edges, dayBlocks })
  } catch (err) {
    console.error('[plan/legs] error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

async function gatherFactsForCaptions(): Promise<VerifiedFact[]> {
  const facts: VerifiedFact[] = []
  for (const place of ['Lisbon', 'Porto', 'Algarve (Tavira / Lagos area)', 'Peneda-Gerês National Park', 'Douro Valley']) {
    const f = placeTierFact(place)
    if (f) facts.push(f)
  }
  const transit = await getTransitFact('Lisbon', 'Porto', 'train')
  if (transit) facts.push(transit)
  return facts
}
