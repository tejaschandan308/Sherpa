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
    const facts = await gatherFactsForCaptions()
    await Promise.all(
      legs.map(async (leg) => {
        const blocks = dayBlocks.filter((b) => b.leg_id === leg.id)
        const result = await generateLegCaptions({
          leg: { id: leg.id, place: leg.place, role: leg.role, nights: leg.nights },
          blocks: blocks.map((b) => ({ id: b.id, kind: b.kind, target: b.target, note: b.note })),
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
