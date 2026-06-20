// ============================================================================
// Swipe-to-prior mapping
// ============================================================================
//
// A swipe is a fast, low-deliberation signal — useful for breaking ties and
// shaping framing, NOT strong enough to override verified facts. Two rules here
// are easy to break while coding quickly (see swipe_mapping.md):
//
//   1. Swipe-derived priors are capped at ±0.6, never ±1.0 — they're gut
//      reactions, not deliberate input. The ±0.8–1.0 range is reserved for
//      explicit, deliberate input.
//   2. Explicit input always OVERRIDES a swipe outright — replaced, not
//      blended/averaged. A swipe is a fallback prior for dimensions the user
//      didn't explicitly weigh in on.
//
// The downstream consumer (decision generation) additionally enforces that a
// swipe prior may only tip a non-"high"-confidence decision — that rule lives
// in the system prompt, not here.

import type { ShapeDimension, TripShapeInput } from './types'

export const SWIPE_STRENGTH = 0.6

export type SwipeDimension =
  | 'depth_breadth'
  | 'pace'
  | 'risk_tolerance'
  | 'transit_tolerance'
  | 'food_vs_culture'
  | 'structure'

export const ALL_DIMENSIONS: readonly SwipeDimension[] = [
  'depth_breadth',
  'pace',
  'risk_tolerance',
  'transit_tolerance',
  'food_vs_culture',
  'structure',
]

export interface SwipeCard {
  card_id: string
  dimension: SwipeDimension
  /** The pole an "agree" points toward — encoded as the POSITIVE direction of
   *  the dimension's value. */
  agree_direction: string
}

/** v0: exactly one card per dimension, keeping the deck at 6. Because a single
 *  swipe IS the dimension's entire signal, per-swipe strength stays moderate. */
export const SWIPE_CARDS: readonly SwipeCard[] = [
  { card_id: 'swipe_1', dimension: 'depth_breadth', agree_direction: 'depth' },
  { card_id: 'swipe_2', dimension: 'pace', agree_direction: 'relaxed' },
  { card_id: 'swipe_3', dimension: 'risk_tolerance', agree_direction: 'low_risk' },
  { card_id: 'swipe_4', dimension: 'transit_tolerance', agree_direction: 'high_tolerance' },
  { card_id: 'swipe_5', dimension: 'food_vs_culture', agree_direction: 'food' },
  { card_id: 'swipe_6', dimension: 'structure', agree_direction: 'loose' },
]

export type SwipeAnswer = 'agree' | 'disagree'

export interface SwipePrior {
  dimension: SwipeDimension
  /** -0.6..+0.6. Positive = toward the card's agree_direction. */
  value: number
  card_id: string
}

/** Maps a single swipe answer to a numeric prior, capped at ±SWIPE_STRENGTH. */
export function swipeToPrior(card: SwipeCard, answer: SwipeAnswer): SwipePrior {
  const direction = answer === 'agree' ? 1 : -1
  return {
    dimension: card.dimension,
    value: direction * SWIPE_STRENGTH,
    card_id: card.card_id,
  }
}

/** Maps a whole deck of answers (keyed by card_id) into priors. Cards with no
 *  answer are skipped. */
export function deckToPriors(answers: Record<string, SwipeAnswer>): SwipePrior[] {
  const priors: SwipePrior[] = []
  for (const card of SWIPE_CARDS) {
    const answer = answers[card.card_id]
    if (answer) priors.push(swipeToPrior(card, answer))
  }
  return priors
}

/**
 * Merges swipe priors with any explicit inputs into the `trip_shape` object
 * that decision generation consumes. Explicit input wins outright for any
 * dimension it covers; swipe priors fill in the rest. This is the single merge
 * point — the "explicit replaces, never blends" rule lives here and nowhere else.
 */
export function buildTripShape(
  swipePriors: SwipePrior[],
  explicitInputs: Partial<Record<SwipeDimension, number>>,
  firstTime: boolean
): TripShapeInput {
  const shape: TripShapeInput = { first_time: firstTime }

  for (const dim of ALL_DIMENSIONS) {
    const explicit = explicitInputs[dim]
    if (explicit !== undefined) {
      shape[dim] = { value: explicit, source: 'explicit' }
      continue
    }
    const swipe = swipePriors.find((p) => p.dimension === dim)
    if (swipe) {
      shape[dim] = { value: swipe.value, source: 'swipe', card_id: swipe.card_id }
    }
  }

  return shape
}

/**
 * Returns the strongest 2-3 priors by absolute value — what the bridge screen
 * narrates. A single |0.6| value isn't a confident read on its own, so the
 * bridge screen phrases these softly ("you'd lean toward…"); this helper just
 * decides which ones are worth surfacing at all.
 */
export function strongestPriors(swipePriors: SwipePrior[], limit = 3): SwipePrior[] {
  return [...swipePriors]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit)
}

/** Convenience: the human-facing pole a prior points toward, for the bridge
 *  screen's soft phrasing. */
export function priorLeaning(prior: SwipePrior): string {
  const card = SWIPE_CARDS.find((c) => c.dimension === prior.dimension)
  if (!card) return prior.dimension
  // Positive value → agree_direction pole; negative → the opposite pole.
  return prior.value >= 0 ? card.agree_direction : `not ${card.agree_direction}`
}

// Re-export for callers that store priors as ShapeDimension directly.
export type { ShapeDimension }
