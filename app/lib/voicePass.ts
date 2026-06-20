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
import type { DayBlockKind, LegRole, Pace, TransitMode, VerifiedFact } from './types'

const MODEL = 'claude-opus-4-8'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are writing short, plain captions for an already-decided trip skeleton. Your ONLY job is prose — you explain why each piece is there, you never change the plan.

HARD CONSTRAINTS (violating any one of these means the caption is discarded):
- You may NOT change anything. Night counts, the order of blocks, which places appear — all fixed. You only write the caption text.
- Stay strictly within the facts you are given. Do NOT introduce a place name, a number of nights, a distance, or a duration that is not already present in the input. Every place or number you mention must appear in the structure or the verified_facts.
- One short sentence per caption. No clock times, no specific restaurant or hotel names — the restraint is deliberate.

WRITE FROM THE STRUCTURE, NOT GENERIC FILLER. Each caption must be grounded in the specific context given for that item — captions that could be swapped between two days without anyone noticing are a failure. Use what you're handed:
- day_index / day_count give a block's place in the leg; prev_kind / next_kind give its neighbors. Make consecutive days read differently: an arrival is the soft landing; the first full day opens the city; a middle day builds on what came before; the last day before moving on can lean toward what's next.
- An "open" block is a DELIBERATE no-plan day — intentional space, not a day you failed to fill. Frame it that way, and tie it to the trip's pace when one is given. NEVER describe an open day as "exploring".
- A "day_trip" block is a specific outing to its target. An "arrival" block is the trip's soft landing.
- For the leg caption, use the leg's role (primary/secondary), where it sits among the legs (sequence_order / leg_count), and how you arrive (arrival_from) to say why this base earns its nights — not just that it's nice.

Return one caption for the leg and one for each of its day-blocks.`

/** A day-block as the voice pass sees it: the deterministic block plus
 *  read-only context (position, neighbors) the generator already computed. None
 *  of these fields change the structure — they only give the model something
 *  concrete to ground a caption in. */
export interface LegCaptionBlockInput {
  id: string
  kind: DayBlockKind
  target?: string
  note?: string
  /** 0-based position of this block within its leg, and the leg's block total —
   *  so a caption can say "your first full day" / "the last before you move on"
   *  without inventing anything. */
  day_index: number
  day_count: number
  /** Kinds of the immediately adjacent blocks in the same leg, if any — lets a
   *  caption relate this day to the ones around it. */
  prev_kind?: DayBlockKind
  next_kind?: DayBlockKind
}

export interface LegCaptionInput {
  leg: {
    id: string
    place: string
    role: LegRole
    nights: number
    /** This leg's order in the trip and the total number of legs — for "your
     *  first base" / "the second city" framing. */
    sequence_order: number
    leg_count: number
    /** How you arrive into this leg, taken from the deterministic transit edge
     *  (so the number is already a verified fact). Omitted for the first leg. */
    arrival_from?: { place: string; mode: TransitMode; duration_minutes: number }
  }
  blocks: LegCaptionBlockInput[]
  /** The confirmed pace — lets an "open" day be framed as the room the traveler
   *  asked for rather than a gap. */
  pace?: Pace
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
  // Leg-level position context is legitimate to reference.
  numbers.add(String(input.leg.leg_count))
  numbers.add(String(input.leg.sequence_order + 1))
  if (input.leg.arrival_from) {
    addPlace(input.leg.arrival_from.place)
    numbers.add(String(input.leg.arrival_from.duration_minutes))
  }
  for (const b of input.blocks) {
    addPlace(b.target)
    // The day's human-facing position ("day 2 of 5") is allowed grounding.
    numbers.add(String(b.day_index + 1))
    numbers.add(String(b.day_count))
  }
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
      pace: input.pace,
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
