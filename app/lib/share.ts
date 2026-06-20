// ============================================================================
// Share / export — read-only companion links (no backend)
// ============================================================================
//
// v1 has no server or accounts, so a travel companion can't read the sharer's
// localStorage. The trip therefore travels INSIDE the link: we encode a trimmed,
// read-only snapshot into the URL hash, and the /share view decodes it. The hash
// (not a query string) keeps the payload client-only — it's never sent to a
// server.
//
// What's shared is the PLAN, not the person's files: documents (booking PDFs,
// which are also large data URLs) and the decision-history audit trail are
// deliberately excluded. The viewer can read the trip and "copy to my trips",
// which FORKS an independent, editable trip in their own storage — there is no
// shared edit access to the original.

import type {
  Decision,
  DayBlock,
  Leg,
  TransitEdge,
  Trip,
  TripBundle,
} from './types'

/** The read-only snapshot embedded in a share link — the plan only. */
export interface SharePayload {
  v: 1
  trip: Trip
  decisions: Decision[]
  legs: Leg[]
  edges: TransitEdge[]
  day_blocks: DayBlock[]
}

// --- URL-safe base64 of UTF-8 (handles em-dashes, accented place names, etc.) ---

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Encodes a bundle's plan into a URL-hash-safe string. */
export function encodeShare(bundle: TripBundle): string {
  const payload: SharePayload = {
    v: 1,
    trip: bundle.trip,
    decisions: bundle.decisions,
    legs: bundle.legs,
    edges: bundle.edges,
    day_blocks: bundle.day_blocks,
  }
  return toBase64Url(JSON.stringify(payload))
}

/** Decodes a share string back into a payload, or null if it's malformed. */
export function decodeShare(encoded: string): SharePayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as SharePayload
    if (!parsed?.trip?.id || !Array.isArray(parsed.decisions) || !Array.isArray(parsed.legs)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Full shareable URL for the current origin. Client-only (reads window). */
export function buildShareUrl(bundle: TripBundle): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/share#${encodeShare(bundle)}`
}

/**
 * Forks a shared payload into a fresh, independently-editable bundle in the
 * viewer's own storage. Only the trip identity changes — internal entity ids
 * stay self-consistent (day_blocks still point at their legs), and documents /
 * history start empty because a fork owns neither the original's bookings nor
 * its edit log.
 */
export function forkBundle(payload: SharePayload): TripBundle {
  const now = Date.now()
  const newTripId = `trip_${now}_${Math.random().toString(36).slice(2, 7)}`

  return {
    trip: { ...payload.trip, id: newTripId, created_at: now, updated_at: now },
    decisions: payload.decisions.map((d) => ({ ...d, trip_id: newTripId })),
    legs: payload.legs.map((l) => ({ ...l, trip_id: newTripId })),
    edges: payload.edges.map((e) => ({ ...e, trip_id: newTripId })),
    day_blocks: payload.day_blocks.map((b) => ({ ...b, trip_id: newTripId })),
    documents: [],
    decision_history: [],
  }
}
