'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Utensils, Bed, type LucideIcon } from 'lucide-react'
import type { Place } from '../api/recommend/route'

interface TripMeta {
  destination: string
  startDate: string
  endDate: string
}

// Extends TripMeta with the fields the API route needs
interface PendingTrip extends TripMeta {
  travelStyles: string[]
  pace: string
}

const LOADING_MESSAGES = [
  'Cross-referencing your travel style...',
  'Checking the season and weather...',
  "Filtering for what's actually worth your time...",
  'Curating your shortlist...',
]

const SECTIONS: { category: Place['category']; heading: string }[] = [
  { category: 'sight', heading: 'Things to do' },
  { category: 'food', heading: 'Where to eat' },
  { category: 'stay', heading: 'Where to stay' },
]

const CATEGORY_BADGE: Record<Place['category'], { label: string; className: string; Icon: LucideIcon }> = {
  sight: { label: 'Sight', className: 'bg-emerald-100 text-emerald-700', Icon: MapPin },
  food: { label: 'Food & Drink', className: 'bg-amber-100 text-amber-700', Icon: Utensils },
  stay: { label: 'Stay', className: 'bg-indigo-100 text-indigo-700', Icon: Bed },
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

function LoadingScreen({ destination, messageIndex }: { destination: string; messageIndex: number }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-sm w-full">
        {/* Three staggered pulsing dots */}
        <div className="flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 bg-stone-400 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-stone-900">
            Sherpa is curating your shortlist
          </h1>
          <p className="text-stone-500 text-sm">Researching {destination}...</p>
        </div>
        {/* Rotating status message — min-h prevents layout shift on text change */}
        <p className="text-stone-400 text-sm min-h-[1.25rem]">
          {LOADING_MESSAGES[messageIndex]}
        </p>
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const router = useRouter()
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [trip, setTrip] = useState<TripMeta | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Prevents a flash of the empty state before sessionStorage is checked
  const [checked, setChecked] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const rawPlaces = sessionStorage.getItem('sherpa_recommendations')
    const rawTrip = sessionStorage.getItem('sherpa_trip')

    // We already have results from a previous or completed run
    if (rawPlaces && rawTrip) {
      setPlaces(JSON.parse(rawPlaces))
      setTrip(JSON.parse(rawTrip))
      setChecked(true)
      return
    }

    // A fresh form submission — form data is waiting for us to call the API
    const rawPending = sessionStorage.getItem('sherpa_pending_trip')
    if (!rawPending) {
      setChecked(true)
      return
    }

    const pending: PendingTrip = JSON.parse(rawPending)
    setTrip({ destination: pending.destination, startDate: pending.startDate, endDate: pending.endDate })
    setIsLoading(true)
    setChecked(true)

    fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawPending,
    })
      .then((res) => {
        if (!res.ok) throw new Error('Something went wrong. Please try again.')
        return res.json()
      })
      .then((data) => {
        const tripMeta = { destination: pending.destination, startDate: pending.startDate, endDate: pending.endDate }
        sessionStorage.setItem('sherpa_recommendations', JSON.stringify(data.places))
        sessionStorage.setItem('sherpa_trip', JSON.stringify(tripMeta))
        sessionStorage.removeItem('sherpa_pending_trip')
        setPlaces(data.places)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        setIsLoading(false)
      })
  }, [])

  // Rotate loading messages every 2 seconds while the API call is in flight
  useEffect(() => {
    if (!isLoading) return
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [isLoading])

  // Before the first useEffect has run — render background only to avoid flash
  if (!checked) {
    return <div className="min-h-screen bg-stone-50" />
  }

  if (isLoading && trip) {
    return <LoadingScreen destination={trip.destination} messageIndex={messageIndex} />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-stone-500">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-stone-700 underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

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
    <div className="min-h-screen bg-stone-50 px-4 py-16">
      <div className="max-w-2xl mx-auto space-y-12">

        {/* Trip header — bigger heading, more whitespace */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-stone-400 tracking-widest uppercase">
            Your Sherpa shortlist
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-stone-900">{trip.destination}</h1>
          <p className="text-stone-500 text-sm">
            {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
          </p>
        </div>

        {/* Recommendations grouped by category */}
        <div className="space-y-10">
          {SECTIONS.map(({ category, heading }) => {
            const sectionPlaces = places.filter((p) => p.category === category)
            if (sectionPlaces.length === 0) return null

            return (
              <section key={category}>
                <div className="flex items-baseline gap-2 mb-4">
                  <h2 className="text-lg font-bold text-stone-900">{heading}</h2>
                  <span className="text-sm text-stone-400">({sectionPlaces.length})</span>
                </div>

                <div className="space-y-4">
                  {sectionPlaces.map((place, i) => {
                    const { label, className, Icon } = CATEGORY_BADGE[place.category]
                    return (
                      <div
                        key={i}
                        className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-3 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 cursor-default"
                      >
                        {/* Name + category badge with icon */}
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-lg font-bold text-stone-900 leading-snug">{place.name}</h3>
                          <span className={`shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${className}`}>
                            <Icon size={11} strokeWidth={2.5} />
                            {label}
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
              </section>
            )
          })}
        </div>

        {/* More prominent "Plan another trip" button */}
        <div className="text-center pt-4">
          <button
            onClick={() => router.push('/')}
            className="bg-stone-900 text-white font-medium px-8 py-3 rounded-lg hover:bg-stone-700 active:bg-stone-800 transition"
          >
            Plan another trip
          </button>
        </div>

      </div>
    </div>
  )
}
