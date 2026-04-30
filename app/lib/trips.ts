import type { Place, SmartNote } from '../api/recommend/route'

export type { SmartNote }

export interface SavedTrip {
  id: number
  destination: string
  startDate: string
  endDate: string
  styleTags: string[]
  pace: string
  weatherSummary?: string
  smartNotes?: SmartNote[]
  places: Place[]
  savedAt: number
}

const STORAGE_KEY = 'sherpa_trips'

function readTrips(): SavedTrip[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedTrip[]) : []
  } catch {
    return []
  }
}

function writeTrips(trips: SavedTrip[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trips))
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.)
  }
}

export function getAllTrips(): SavedTrip[] {
  return readTrips().sort((a, b) => b.savedAt - a.savedAt)
}

export function getTrip(id: number): SavedTrip | null {
  return readTrips().find((t) => t.id === id) ?? null
}

// Adds a new trip or updates an existing one matched by destination + date range.
export function saveTrip(trip: SavedTrip): void {
  const trips = readTrips()
  const idx = trips.findIndex(
    (t) =>
      t.destination === trip.destination &&
      t.startDate === trip.startDate &&
      t.endDate === trip.endDate
  )
  if (idx >= 0) {
    trips[idx] = trip
  } else {
    trips.push(trip)
  }
  writeTrips(trips)
}

export function deleteTrip(id: number): void {
  writeTrips(readTrips().filter((t) => t.id !== id))
}
