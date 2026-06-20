// ============================================================================
// Trip documents + locking
// ============================================================================
//
// v0 is a TAGGED FILE SHELF, not an ingestion pipeline: we store a file and
// remember what it's attached to. There is NO parsing/extraction of contents.
//
// The one rule that matters here is the locking cascade from the data model
// (IMPLEMENTATION_BRIEF §2): "uploading a document and marking something booked
// are the same action." A document attaches to EITHER a whole Leg or ONE
// specific DayBlock (or nothing yet — resolvable later from the shelf). From
// those attachments the locked flags are DERIVED, never set by hand:
//   - a Leg is locked when a document is attached to that leg
//   - a DayBlock is locked when a document is attached to it OR to its parent leg
// Deriving (rather than toggling) means locks can never drift out of sync with
// the documents that justify them — removing the last document unlocks again.
//
// Files are stored as data URLs in `ref` (v1 has no backend / object store).
// localStorage is small, so callers should keep individual files modest; see
// MAX_DOC_BYTES.

import type { DayBlock, Leg, TripBundle, TripDocument } from './types'

/** Soft cap on a single file's data-URL size. localStorage tops out around a
 *  few MB for the whole app, and data URLs inflate ~33%, so we refuse large
 *  files rather than silently failing the whole save. */
export const MAX_DOC_BYTES = 1_500_000

export interface NewDocumentInput {
  filename: string
  /** data URL of the file contents. */
  ref: string
  /** Optional attachment target at upload time — omit both to leave it on the
   *  shelf unattached. Exactly one should be set when attaching. */
  leg_id?: string | null
  day_block_id?: string | null
}

/** Recomputes every leg/day-block `locked` flag from the current documents.
 *  This is the single source of truth for locking — call it after any change to
 *  the documents array (including after a revisit regenerates the skeleton). */
export function deriveLocks(bundle: TripBundle): TripBundle {
  const lockedLegIds = new Set(
    bundle.documents.filter((d) => d.leg_id).map((d) => d.leg_id as string)
  )
  const lockedBlockIds = new Set(
    bundle.documents.filter((d) => d.day_block_id).map((d) => d.day_block_id as string)
  )

  return {
    ...bundle,
    legs: bundle.legs.map((l) => ({ ...l, locked: lockedLegIds.has(l.id) })),
    day_blocks: bundle.day_blocks.map((b) => ({
      ...b,
      // Locked by a doc on the block itself, or by a doc on its parent leg.
      locked: lockedBlockIds.has(b.id) || lockedLegIds.has(b.leg_id),
    })),
  }
}

/** Normalizes a target so a document is attached to at most one thing — a
 *  specific day-block wins over a leg if both are somehow passed. */
function normalizeTarget(target: {
  leg_id?: string | null
  day_block_id?: string | null
}): { leg_id: string | null; day_block_id: string | null } {
  if (target.day_block_id) return { leg_id: null, day_block_id: target.day_block_id }
  if (target.leg_id) return { leg_id: target.leg_id, day_block_id: null }
  return { leg_id: null, day_block_id: null }
}

/** Adds a document and re-derives locks. Returns a new bundle (caller saves). */
export function addDocument(bundle: TripBundle, input: NewDocumentInput): TripBundle {
  const target = normalizeTarget(input)
  const doc: TripDocument = {
    id: `doc_${bundle.trip.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    trip_id: bundle.trip.id,
    filename: input.filename,
    ref: input.ref,
    leg_id: target.leg_id,
    day_block_id: target.day_block_id,
    uploaded_at: Date.now(),
  }
  return deriveLocks({ ...bundle, documents: [...bundle.documents, doc] })
}

/** Re-points a document at a new target (or unattaches it with both null), then
 *  re-derives locks. This is the "resolve later from the shelf" path. */
export function setDocumentTarget(
  bundle: TripBundle,
  docId: string,
  target: { leg_id?: string | null; day_block_id?: string | null }
): TripBundle {
  const norm = normalizeTarget(target)
  const documents = bundle.documents.map((d) =>
    d.id === docId ? { ...d, leg_id: norm.leg_id, day_block_id: norm.day_block_id } : d
  )
  return deriveLocks({ ...bundle, documents })
}

/** Deletes a document and re-derives locks (unlocking anything it was the last
 *  justification for). */
export function removeDocument(bundle: TripBundle, docId: string): TripBundle {
  return deriveLocks({ ...bundle, documents: bundle.documents.filter((d) => d.id !== docId) })
}

/**
 * Re-points document attachments after the skeleton is regenerated (a revisit
 * rebuilds legs/day-blocks with new ids). Attachments are matched by STABLE
 * identity — a leg by its place, a day-block by (leg place, kind, target,
 * position) — not by the volatile id. A target that no longer exists in the new
 * structure becomes unattached rather than deleted, so the file stays on the
 * shelf instead of silently vanishing. Call deriveLocks afterward.
 */
export function remapDocuments(
  documents: TripDocument[],
  oldLegs: Leg[],
  oldBlocks: DayBlock[],
  newLegs: Leg[],
  newBlocks: DayBlock[]
): TripDocument[] {
  const oldLegPlace = new Map(oldLegs.map((l) => [l.id, l.place]))
  const newLegPlace = new Map(newLegs.map((l) => [l.id, l.place]))

  const blockKey = (legPlace: string, b: DayBlock) =>
    `${legPlace}|${b.kind}|${b.target ?? ''}|${b.order}`

  const oldBlockKey = new Map<string, string>()
  for (const b of oldBlocks) oldBlockKey.set(b.id, blockKey(oldLegPlace.get(b.leg_id) ?? '', b))

  const newLegByPlace = new Map(newLegs.map((l) => [l.place, l.id]))
  const newBlockByKey = new Map<string, string>()
  for (const b of newBlocks) newBlockByKey.set(blockKey(newLegPlace.get(b.leg_id) ?? '', b), b.id)

  return documents.map((d) => {
    if (d.day_block_id) {
      const key = oldBlockKey.get(d.day_block_id)
      const newId = key ? newBlockByKey.get(key) : undefined
      return { ...d, day_block_id: newId ?? null, leg_id: null }
    }
    if (d.leg_id) {
      const place = oldLegPlace.get(d.leg_id)
      const newId = place ? newLegByPlace.get(place) : undefined
      return { ...d, leg_id: newId ?? null, day_block_id: null }
    }
    return d
  })
}

export function documentsForLeg(bundle: TripBundle, legId: string): TripDocument[] {
  return bundle.documents.filter((d) => d.leg_id === legId)
}

export function documentsForBlock(bundle: TripBundle, blockId: string): TripDocument[] {
  return bundle.documents.filter((d) => d.day_block_id === blockId)
}

export function unattachedDocuments(bundle: TripBundle): TripDocument[] {
  return bundle.documents.filter((d) => !d.leg_id && !d.day_block_id)
}
