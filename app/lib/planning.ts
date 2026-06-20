// ============================================================================
// In-progress planning state (sessionStorage)
// ============================================================================
//
// Holds what the user has entered as they move landing → dates → swipe →
// bridge, before a Trip bundle exists. Once decisions are generated, the result
// is persisted as a TripBundle in localStorage (store.ts) and this is cleared.

import type { SwipeAnswer } from './swipeMapping'

export interface PlanningState {
  destination: string
  startDate?: string
  endDate?: string
  /** card_id → answer */
  swipeAnswers?: Record<string, SwipeAnswer>
}

const KEY = 'sherpa_planning'

export function readPlanning(): PlanningState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PlanningState) : null
  } catch {
    return null
  }
}

export function writePlanning(patch: Partial<PlanningState>): PlanningState {
  const current = readPlanning() ?? { destination: '' }
  const next = { ...current, ...patch }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}

export function clearPlanning(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
