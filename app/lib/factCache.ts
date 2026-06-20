// ============================================================================
// FactCache — the one server-side store
// ============================================================================
//
// SCOPE GUARANTEE (do not violate): this store holds ONLY verified facts keyed
// by `(fact_type, place_a, place_b, mode)`. It never stores trip data, user
// data, or anything per-user. "How far is Lisbon from Porto" is exactly one
// entry across the entire product, for everyone — that is the whole point.
//
// Getting the key wrong (e.g. including trip_id) would make cost scale with
// trips/users instead of with the number of curated places, which defeats the
// reason the cache exists. See caching_strategy.md.
//
// Backend: Vercel KV when configured (KV_REST_API_URL + KV_REST_API_TOKEN),
// otherwise an in-process Map so local dev runs without KV credentials. The
// in-memory fallback is per-process and NOT shared — fine for dev, never for
// production scale.

import type { FactCacheEntry, TransitMode, VerifiedFact } from './types'

// 90 days, per the Tier-1 caching policy. Infrastructure between two cities
// doesn't change meaningfully faster than this.
export const FACT_TTL_MS = 90 * 24 * 60 * 60 * 1000

// Modes whose duration is roughly direction-independent, so Lisbon→Porto and
// Porto→Lisbon can share one cache entry (sorted key). Flights are NOT here:
// prevailing winds / routing make them genuinely asymmetric, so they are cached
// per-direction. Don't apply the sort shortcut to flights.
const SYMMETRIC_MODES: ReadonlySet<TransitMode> = new Set<TransitMode>([
  'train',
  'drive',
  'transit',
  'walk',
])

/** Builds the canonical cache key. For symmetric place-pair facts the two place
 *  names are sorted so both directions collapse to one entry; for asymmetric
 *  modes (flight) the order is preserved. Single-place facts pass place_b=null,
 *  mode=null. */
export function factKey(
  factType: VerifiedFact['type'],
  placeA: string,
  placeB: string | null,
  mode: TransitMode | null
): string {
  const a = normalizePlace(placeA)
  const b = placeB ? normalizePlace(placeB) : ''

  let left = a
  let right = b
  // Sort only when the mode is symmetric AND we actually have a pair.
  if (b && mode && SYMMETRIC_MODES.has(mode) && a > b) {
    left = b
    right = a
  }

  return ['fact', factType, left, right, mode ?? ''].join('|')
}

function normalizePlace(s: string): string {
  return s.trim().toLowerCase()
}

// ----------------------------------------------------------------------------
// Backend abstraction
// ----------------------------------------------------------------------------

interface KvLike {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts?: { px?: number }): Promise<unknown>
}

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

// In-process fallback used when KV isn't configured (local dev).
const memory = new Map<string, FactCacheEntry>()

let kvClient: KvLike | null = null
/** Lazily resolves the Vercel KV client. Imported dynamically so the package is
 *  only touched when KV is actually configured. */
async function getKv(): Promise<KvLike | null> {
  if (!kvConfigured()) return null
  if (kvClient) return kvClient
  const mod = await import('@vercel/kv')
  kvClient = mod.kv as unknown as KvLike
  return kvClient
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/** Reads a cached fact entry by key, or null if absent/stale. Staleness is
 *  re-checked here even though KV also sets a TTL, so the in-memory fallback
 *  (which has no native expiry) behaves identically. */
export async function getCachedFact(key: string): Promise<FactCacheEntry | null> {
  const entry = await readRaw(key)
  if (!entry) return null
  if (Date.now() > entry.fetched_at + entry.ttl_ms) return null
  return entry
}

/** Writes a fact entry. The TTL is mirrored into KV's own expiry so stale keys
 *  are eventually reclaimed, not just hidden by the staleness check. */
export async function setCachedFact(key: string, entry: FactCacheEntry): Promise<void> {
  const kv = await getKv()
  if (kv) {
    await kv.set(key, entry, { px: entry.ttl_ms })
  } else {
    memory.set(key, entry)
  }
}

async function readRaw(key: string): Promise<FactCacheEntry | null> {
  const kv = await getKv()
  if (kv) return (await kv.get<FactCacheEntry>(key)) ?? null
  return memory.get(key) ?? null
}

/** Manual early invalidation for the rare real-world change (e.g. a rail line
 *  closes). Not a systemic path — TTL handles ordinary staleness. */
export async function invalidateFact(key: string): Promise<void> {
  const kv = await getKv()
  if (kv) {
    await kv.set(key, null, { px: 1 })
  } else {
    memory.delete(key)
  }
}

/** Test/dev helper: clears the in-memory fallback. No effect on KV. */
export function __clearMemoryCache(): void {
  memory.clear()
}
