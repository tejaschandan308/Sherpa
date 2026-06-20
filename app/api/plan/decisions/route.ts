// POST /api/plan/decisions
// Gathers verified facts for the (supported) destination, then generates the
// four v0 decisions via Claude call #1 — each validated against the facts_cited
// + confidence contract. Facts come from the Maps layer / place-tier dataset;
// Claude only reasons over them.

import { generateDecision, type DecisionGenerationInput } from '../../../lib/decisionGeneration'
import { getTransitFact, placeTierFact } from '../../../lib/maps'
import { checkDestination } from '../../../lib/placeTiers'
import type { DecisionType, TripShapeInput, VerifiedFact } from '../../../lib/types'

interface Body {
  destination: string
  start_date: string
  days_total: number
  trip_shape: TripShapeInput
  trip_id?: string
  prior_answers?: { card_id: string; statement?: string; answer: 'agree' | 'disagree' }[]
}

// v0 candidate places for the Portugal region — the set the decisions reason
// over. Grows alongside the place-tier dataset / supported regions.
const PORTUGAL_PLACES = [
  'Lisbon',
  'Porto',
  'Algarve (Tavira / Lagos area)',
  'Peneda-Gerês National Park',
  'Douro Valley',
]

const DECISION_TYPES: DecisionType[] = ['base_city', 'region_cut', 'splurge_or_skip', 'pace']

/** Assembles the verified facts handed to the model: place tiers (first-party)
 *  plus the key inter-city transit fact (cached Maps). Never invents a number. */
async function gatherFacts(): Promise<VerifiedFact[]> {
  const facts: VerifiedFact[] = []

  for (const place of PORTUGAL_PLACES) {
    const f = placeTierFact(place)
    if (f) facts.push(f)
  }

  const transit = await getTransitFact('Lisbon', 'Porto', 'train')
  if (transit) facts.push(transit)

  return facts
}

export async function POST(request: Request) {
  const body: Body = await request.json()

  const check = checkDestination(body.destination)
  if (check.status !== 'supported') {
    return Response.json(
      { error: `We don't have a confident read on ${body.destination} yet.` },
      { status: 422 }
    )
  }

  const verified_facts = await gatherFacts()
  const tripId = body.trip_id ?? 'pending'

  try {
    // Generate the four decisions in parallel — each is an independent call.
    const decisions = await Promise.all(
      DECISION_TYPES.map((decision_type) => {
        const input: DecisionGenerationInput = {
          decision_type,
          trip: {
            destination: body.destination,
            days_total: body.days_total,
            start_date: body.start_date,
          },
          trip_shape: body.trip_shape,
          verified_facts,
          prior_answers: body.prior_answers?.map((p) => ({
            card_id: p.card_id,
            statement: p.statement ?? '',
            answer: p.answer,
          })),
        }
        return generateDecision(input, tripId)
      })
    )

    return Response.json({ decisions })
  } catch (err) {
    console.error('[plan/decisions] error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
