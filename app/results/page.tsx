'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { MapPin, Utensils, Bed, Star, Cloud, Train, Car, Footprints, Layers, Calendar, AlertCircle, Clock, type LucideIcon } from 'lucide-react'
import type { Place, PlaceReview, SmartNote } from '../api/recommend/route'
import { saveTrip, getTrip, type SavedTrip } from '../lib/trips'
import SherpaNav from '../components/SherpaNav'

interface TripMeta {
  destination: string
  startDate: string
  endDate: string
  weatherSummary?: string
  smartNotes?: SmartNote[]
}

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

const SMART_NOTE_ICON: Record<string, LucideIcon> = {
  cluster: Layers,
  day_trip: Calendar,
  warning: AlertCircle,
  timing: Clock,
}

const CATEGORY_BADGE: Record<Place['category'], { label: string; className: string; Icon: LucideIcon }> = {
  sight: { label: 'Sight', className: 'bg-emerald-100 text-emerald-700', Icon: MapPin },
  food: { label: 'Food & Drink', className: 'bg-amber-100 text-amber-700', Icon: Utensils },
  stay: { label: 'Stay', className: 'bg-indigo-100 text-indigo-700', Icon: Bed },
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Renders filled/empty stars. Pass fill="currentColor" to override lucide's default fill="none".
function ReviewStars({ rating, size }: { rating: number; size: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          strokeWidth={1}
          fill={s <= Math.round(rating) ? 'currentColor' : 'none'}
          className={s <= Math.round(rating) ? 'text-amber-400' : 'text-stone-300'}
        />
      ))}
    </div>
  )
}

// A single Google review row: name, stars, relative time, clamped text
function ReviewRow({ review, isFirst }: { review: PlaceReview; isFirst: boolean }) {
  return (
    <div className={isFirst ? '' : 'pt-2.5 border-t border-stone-100'}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-[#3D3830] truncate">{review.authorName}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <ReviewStars rating={review.rating} size={10} />
          <span className="text-[10px] text-[#9A9087]">{review.relativePublishTimeDescription}</span>
        </div>
      </div>
      <p className="text-xs text-[#6B6B6B] leading-relaxed line-clamp-2">{review.text}</p>
    </div>
  )
}

function LoadingScreen({ destination, messageIndex }: { destination: string; messageIndex: number }) {
  return (
    <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
      <SherpaNav />
      <div className="flex-1 flex items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-sm w-full">
        <div className="flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 bg-[#B07242] rounded-full animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#1A1A1A]">
            Sherpa is curating your shortlist
          </h1>
          <p className="text-[#6B6B6B] text-sm">Researching {destination}...</p>
        </div>
        <p className="text-[#9A9087] text-sm min-h-[1.25rem]">
          {LOADING_MESSAGES[messageIndex]}
        </p>
      </div>
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
  const [checked, setChecked] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    // If a tripId param is present, load directly from localStorage (no API call needed)
    const urlParams = new URLSearchParams(window.location.search)
    const tripIdParam = urlParams.get('tripId')

    if (tripIdParam) {
      const saved = getTrip(parseInt(tripIdParam, 10))
      if (!saved) {
        router.replace('/trips')
        return
      }
      setPlaces(saved.places)
      setTrip({
        destination: saved.destination,
        startDate: saved.startDate,
        endDate: saved.endDate,
        weatherSummary: saved.weatherSummary,
        smartNotes: saved.smartNotes,
      })
      setChecked(true)
      return
    }

    // --- New trip flow: read from sessionStorage, call API ---
    const rawPlaces = sessionStorage.getItem('sherpa_recommendations')
    const rawTrip = sessionStorage.getItem('sherpa_trip')

    if (rawPlaces && rawTrip) {
      setPlaces(JSON.parse(rawPlaces))
      setTrip(JSON.parse(rawTrip))
      setChecked(true)
      return
    }

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
        const tripMeta: TripMeta = {
          destination: pending.destination,
          startDate: pending.startDate,
          endDate: pending.endDate,
          weatherSummary: data.weatherSummary,
          smartNotes: data.smartNotes,
        }
        sessionStorage.setItem('sherpa_recommendations', JSON.stringify(data.places))
        sessionStorage.setItem('sherpa_trip', JSON.stringify(tripMeta))
        sessionStorage.removeItem('sherpa_pending_trip')

        // Auto-save to localStorage and update URL to reflect the saved trip ID
        const now = Date.now()
        const newTrip: SavedTrip = {
          id: now,
          destination: pending.destination,
          startDate: pending.startDate,
          endDate: pending.endDate,
          styleTags: pending.travelStyles,
          pace: pending.pace,
          weatherSummary: data.weatherSummary,
          smartNotes: data.smartNotes,
          places: data.places,
          savedAt: now,
        }
        saveTrip(newTrip)
        window.history.replaceState(null, '', `/results?tripId=${now}`)

        setPlaces(data.places)
        setTrip(tripMeta)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        setIsLoading(false)
      })
  }, [])

  // Rotate loading messages every 2 seconds while fetching
  useEffect(() => {
    if (!isLoading) return
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [isLoading])

  if (!checked) {
    return <div className="min-h-screen bg-[#FAFAF7]" />
  }

  if (isLoading && trip) {
    return <LoadingScreen destination={trip.destination} messageIndex={messageIndex} />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
        <SherpaNav />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-[#6B6B6B]">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="text-sm text-[#3D3830] underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!places || !trip) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
        <SherpaNav />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-[#6B6B6B]">No recommendations found.</p>
            <button
              onClick={() => router.push('/')}
              className="text-sm text-[#3D3830] underline underline-offset-2"
            >
              Plan a trip
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7] animate-fade-in-up">
      <SherpaNav />
      <div className="px-4 pb-16">
      <div className="max-w-4xl mx-auto space-y-12">

        {/* Trip header */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#9A9087] tracking-widest uppercase">
            Your Sherpa shortlist
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-[#1A1A1A]">{trip.destination}</h1>
          <p className="text-[#6B6B6B] text-sm">
            {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
          </p>
        </div>

        {/* Weather note — only shown when Claude returned a weatherSummary */}
        {trip.weatherSummary && (
          <div className="flex items-start gap-3 bg-sky-50/70 border border-sky-100 rounded-xl px-4 py-3">
            <Cloud size={15} className="text-sky-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold text-sky-500 uppercase tracking-wider mb-0.5">
                Weather note
              </p>
              <p className="text-sm text-[#3D3830] leading-relaxed">{trip.weatherSummary}</p>
            </div>
          </div>
        )}

        {/* Smart notes — cross-cutting observations from Sherpa */}
        {trip.smartNotes && trip.smartNotes.length > 0 && (
          <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-4 space-y-3">
            <p className="text-[10px] font-semibold text-[#9A9087] uppercase tracking-widest">
              Sherpa says
            </p>
            <div className="space-y-2.5">
              {trip.smartNotes.map((note, i) => {
                const Icon = SMART_NOTE_ICON[note.type] ?? MapPin
                return (
                  <div key={i} className="flex items-start gap-2.5">
                    <Icon size={14} strokeWidth={1.75} className="text-[#B07242] mt-0.5 shrink-0" />
                    <p className="text-sm text-[#3D3830] leading-relaxed">{note.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Recommendations grouped by category */}
        <div className="space-y-10">
          {SECTIONS.map(({ category, heading }) => {
            const sectionPlaces = places.filter((p) => p.category === category)
            if (sectionPlaces.length === 0) return null

            return (
              <section key={category}>
                <div className="flex items-baseline gap-2 mb-4">
                  <h2 className="text-lg font-bold text-[#1A1A1A]">{heading}</h2>
                  <span className="text-sm text-[#9A9087]">({sectionPlaces.length})</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {sectionPlaces.map((place, i) => {
                    const { label, className, Icon } = CATEGORY_BADGE[place.category]
                    return (
                      <div
                        key={i}
                        className="flex flex-col h-full bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 cursor-default"
                      >
                        {/* Photo — full-width at top, or gray placeholder if missing */}
                        {place.photoUrl ? (
                          <div className="relative h-48 w-full">
                            <Image
                              src={place.photoUrl}
                              alt={place.name}
                              fill
                              className="object-cover"
                              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 448px"
                            />
                          </div>
                        ) : (
                          <div className="h-48 w-full bg-stone-100" />
                        )}

                        {/* Card body */}
                        <div className="flex-1 p-6 space-y-3">
                          {/* Name + category badge */}
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-lg font-bold text-[#1A1A1A] leading-snug">{place.name}</h3>
                            <span className={`shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${className}`}>
                              <Icon size={11} strokeWidth={2.5} />
                              {label}
                            </span>
                          </div>

                          {/* Description */}
                          <p className="text-[#6B6B6B] text-sm leading-relaxed">{place.description}</p>

                          {/* Rating + Reviews — only rendered when Google Places returned data */}
                          {(place.rating != null || (place.reviews && place.reviews.length > 0)) && (
                            <div className="space-y-2.5">
                              {/* Overall rating line */}
                              {place.rating != null && (
                                <div className="flex items-center gap-1.5">
                                  <Star size={14} strokeWidth={1} fill="currentColor" className="text-amber-400" />
                                  <span className="text-sm font-semibold text-[#1A1A1A]">
                                    {place.rating.toFixed(1)}
                                  </span>
                                  {place.userRatingCount != null && (
                                    <span className="text-xs text-[#9A9087]">
                                      ({place.userRatingCount.toLocaleString()} reviews)
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Individual reviews in a muted inset block */}
                              {place.reviews && place.reviews.length > 0 && (
                                <div className="bg-stone-50 rounded-xl p-3.5 space-y-2.5">
                                  <p className="text-[10px] font-semibold text-[#9A9087] uppercase tracking-wider">
                                    Reviews from Google
                                  </p>
                                  <div>
                                    {place.reviews.map((review, ri) => (
                                      <ReviewRow key={ri} review={review} isFirst={ri === 0} />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Distance + transit info */}
                          {place.distanceText && (
                            <div className="flex items-center gap-2 text-xs text-[#9A9087] flex-wrap">
                              <span className="flex items-center gap-1">
                                <MapPin size={12} strokeWidth={1.5} />
                                {place.distanceText}
                              </span>
                              {place.durationText && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="flex items-center gap-1">
                                    {place.transitLabel === 'Walkable' ? (
                                      <Footprints size={12} strokeWidth={1.5} />
                                    ) : place.transitLabel === 'Transit accessible' ? (
                                      <Train size={12} strokeWidth={1.5} />
                                    ) : (
                                      <Car size={12} strokeWidth={1.5} />
                                    )}
                                    {place.durationText}
                                  </span>
                                </>
                              )}
                              {place.transitLabel && (
                                <span className="bg-stone-100 text-[#9A9087] px-2 py-0.5 rounded-full text-[10px] font-medium">
                                  {place.transitLabel}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Why this made the cut */}
                          <div className="pt-2 border-t border-stone-100">
                            <p className="text-xs font-semibold text-[#9A9087] uppercase tracking-wide mb-1">
                              Why this made the cut
                            </p>
                            <p className="text-[#3D3830] text-sm leading-relaxed">{place.whyItMadeTheCut}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        {/* Plan another trip — prominent terracotta button */}
        <div className="text-center pt-4 pb-8">
          <button
            onClick={() => router.push('/')}
            className="bg-[#B07242] text-white font-medium px-8 py-3 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] transition"
          >
            Plan another trip
          </button>
        </div>

      </div>
      </div>
    </div>
  )
}
