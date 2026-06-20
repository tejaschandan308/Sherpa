// ============================================================================
// Seeded demo trip — the Portugal example from design
// ============================================================================
//
// A fully-built TripBundle that bypasses the LLM, so the screens can be clicked
// through repeatedly without paying for a Claude call. It matches the example
// used throughout design: Portugal, 14 days — Lisbon/Porto SPLIT, cut the
// ALGARVE (keep the north), SKIP the Douro day-trip, and build in a REST DAY.
//
// The legs/day-blocks are produced by the SAME deterministic generator the real
// pipeline uses (generateLegSpecs / generateDayBlockSpecs), so the demo can
// never drift from real generation. Only the decision prose, the transit fact,
// and the captions are hand-authored here (in the real flow those come from the
// two Claude calls + the Maps facts layer).

import {
  generateDayBlockSpecs,
  generateLegSpecs,
  type DecisionMap,
  type GeneratorTrip,
} from './legGeneration'
import type {
  DayBlock,
  Decision,
  Leg,
  TransitEdge,
  TripBundle,
  VerifiedFact,
} from './types'

export const DEMO_TRIP_ID = 'demo-portugal'

const TRIP: GeneratorTrip = { destination: 'Portugal', days_total: 14, pace: 'relaxed' }

// The four confirmed decisions, by stance — drives the deterministic structure.
const DECISION_STANCES: DecisionMap = {
  base_city: { stance: 'split' },
  region_cut: { stance: 'cut_algarve' },
  splurge_or_skip: { stance: 'skip' },
  pace: { stance: 'relaxed' },
}

/** The verified facts that ground the demo's reasoning (in the real flow these
 *  come from the Maps layer + place-tier dataset). */
const DEMO_FACTS: VerifiedFact[] = [
  {
    fact_id: 'transit_lisbon_porto_train',
    type: 'transit_time',
    place: 'Lisbon',
    to: 'Porto',
    mode: 'train',
    duration_minutes: 190,
    distance_meters: 313000,
    source: 'google_distance_matrix',
  },
  { fact_id: 'place_tier_lisbon', type: 'place_tier', place: 'Lisbon', tier: 'multi_day_city', source: 'sherpa_place_heuristics' },
  { fact_id: 'place_tier_porto', type: 'place_tier', place: 'Porto', tier: 'multi_day_city', source: 'sherpa_place_heuristics' },
  { fact_id: 'place_tier_algarve', type: 'place_tier', place: 'Algarve (Tavira / Lagos area)', tier: 'multi_day_region', source: 'sherpa_place_heuristics' },
  { fact_id: 'place_tier_peneda', type: 'place_tier', place: 'Peneda-Gerês National Park', tier: 'multi_day_region', source: 'sherpa_place_heuristics' },
  { fact_id: 'place_tier_douro', type: 'place_tier', place: 'Douro Valley', tier: 'half_day_stop', source: 'sherpa_place_heuristics' },
]

export function demoVerifiedFacts(): VerifiedFact[] {
  return DEMO_FACTS
}

// The framing question shown FIRST on the decisions screen (ask-first pattern),
// before any verdict is revealed. Keyed by decision_type.
export const DEMO_DECISION_QUESTIONS: Record<string, string> = {
  base_city:
    'Two weeks in Portugal, and both Lisbon and Porto are on your list. Do you base yourself in one city and day-trip out, or actually split your nights between the two?',
  region_cut:
    'You can’t do the whole country well in 14 days. If something has to give between the southern coast and the green north — which way do you lean?',
  splurge_or_skip:
    'The Douro Valley is the classic wine day-trip from Porto. Worth carving out a full day for it this time, or let it go?',
  pace:
    'Fourteen days is enough to move at your own speed. Do you want every day to count, or some room to do nothing?',
}

const now = 1750000000000 // fixed timestamp so the demo is byte-stable across reloads

function decision(
  d: Omit<Decision, 'id' | 'trip_id' | 'status' | 'created_at' | 'updated_at'>
): Decision {
  return {
    ...d,
    id: `dec_${DEMO_TRIP_ID}_${d.decision_type}`,
    trip_id: DEMO_TRIP_ID,
    // 'recommended' (not 'confirmed') so the demo exercises the full ask-first
    // flow: pick a lean → see the verdict → confirm. The skeleton is still
    // pre-built from these stances, so confirming leaves it unchanged.
    status: 'recommended',
    created_at: now,
    updated_at: now,
  }
}

const DEMO_DECISIONS: Decision[] = [
  decision({
    decision_type: 'base_city',
    stance: 'split',
    headline: 'Split Lisbon and Porto — don’t day-trip Porto from Lisbon.',
    reasoning:
      'Porto is about 3 hours from Lisbon by train, so a day trip means roughly 6 hours of travel for half a day on the ground. With 14 days, there’s room to actually stay in both.',
    tradeoff:
      'Costs one hotel switch and a travel day. Staying Lisbon-only is simpler, but Porto becomes a thin sample, not a real visit.',
    confidence: 'high',
    confidence_rationale:
      'The transit time alone makes a day trip impractical regardless of preference — this isn’t primarily a taste call.',
    facts_cited: ['transit_lisbon_porto_train'],
    depends_on: [],
    enables: ['region_cut', 'splurge_or_skip'],
  }),
  decision({
    decision_type: 'region_cut',
    stance: 'cut_algarve',
    headline: 'Cut the Algarve. Keep the green north.',
    reasoning:
      'The Algarve is a multi-day coastline far from your Lisbon–Porto spine, so reaching it eats a day each way. Peneda-Gerês is closer to Porto and gives you the contrast without the long haul south.',
    tradeoff:
      'You give up the beaches. If sun-and-coast is the reason you’re coming, this is the wrong cut — flip it and lose Porto instead.',
    confidence: 'close_call',
    confidence_rationale:
      'Both regions are reasonable; the facts narrow it but the right answer genuinely depends on what you came for.',
    facts_cited: ['place_tier_algarve', 'place_tier_peneda'],
    depends_on: ['base_city'],
    enables: [],
  }),
  decision({
    decision_type: 'splurge_or_skip',
    stance: 'skip',
    headline: 'Skip the Douro day-trip this time.',
    reasoning:
      'The Douro delivers its whole experience in a single day, and you’re already staying in Porto with full days there. Adding it trades a relaxed Porto day for a long out-and-back.',
    tradeoff:
      'You miss the river valley and the wine country. If the Douro is the thing you’re picturing when you think “Portugal,” add it back and lose a slower Porto day.',
    confidence: 'close_call',
    confidence_rationale:
      'It’s a genuine either/or against an unhurried Porto — defensible both ways, so it comes down to what you’d rather have.',
    facts_cited: ['place_tier_douro'],
    depends_on: ['base_city'],
    enables: [],
  }),
  decision({
    decision_type: 'pace',
    stance: 'relaxed',
    headline: 'Build in a rest day.',
    reasoning:
      'Across 14 days with a city switch and a region move, an open day every few days keeps the trip from turning into a checklist. Your answers leaned toward depth over breadth, which this protects.',
    tradeoff:
      'A rest day is a day you’re not “seeing” something. If you’d rather pack it in and rest when you’re home, drop these and the skeleton fills back up.',
    confidence: 'worth_a_gut_check',
    confidence_rationale:
      'This is about how the trip should feel, not a hard constraint — reasonable travelers split on it.',
    facts_cited: [],
    depends_on: [],
    enables: [],
  }),
]

// Hand-written captions for the demo skeleton (in the real flow, the voice pass
// writes these). Keyed by leg/block index pattern matching the generator's ids.
const LEG_CAPTIONS: Record<string, string> = {
  Lisbon: 'Your anchor — enough nights to get past the postcard and into the neighborhoods.',
  Porto: 'The second base the split decision bought you. A real stay, not a day-trip sample.',
  'Peneda-Gerês National Park': 'The green-north contrast you kept when the Algarve was cut.',
}

/** Builds the complete demo bundle. Deterministic and side-effect-free. */
export function buildDemoBundle(): TripBundle {
  const { legs: legSpecs, edges: edgeSpecs } = generateLegSpecs(TRIP, DECISION_STANCES)

  const legs: Leg[] = legSpecs.map((s) => ({
    id: `leg_${DEMO_TRIP_ID}_${s.sequence_order}`,
    trip_id: DEMO_TRIP_ID,
    place: s.place,
    role: s.role,
    nights: s.nights,
    sequence_order: s.sequence_order,
    locked: false,
    created_at: now,
  }))

  // Lisbon→Porto transit, with the real-world fact baked in (no Maps call).
  const edges: TransitEdge[] = edgeSpecs.map((e, i) => ({
    id: `edge_${DEMO_TRIP_ID}_${i}`,
    trip_id: DEMO_TRIP_ID,
    from_place: e.from_place,
    to_place: e.to_place,
    mode: e.mode,
    duration_minutes: 190,
    distance_meters: 313000,
    fact_id: 'transit_lisbon_porto_train',
  }))

  const dayBlocks: DayBlock[] = []
  legSpecs.forEach((leg, legIdx) => {
    const specs = generateDayBlockSpecs(leg, DECISION_STANCES, legIdx === 0, 'relaxed')
    specs.forEach((b, blockIdx) => {
      dayBlocks.push({
        id: `block_${DEMO_TRIP_ID}_${legIdx}_${blockIdx}`,
        trip_id: DEMO_TRIP_ID,
        leg_id: `leg_${DEMO_TRIP_ID}_${leg.sequence_order}`,
        kind: b.kind,
        order: blockIdx,
        target: b.target,
        note: b.note,
        caption: captionForBlock(b.kind, b.target),
        provenance: 'generated',
        locked: false,
      })
    })
  })

  // Attach leg captions.
  for (const leg of legs) {
    const cap = LEG_CAPTIONS[leg.place]
    if (cap) leg.caption = cap
  }

  return {
    trip: {
      id: DEMO_TRIP_ID,
      destination: 'Portugal',
      start_date: '2026-06-04',
      end_date: '2026-06-18',
      days_total: 14,
      trip_shape: {
        first_time: true,
        depth_breadth: { value: 0.6, source: 'swipe', card_id: 'swipe_1' },
        pace: { value: 0.6, source: 'swipe', card_id: 'swipe_2' },
      },
      created_at: now,
      updated_at: now,
    },
    decisions: DEMO_DECISIONS,
    legs,
    edges,
    day_blocks: dayBlocks,
    documents: [],
  }
}

function captionForBlock(kind: string, target?: string): string {
  switch (kind) {
    case 'arrival':
      return 'A soft landing — don’t over-plan the first day.'
    case 'open':
      return 'Deliberately empty. This is the rest day, not a gap to fill.'
    case 'day_trip':
      return target ? `A full day out to ${target}.` : 'A full day out.'
    default:
      return 'An open day in the city, yours to shape.'
  }
}
