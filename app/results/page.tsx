'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Place } from '../api/recommend/route'

interface TripMeta {
  destination: string
  startDate: string
  endDate: string
}

// Maps each category to a human-readable label and Tailwind badge colours
const CATEGORY_BADGE: Record<Place['category'], { label: string; className: string }> = {
  sight: { label: 'Sight', className: 'bg-sky-100 text-sky-700' },
  food: { label: 'Food & Drink', className: 'bg-amber-100 text-amber-700' },
  stay: { label: 'Stay', className: 'bg-emerald-100 text-emerald-700' },
}

// Converts a YYYY-MM-DD string to a readable date without timezone shifting
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function ResultsPage() {
  const router = useRouter()
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [trip, setTrip] = useState<TripMeta | null>(null)

  // sessionStorage is only available in the browser, so we read it after the first render
  useEffect(() => {
    const rawPlaces = sessionStorage.getItem('sherpa_recommendations')
    const rawTrip = sessionStorage.getItem('sherpa_trip')
    if (rawPlaces && rawTrip) {
      setPlaces(JSON.parse(rawPlaces))
      setTrip(JSON.parse(rawTrip))
    }
  }, [])

  // User navigated here directly without submitting a trip
  if (!places || !trip) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-stone-500">No recommendations found.</p>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-stone-700 underline underline-offset-2"
          >
            Plan a trip
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Trip header */}
        <div>
          <p className="text-xs font-semibold text-stone-400 tracking-widest uppercase mb-1">
            Your Sherpa shortlist
          </p>
          <h1 className="text-3xl font-bold text-stone-900">{trip.destination}</h1>
          <p className="text-stone-500 mt-1 text-sm">
            {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
          </p>
        </div>

        {/* One card per recommended place */}
        <div className="space-y-4">
          {places.map((place, i) => {
            const badge = CATEGORY_BADGE[place.category]
            return (
              <div
                key={i}
                className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-3"
              >
                {/* Name + category badge */}
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-bold text-stone-900 leading-snug">{place.name}</h2>
                  <span
                    className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Description */}
                <p className="text-stone-600 text-sm leading-relaxed">{place.description}</p>

                {/* Why this made the cut */}
                <div className="pt-2 border-t border-stone-100">
                  <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
                    Why this made the cut
                  </p>
                  <p className="text-stone-700 text-sm leading-relaxed">{place.whyItMadeTheCut}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Start over */}
        <div className="text-center pt-2">
          <button
            onClick={() => router.push('/')}
            className="text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2 transition"
          >
            Plan another trip
          </button>
        </div>

      </div>
    </div>
  )
}
