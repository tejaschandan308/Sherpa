// ============================================================================
// Decision generation — Claude call #1 (the core product)
// ============================================================================
//
// This is the one place Claude exercises judgment. It is handed a fixed set of
// VerifiedFacts and the trip shape, and must return strict, enum-constrained
// JSON — never free prose the app has to re-parse. Two rules are load-bearing
// (see decision_generation.md):
//
//   1. `reasoning` must cite at least one supplied fact_id (`facts_cited`).
//      A `confidence: high` decision with zero facts_cited is a GENERATION
//      FAILURE — we reject and regenerate, we don't ship it.
//   2. `confidence` is scored against an explicit rubric in the system prompt,
//      never self-reported. The model must not default to `high`.
//
// We use structured outputs (output_config.format with a JSON schema) so the
// model is constrained to the exact shape and stance enums — this removes the
// whole class of "model returned slightly-wrong JSON" failures the old code
// had to defend against with regex fence-stripping.

import Anthropic from '@anthropic-ai/sdk'
import type {
  AnyStance,
  Confidence,
  Decision,
  DecisionType,
  TripShapeInput,
  VerifiedFact,
} from './types'

// Core judgment task → most capable model. (The old curation route used
// claude-sonnet-4-6; decision quality is the whole product now, so this is
// deliberately Opus.)
const MODEL = 'claude-opus-4-8'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Legal stance enum per decision type — fed straight into the JSON schema so
// the model literally cannot return an off-enum stance.
const STANCE_ENUM: Record<DecisionType, readonly string[]> = {
  base_city: ['split', 'single'],
  region_cut: ['cut_algarve', 'cut_porto', 'cut_none'],
  splurge_or_skip: ['add', 'skip'],
  pace: ['relaxed', 'standard', 'packed'],
}

const CONFIDENCE_ENUM: readonly Confidence[] = ['high', 'close_call', 'worth_a_gut_check']
const ALL_DECISION_TYPES: readonly DecisionType[] = [
  'base_city',
  'region_cut',
  'splurge_or_skip',
  'pace',
]

const SYSTEM_PROMPT = `You are Sherpa's decision engine. Your job is NOT to recommend places — it is to surface the one decision that actually shapes this trip and frame it with an honest tradeoff.

ABSOLUTE RULES:
- You reason ONLY over the verified_facts you are given. You never invent, recall, or estimate a distance, duration, or place fact. If a fact you'd need isn't supplied, say so in your reasoning rather than guessing.
- Every decision's reasoning must rest on at least one supplied fact. List those fact_ids in facts_cited. If you cannot tie the stance to a supplied fact, that is a signal your confidence is not "high".
- The tradeoff is mandatory and must be honest — the real cost of your stance, never empty, never "there is no downside".

CONFIDENCE RUBRIC (score against this, do not self-report a feeling):
- "high" — the verified facts alone make one stance clearly better REGARDLESS of the traveler's preferences. Example: a 3-hour one-way transit time makes a "day trip" stance impractical on its own.
- "close_call" — the facts support either stance reasonably; the right answer genuinely depends on what the traveler values. This is the EXPECTED common case.
- "worth_a_gut_check" — the stance is mostly about trip feel (pace, energy) rather than hard constraints; reasonable travelers disagree on principle.
Never default to "high". A decision set where everything is "high" is miscalibrated.

If a relevant prior_answer (a swipe lean) exists AND the decision is not "high" confidence, you may let it tip which side of a genuine tie the stance lands on — but reasoning must still cite a verified fact first; the swipe never substitutes for a missing fact.

Write headline as one plain-language sentence stating the stance. Keep reasoning to 1-2 sentences.`

export interface DecisionGenerationInput {
  decision_type: DecisionType
  trip: { destination: string; days_total: number; start_date: string }
  trip_shape: TripShapeInput
  verified_facts: VerifiedFact[]
  prior_answers?: { card_id: string; statement: string; answer: 'agree' | 'disagree' }[]
}

// The raw JSON the model returns (before we attach app-side fields like id/status).
interface RawDecision {
  decision_type: DecisionType
  stance: string
  headline: string
  reasoning: string
  tradeoff: string
  confidence: Confidence
  confidence_rationale: string
  facts_cited: string[]
  depends_on: DecisionType[]
  enables: DecisionType[]
}

/** Builds the JSON schema for a given decision type, pinning the stance enum so
 *  the model can only return a legal stance for THIS decision type. */
function outputSchema(decisionType: DecisionType): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision_type: { type: 'string', const: decisionType },
      stance: { type: 'string', enum: STANCE_ENUM[decisionType] },
      headline: { type: 'string' },
      reasoning: { type: 'string' },
      tradeoff: { type: 'string' },
      confidence: { type: 'string', enum: CONFIDENCE_ENUM },
      confidence_rationale: { type: 'string' },
      facts_cited: { type: 'array', items: { type: 'string' } },
      depends_on: { type: 'array', items: { type: 'string', enum: ALL_DECISION_TYPES } },
      enables: { type: 'array', items: { type: 'string', enum: ALL_DECISION_TYPES } },
    },
    required: [
      'decision_type',
      'stance',
      'headline',
      'reasoning',
      'tradeoff',
      'confidence',
      'confidence_rationale',
      'facts_cited',
      'depends_on',
      'enables',
    ],
  }
}

/** Validates a raw decision against the non-negotiable contract rules. Returns
 *  null if valid, or a string reason if it should be rejected and regenerated. */
function validate(raw: RawDecision, suppliedFactIds: Set<string>): string | null {
  if (!raw.tradeoff || raw.tradeoff.trim().length === 0) {
    return 'tradeoff is empty'
  }
  if (!raw.reasoning || raw.reasoning.trim().length === 0) {
    return 'reasoning is empty'
  }
  // Every cited fact must actually be one we supplied — no inventing fact_ids.
  for (const id of raw.facts_cited) {
    if (!suppliedFactIds.has(id)) {
      return `facts_cited references unknown fact_id "${id}"`
    }
  }
  // The core guardrail: a confident decision with no facts behind it is a
  // generation failure, not a style issue.
  if (raw.confidence === 'high' && raw.facts_cited.length === 0) {
    return 'confidence is "high" but facts_cited is empty'
  }
  return null
}

/** Builds the user message payload handed to the model. */
function buildUserMessage(input: DecisionGenerationInput): string {
  return JSON.stringify(
    {
      decision_type: input.decision_type,
      trip: input.trip,
      trip_shape: input.trip_shape,
      verified_facts: input.verified_facts,
      prior_answers: input.prior_answers ?? [],
    },
    null,
    2
  )
}

/**
 * Generates one decision via Claude, validating against the contract and
 * regenerating on failure (up to `maxAttempts`). Returns a Decision row ready
 * to persist (status defaults to 'recommended'), or throws if every attempt
 * fails validation.
 */
export async function generateDecision(
  input: DecisionGenerationInput,
  tripId: string,
  maxAttempts = 3
): Promise<Decision> {
  const suppliedFactIds = new Set(input.verified_facts.map((f) => f.fact_id))
  const schema = outputSchema(input.decision_type)
  let lastReason = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: buildUserMessage(input) }],
    })

    // With structured outputs the JSON arrives as the text block content.
    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      lastReason = 'no text block in response'
      continue
    }

    let raw: RawDecision
    try {
      raw = JSON.parse(textBlock.text) as RawDecision
    } catch {
      lastReason = 'response was not valid JSON'
      continue
    }

    const reason = validate(raw, suppliedFactIds)
    if (reason) {
      lastReason = reason
      continue // reject and regenerate
    }

    const now = Date.now()
    return {
      id: `dec_${tripId}_${input.decision_type}`,
      trip_id: tripId,
      decision_type: raw.decision_type,
      stance: raw.stance as AnyStance,
      headline: raw.headline,
      reasoning: raw.reasoning,
      tradeoff: raw.tradeoff,
      confidence: raw.confidence,
      confidence_rationale: raw.confidence_rationale,
      facts_cited: raw.facts_cited,
      depends_on: raw.depends_on,
      enables: raw.enables,
      status: 'recommended',
      created_at: now,
      updated_at: now,
    }
  }

  throw new Error(
    `Decision generation failed after ${maxAttempts} attempts for ${input.decision_type}: ${lastReason}`
  )
}
