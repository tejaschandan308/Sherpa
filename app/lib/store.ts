// ============================================================================
// Client-side persistence (localStorage) for the new trip model
// ============================================================================
//
// Per CLAUDE.md, v1 has no database: trips/decisions/legs/day-blocks all live
// in the browser's localStorage. The ONE exception is the FactCache, which is a
// shared, cross-user fact store and therefore lives server-side (see
// factCache.ts) — never here.
//
// Everything is stored under a single namespaced key as one JSON blob, keyed by
// trip id. This mirrors the old trips.ts approach but stores the new entities
// (decisions/legs/edges/day-blocks/documents) instead of a flat place list.
//
// This module is intentionally separate from the legacy `trips.ts` so the old
// curation screens keep working until the new screens replace them wholesale.

import type { TripBundle } from './types'

const STORAGE_KEY = 'sherpa_v2_trips'

/** Reads the full map of trip bundles from localStorage. Returns {} on any
 *  failure (private browsing, corrupt JSON, SSR with no window). */
function readAll(): Record<string, TripBundle> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, TripBundle>) : {}
  } catch {
    return {}
  }
}

/** Writes the full map back. Swallows quota/availability errors silently. */
function writeAll(bundles: Record<string, TripBundle>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundles))
  } catch {
    // localStorage unavailable or full — nothing actionable for v1.
  }
}

/** All trips, sorted by proximity to departure: trips whose start date is
 *  nearest in the future come first (matches the dashboard sort rule). Past
 *  trips sink to the bottom, most-recently-departed first. */
export function getAllBundles(): TripBundle[] {
  const todayMs = startOfTodayMs()
  return Object.values(readAll()).sort((a, b) => {
    const aMs = dateToMs(a.trip.start_date)
    const bMs = dateToMs(b.trip.start_date)
    const aFuture = aMs >= todayMs
    const bFuture = bMs >= todayMs
    // Upcoming trips before past trips.
    if (aFuture !== bFuture) return aFuture ? -1 : 1
    // Among upcoming: soonest first. Among past: most recent first.
    return aFuture ? aMs - bMs : bMs - aMs
  })
}

export function getBundle(tripId: string): TripBundle | null {
  return readAll()[tripId] ?? null
}

/** Inserts or replaces a trip bundle, keyed by trip id. */
export function saveBundle(bundle: TripBundle): void {
  const all = readAll()
  all[bundle.trip.id] = bundle
  writeAll(all)
}

export function deleteBundle(tripId: string): void {
  const all = readAll()
  delete all[tripId]
  writeAll(all)
}

// --- date helpers (local-midnight, to avoid UTC date-shift bugs) ---

function startOfTodayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dateToMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
