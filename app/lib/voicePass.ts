// ============================================================================
// Voice pass — Claude call #2 (prose ONLY)
// ============================================================================
//
// After legs and day-blocks exist as plain data, one Claude call per leg writes
// the short "why this is here" captions for the leg and its blocks in a single
// shot (per leg, not per block, to control cost).
//
// This call may ONLY write prose. It is NOT permitted to change night counts,
// reorder blocks, or invent a place or number not already in the structure it
// was handed. If a response references a place or number that isn't in the
// input, we discard and retry — the same validation discipline as decision
// generation. This is what keeps the deterministic structure authoritative:
// the voice pass decorates it, it never alters it.

import Anthropic from '@anthropic-ai/sdk'
import type { DayBlock, Leg, VerifiedFact } from './types'

const MODEL = 'claude-opus-4-8'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are writing short, plain captions for an already-decided trip skeleton. Your ONLY job is prose.

HARD CONSTRAINTS:
- You may NOT change anything. Night counts, the order of blocks, which places appear — all fixed. You only write the "why this is here" caption text.
- Every caption must stay strictly within the facts you are given. Do NOT introduce a place name, a number of nights, a distance, or a duration that is not already present in the input. If you mention a number or a place, it must be one that appears in the structure or the verified_facts.
- One short sentence per caption. No clock times, no specific restaurant or hotel names — the restraint is deliberate.

Write a caption for the leg and for each of its day-blocks, explaining in one line why it's there, grounded only in what you were given.`

export interface LegCaptionInput {
  leg: Pick<Leg, 'id' | 'place' | 'role' | 'nights'>
  blocks: Pick<DayBlock, 'id' | 'kind' | 'target' | 'note'>[]
  verified_facts: VerifiedFact[]
}

export interface CaptionResult {
  /** leg_id or block_id → caption text */
  captions: Record<string, string>
}

interface RawCaptionItem {
  target_id: string
  caption: string
}
interface RawCaptionResponse {
  items: RawCaptionItem[]
}

/** Collects every place token and number the captions are allowed to mention. */
function buildAllowed(input: LegCaptionInput): { places: Set<string>; numbers: Set<string> } {
  const places = new Set<string>()
  const numbers = new Set<string>()

  const addPlace = (p?: string) => {
    if (!p) return
    // Index each significant word of a place name so "Douro Valley" allows
    // "Douro" and "Valley" individually.
    for (const word of p.split(/[\s/()]+/)) {
      if (word.length >= 3) places.add(word.toLowerCase())
    }
  }

  addPlace(input.leg.place)
  numbers.add(String(input.leg.nights))
  for (const b of input.blocks) addPlace(b.target)
  for (const f of input.verified_facts) {
    addPlace(f.place)
    addPlace(f.to)
    if (f.duration_minutes != null) numbers.add(String(f.duration_minutes))
    if (f.distance_meters != null) numbers.add(String(f.distance_meters))
  }

  return { places, numbers }
}

/** Returns null if the caption is clean, or a reason string if it mentions a
 *  place or number not present in the input (→ discard and retry). */
function validateCaption(
  caption: string,
  allowed: { places: Set<string>; numbers: Set<string> }
): string | null {
  // Reject any standalone number not in the allowed set.
  const nums = caption.match(/\d+/g) ?? []
  for (const n of nums) {
    if (!allowed.numbers.has(n)) return `invented number "${n}"`
  }
  // Reject capitalized multi-letter words (likely proper place names) that
  // aren't in the allowed set — skip the sentence-initial word, which is
  // capitalized for grammar, not because it's a place.
  const words = caption.split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const bare = words[i].replace(/[^A-Za-zÀ-ÿ-]/g, '')
    if (bare.length >= 3 && /^[A-ZÀ-Ý]/.test(bare) && !allowed.places.has(bare.toLowerCase())) {
      return `possible invented place "${bare}"`
    }
  }
  return null
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target_id: { type: 'string' },
          caption: { type: 'string' },
        },
        required: ['target_id', 'caption'],
      },
    },
  },
  required: ['items'],
}

/**
 * Generates captions for one leg and its blocks, validating that nothing was
 * invented and retrying on failure. Returns a {id → caption} map covering the
 * leg id and each block id. On repeated failure, returns whatever clean subset
 * it has rather than throwing — captions are decorative, so a missing one
 * degrades gracefully (the skeleton renders without it).
 */
export async function generateLegCaptions(
  input: LegCaptionInput,
  maxAttempts = 3
): Promise<CaptionResult> {
  const allowed = buildAllowed(input)
  const expectedIds = new Set<string>([input.leg.id, ...input.blocks.map((b) => b.id)])

  const userMessage = JSON.stringify(
    {
      leg: input.leg,
      blocks: input.blocks,
      verified_facts: input.verified_facts,
      instruction: 'Return one item per id below. Captions must obey the constraints.',
      ids_to_caption: [input.leg.id, ...input.blocks.map((b) => b.id)],
    },
    null,
    2
  )

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{ role: 'user', content: userMessage }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') continue

    let raw: RawCaptionResponse
    try {
      raw = JSON.parse(textBlock.text) as RawCaptionResponse
    } catch {
      continue
    }

    // Validate every caption; if any references something invented, retry.
    let clean = true
    const captions: Record<string, string> = {}
    for (const item of raw.items) {
      if (!expectedIds.has(item.target_id)) continue // ignore stray ids
      const reason = validateCaption(item.caption, allowed)
      if (reason) {
        clean = false
        break
      }
      captions[item.target_id] = item.caption
    }

    if (clean) return { captions }
  }

  // All attempts failed validation — degrade gracefully with no captions.
  return { captions: {} }
}
