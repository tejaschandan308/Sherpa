// ============================================================================
// Maps facts layer — the only place Maps API calls live
// ============================================================================
//
// Everything here produces a `VerifiedFact` (or null). These facts are the ONLY
// distances/durations the rest of the app — and Claude — is ever allowed to
// use. Claude is never asked to recall or estimate a number; it only reasons
// over facts produced here.
//
// Every fetch reads/writes through the FactCache, so a given place-pair is paid
// for once across all trips and all users (see factCache.ts).

import {
  FACT_TTL_MS,
  factKey,
  getCachedFact,
  setCachedFact,
} from './factCache'
import { lookupPlaceTier } from './placeTiers'
import type { FactCacheEntry, TransitMode, VerifiedFact } from './types'

interface Coordinates {
  lat: number
  lng: number
}

// Our TransitMode → Google Distance Matrix `mode`. Google has no "train" mode;
// trains fall under `transit`. Flights are not a Distance Matrix mode at all,
// so flight facts cannot be sourced here — we return null rather than guess.
const GOOGLE_MODE: Partial<Record<TransitMode, 'driving' | 'transit' | 'walking'>> = {
  train: 'transit',
  transit: 'transit',
  drive: 'driving',
  walk: 'walking',
  // flight: intentionally absent
}

/** Slug used in fact_ids so `facts_cited` references line up deterministically
 *  with the facts handed to the model. */
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ----------------------------------------------------------------------------
// Place-tier facts (first-party — never touches the Maps API)
// ----------------------------------------------------------------------------

/** Builds a place-tier VerifiedFact from the hand-curated dataset, or null if
 *  the place isn't curated (the caller must treat null as a hard stop). */
export function placeTierFact(place: string): VerifiedFact | null {
  const entry = lookupPlaceTier(place)
  if (!entry) return null
  return {
    fact_id: `place_tier_${slug(entry.place)}`,
    type: 'place_tier',
    place: entry.place,
    tier: entry.tier,
    source: 'sherpa_place_heuristics',
  }
}

// ----------------------------------------------------------------------------
// Transit facts (Distance Matrix, cached)
// ----------------------------------------------------------------------------

/** Returns a verified transit fact between two places for the given mode,
 *  reading through the FactCache and fetching from Google only on a miss.
 *  Returns null if the mode is unsupported by Distance Matrix (e.g. flight) or
 *  the fetch fails — callers must degrade rather than fabricate a number. */
export async function getTransitFact(
  from: string,
  to: string,
  mode: TransitMode = 'train'
): Promise<VerifiedFact | null> {
  const googleMode = GOOGLE_MODE[mode]
  if (!googleMode) return null // flight / unsupported — never guessed

  const key = factKey('transit_time', from, to, mode)
  const cached = await getCachedFact(key)
  if (cached) return factFromCache(cached)

  const fetched = await fetchTransitFromGoogle(from, to, mode, googleMode)
  if (!fetched) return null

  const entry: FactCacheEntry = {
    fact_type: 'transit_time',
    place_a: from,
    place_b: to,
    mode,
    value: {
      type: 'transit_time',
      place: from,
      to,
      mode,
      duration_minutes: fetched.duration_minutes,
      distance_meters: fetched.distance_meters,
      source: 'google_distance_matrix',
    },
    fetched_at: Date.now(),
    ttl_ms: FACT_TTL_MS,
  }
  await setCachedFact(key, entry)
  return factFromCache(entry)
}

/** Rebuilds a VerifiedFact (with its deterministic fact_id) from a cache row. */
function factFromCache(entry: FactCacheEntry): VerifiedFact {
  const v = entry.value
  const id =
    v.type === 'transit_time'
      ? `transit_${slug(entry.place_a)}_${slug(entry.place_b ?? '')}_${entry.mode}`
      : `place_meta_${slug(entry.place_a)}`
  return { fact_id: id, ...v }
}

/** Low-level Distance Matrix call. Passes place names as text (Distance Matrix
 *  geocodes them server-side), so no separate geocode round-trip is needed. */
async function fetchTransitFromGoogle(
  from: string,
  to: string,
  mode: TransitMode,
  googleMode: 'driving' | 'transit' | 'walking'
): Promise<{ duration_minutes: number; distance_meters: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${encodeURIComponent(from)}` +
      `&destinations=${encodeURIComponent(to)}` +
      `&mode=${googleMode}` +
      `&key=${apiKey}`

    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const el = data.rows?.[0]?.elements?.[0]
    if (!el || el.status !== 'OK' || !el.duration || !el.distance) return null

    return {
      duration_minutes: Math.round(el.duration.value / 60),
      distance_meters: el.distance.value,
    }
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// Place metadata fact (existence check, cached)
// ----------------------------------------------------------------------------

/** Confirms a place exists per the Places API and caches that fact. Used where
 *  we need to verify a place is real before reasoning about it. Returns null on
 *  failure — absence of confirmation is never treated as confirmation. */
export async function getPlaceMetadataFact(place: string): Promise<VerifiedFact | null> {
  const key = factKey('place_metadata', place, null, null)
  const cached = await getCachedFact(key)
  if (cached) return factFromCache(cached)

  const coords = await geocodePlace(place)
  if (!coords) return null

  const entry: FactCacheEntry = {
    fact_type: 'place_metadata',
    place_a: place,
    place_b: null,
    mode: null,
    value: {
      type: 'place_metadata',
      place,
      source: 'google_places',
    },
    fetched_at: Date.now(),
    ttl_ms: FACT_TTL_MS,
  }
  await setCachedFact(key, entry)
  return factFromCache(entry)
}

/** Geocodes a free-text place into coordinates. Returns null on any failure. */
async function geocodePlace(place: string): Promise<Coordinates | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&key=${apiKey}`
    )
    if (!res.ok) return null
    const data = await res.json()
    const loc = data.results?.[0]?.geometry?.location
    return loc ? { lat: loc.lat, lng: loc.lng } : null
  } catch {
    return null
  }
}
