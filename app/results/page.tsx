'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import type { Place, SmartNote } from '../api/recommend/route'
import { saveTrip, getTrip, type SavedTrip } from '../lib/trips'
import SherpaNav from '../components/SherpaNav'

interface TripMeta {
  destination: string
  startDate: string
  endDate: string
  weatherSummary?: string
  weatherKicker?: string
  smartNotes?: SmartNote[]
  destinationAdverb?: string
  tripFrame?: string
  temperatureRange?: string
  destinationHeroPhotoUrl?: string
  curatedAt?: number
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

const SECTIONS: { category: Place['category']; label: string }[] = [
  { category: 'sight', label: 'Do.' },
  { category: 'food', label: 'Eat.' },
  { category: 'stay', label: 'Stay.' },
]

const SMART_NOTE_LABEL: Record<string, string> = {
  cluster: 'CLUSTER',
  day_trip: 'DAY TRIP',
  warning: 'HEADS UP',
  timing: 'TIMING',
}

// Formats a timestamp as "DD MMM YYYY" for the editorial header strip.
function formatCuratedDate(ts?: number): string {
  const date = ts ? new Date(ts) : new Date()
  const day = date.getDate().toString().padStart(2, '0')
  const month = date.toLocaleString('en-GB', { month: 'short' }).toUpperCase()
  return `${day} ${month} ${date.getFullYear()}`
}

// Returns the kicker phrase for the weather line.
// Prefers weatherKicker from the API; falls back to the first sentence of weatherSummary
// so that saved trips generated before this field existed still render something.
function getKickerPhrase(trip: TripMeta): string | null {
  if (trip.weatherKicker) return trip.weatherKicker
  if (trip.weatherSummary) {
    const first = trip.weatherSummary.split(/[.!?]/)[0]?.trim()
    return first && first.length > 0 ? first : null
  }
  return null
}

// Editorial pull-quote — italic Georgia, no author name, clamped to 2 lines
function PullQuote({ text }: { text: string }) {
  return (
    <p
      className="text-[#6B6B6B] text-sm leading-relaxed line-clamp-2 pl-3 border-l border-stone-300"
      style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}
    >
      &ldquo;{text}&rdquo;
    </p>
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
        weatherKicker: saved.weatherKicker,
        smartNotes: saved.smartNotes,
        destinationAdverb: saved.destinationAdverb,
        tripFrame: saved.tripFrame,
        temperatureRange: saved.temperatureRange,
        destinationHeroPhotoUrl: saved.destinationHeroPhotoUrl,
        curatedAt: saved.savedAt,
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
        const now = Date.now()
        const tripMeta: TripMeta = {
          destination: pending.destination,
          startDate: pending.startDate,
          endDate: pending.endDate,
          weatherSummary: data.weatherSummary,
          weatherKicker: data.weatherKicker,
          smartNotes: data.smartNotes,
          destinationAdverb: data.destinationAdverb,
          tripFrame: data.tripFrame,
          temperatureRange: data.temperatureRange,
          destinationHeroPhotoUrl: data.destinationHeroPhotoUrl,
          curatedAt: now,
        }
        sessionStorage.setItem('sherpa_recommendations', JSON.stringify(data.places))
        sessionStorage.setItem('sherpa_trip', JSON.stringify(tripMeta))
        sessionStorage.removeItem('sherpa_pending_trip')

        // Auto-save to localStorage and update URL to reflect the saved trip ID
        const newTrip: SavedTrip = {
          id: now,
          destination: pending.destination,
          startDate: pending.startDate,
          endDate: pending.endDate,
          styleTags: pending.travelStyles,
          pace: pending.pace,
          weatherSummary: data.weatherSummary,
          weatherKicker: data.weatherKicker,
          smartNotes: data.smartNotes,
          places: data.places,
          savedAt: now,
          destinationAdverb: data.destinationAdverb,
          tripFrame: data.tripFrame,
          temperatureRange: data.temperatureRange,
          destinationHeroPhotoUrl: data.destinationHeroPhotoUrl,
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

      {/* Editorial header strip */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-stone-200">
        <span
          className="text-sm text-[#1A1A1A] italic"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Sherpa
        </span>
        <span className="text-[10px] font-medium text-[#9A9087] uppercase tracking-[0.18em]">
          Curated {formatCuratedDate(trip.curatedAt)}
        </span>
      </div>

      {/* Full-bleed hero */}
      <div className="relative w-full" style={{ height: '45vh', minHeight: '280px' }}>
        {trip.destinationHeroPhotoUrl ? (
          <Image
            src={trip.destinationHeroPhotoUrl}
            alt={trip.destination}
            fill
            className="object-cover"
            sizes="100vw"
            priority
          />
        ) : (
          <div className="absolute inset-0 bg-stone-300" />
        )}
        {/* Gradient: transparent top → dark bottom 50% */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

        {/* Headline + subtitle */}
        <div className="absolute inset-0 flex flex-col justify-end px-6 pb-6 md:px-10 md:pb-8">
          <h1
            className="text-white text-4xl md:text-5xl leading-tight italic mb-2"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            {trip.destination}
            {trip.destinationAdverb ? `, ${trip.destinationAdverb}.` : '.'}
          </h1>
          {trip.tripFrame && (
            <p className="text-white/80 text-sm font-light tracking-wide">
              {trip.tripFrame}
            </p>
          )}
        </div>

        {/* Bottom-right candidacy label */}
        <div className="absolute bottom-4 right-5 md:bottom-6 md:right-8">
          <span
            className="text-white/50 text-[9px] font-medium uppercase"
            style={{ letterSpacing: '0.18em' }}
          >
            A shortlist of eight, from 1,000+ candidates.
          </span>
        </div>
      </div>

      <div className="px-4 pb-20">
      <div className="max-w-4xl mx-auto">

        {/* Sections — Do. / Eat. / Stay. */}
        {(() => {
          let runningTotal = 0
          return SECTIONS.map(({ category, label }) => {
            const sectionPlaces = places.filter((p) => p.category === category)
            if (sectionPlaces.length === 0) return null

            const startCard = runningTotal + 1
            const endCard = runningTotal + sectionPlaces.length
            runningTotal += sectionPlaces.length

            return (
              <section key={category}>

                {/* Editorial section header */}
                <div className="pt-16 md:pt-20">
                  <div className="flex items-end justify-between pb-4">
                    <h2
                      className="text-[#1A1A1A] italic leading-none"
                      style={{
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: 'clamp(3.5rem, 8vw, 4.75rem)',
                        fontWeight: 300,
                      }}
                    >
                      {label}
                    </h2>
                    <span
                      className="text-[10px] font-medium text-[#999] uppercase mb-1"
                      style={{ letterSpacing: '0.15em' }}
                    >
                      {String(startCard).padStart(2, '0')} / {String(endCard).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="border-b border-stone-200" />
                </div>

                {/* Cards */}
                <div>
                  {sectionPlaces.map((place, i) => (
                    <div key={i} className={i > 0 ? 'mt-14 md:mt-16' : 'mt-8'}>

                      {/* Horizontal card: photo left, content right */}
                      <div className="flex flex-col md:flex-row">

                        {/* Photo */}
                        <div className="relative h-64 md:h-auto md:w-[45%] flex-shrink-0 rounded-sm overflow-hidden">
                          {place.photoUrl ? (
                            <Image
                              src={place.photoUrl}
                              alt={place.name}
                              fill
                              className="object-cover"
                              sizes="(max-width: 768px) 100vw, 45vw"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-stone-200" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 flex flex-col pt-6 md:px-10 md:pt-6 md:pb-6">

                          {/* Name + rating */}
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <h3
                              className="text-[#1A1A1A] italic leading-tight"
                              style={{
                                fontFamily: 'Georgia, "Times New Roman", serif',
                                fontSize: '1.75rem',
                                fontWeight: 400,
                              }}
                            >
                              {place.name}
                            </h3>
                            {place.rating != null && (
                              <div className="flex items-center gap-1.5 shrink-0 mt-1.5">
                                <Star size={12} strokeWidth={1} fill="currentColor" className="text-amber-400" />
                                <span className="text-sm text-[#1A1A1A]">
                                  {place.rating.toFixed(1)}
                                </span>
                                {place.userRatingCount != null && (
                                  <span className="text-xs text-[#999]">
                                    ({place.userRatingCount.toLocaleString()})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Description */}
                          <p className="text-[#666] text-sm leading-relaxed mb-5">
                            {place.description}
                          </p>

                          {/* Pull-quotes — reviewer name dropped for editorial feel */}
                          {place.reviews && place.reviews.length > 0 && (
                            <div className="space-y-2.5 mb-5">
                              {place.reviews
                                .filter((r) => r.text.trim().length > 0)
                                .map((review, ri) => (
                                  <PullQuote key={ri} text={review.text} />
                                ))}
                            </div>
                          )}

                          {/* Distance / transit metadata */}
                          {place.distanceText && (
                            <p
                              className="text-[10px] font-medium text-[#999] uppercase mt-auto"
                              style={{ letterSpacing: '0.12em' }}
                            >
                              {place.distanceText} from centre
                              {place.durationText ? `  /  ${place.durationText}` : ''}
                              {!place.durationText && place.transitLabel ? `  /  ${place.transitLabel}` : ''}
                            </p>
                          )}

                        </div>
                      </div>

                      {/* WHY THIS — full card width */}
                      <div className="flex flex-col md:flex-row gap-3 md:gap-8 pt-5 pb-5 mt-5 md:mt-0 border-t border-stone-200 border-b border-stone-200">
                        <span
                          className="shrink-0 text-[10px] font-medium uppercase text-[#C9683A] pt-0.5"
                          style={{ letterSpacing: '0.15em', minWidth: '96px' }}
                        >
                          Why This
                        </span>
                        <p
                          className="text-sm text-[#3D3830] leading-relaxed italic"
                          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                        >
                          {place.whyItMadeTheCut}
                        </p>
                      </div>

                    </div>
                  ))}
                </div>

              </section>
            )
          })
        })()}

        {/* CTA */}
        <div className="text-center pt-20 pb-8">
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
