'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { getAllTrips, deleteTrip, type SavedTrip } from '../lib/trips'

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

function formatYear(iso: string): string {
  return iso.slice(0, 4)
}

export default function TripsPage() {
  const router = useRouter()
  const [trips, setTrips] = useState<SavedTrip[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setTrips(getAllTrips())
    setLoaded(true)
  }, [])

  function handleDelete(e: React.MouseEvent, id: number) {
    e.stopPropagation()
    deleteTrip(id)
    setTrips((prev) => prev.filter((t) => t.id !== id))
  }

  if (!loaded) {
    return <div className="min-h-screen bg-[#FAFAF7]" />
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7]">

      {/* Editorial header strip */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-stone-200">
        <Link href="/">
          <span
            className="text-sm text-[#1A1A1A] italic"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            Sherpa
          </span>
        </Link>
        <Link
          href="/"
          className="text-[10px] font-medium uppercase hover:opacity-70 transition-opacity"
          style={{ letterSpacing: '0.18em', color: '#C9683A' }}
        >
          Plan a trip →
        </Link>
      </div>

      <main className="max-w-2xl mx-auto px-6">

        {/* Page heading */}
        <div className="pt-12 pb-10">
          <p
            className="text-[9px] font-medium uppercase text-[#B0A89C] mb-3"
            style={{ letterSpacing: '0.2em' }}
          >
            Saved
          </p>
          <h1
            className="text-[#1A1A1A] italic leading-[1.1]"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 300,
              fontSize: 'clamp(3rem, 7vw, 4.5rem)',
            }}
          >
            Your trips.
          </h1>
          {trips.length > 0 && (
            <p
              className="text-[9px] font-medium uppercase text-[#9A9087] mt-4"
              style={{ letterSpacing: '0.15em' }}
            >
              {trips.length} saved
            </p>
          )}
        </div>

        {/* Empty state */}
        {trips.length === 0 ? (
          <div className="py-20 border-t border-stone-200">
            <p
              className="italic text-[1.5rem] text-[#9A9087] mb-6"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 300 }}
            >
              No trips yet.
            </p>
            <Link
              href="/"
              className="text-[10px] font-medium uppercase hover:opacity-70 transition-opacity"
              style={{ letterSpacing: '0.18em', color: '#C9683A' }}
            >
              Plan a trip →
            </Link>
          </div>
        ) : (
          <div className="border-t border-stone-200">
            {trips.map((trip) => {
              const photoUrl = trip.destinationHeroPhotoUrl ?? trip.places[0]?.photoUrl
              const styleLabel = trip.styleTags.map((t) => t.toUpperCase()).join(' · ')

              return (
                <div
                  key={trip.id}
                  onClick={() => router.push(`/results?tripId=${trip.id}`)}
                  className="relative flex gap-5 py-7 border-b border-stone-200 cursor-pointer group"
                >
                  {/* Photo */}
                  <div className="relative w-[28%] shrink-0 aspect-[4/3] rounded-sm overflow-hidden bg-stone-200">
                    {photoUrl && (
                      <Image
                        src={photoUrl}
                        alt={trip.destination}
                        fill
                        className="object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        sizes="200px"
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5 pr-6">
                    <div>
                      <h2
                        className="italic text-[#1A1A1A] leading-snug"
                        style={{
                          fontFamily: 'Georgia, "Times New Roman", serif',
                          fontSize: '1.375rem',
                          fontWeight: 300,
                        }}
                      >
                        {trip.destination}
                      </h2>
                      <p className="text-xs text-[#9A9087] mt-1.5">
                        {formatShortDate(trip.startDate)} – {formatShortDate(trip.endDate)}{' '}
                        {formatYear(trip.endDate)}
                      </p>
                    </div>

                    <div className="mt-4 space-y-1.5">
                      {styleLabel && (
                        <p
                          className="text-[9px] font-medium uppercase"
                          style={{ letterSpacing: '0.18em', color: '#C9683A' }}
                        >
                          {styleLabel}
                        </p>
                      )}
                      <p
                        className="text-[9px] font-medium uppercase text-[#B0A89C]"
                        style={{ letterSpacing: '0.15em' }}
                      >
                        {trip.places.length} place{trip.places.length !== 1 ? 's' : ''} curated
                      </p>
                    </div>
                  </div>

                  {/* Delete — bare X, no background */}
                  <button
                    onClick={(e) => handleDelete(e, trip.id)}
                    aria-label="Delete trip"
                    className="absolute top-7 right-0 text-[#C0B8B0] hover:text-[#1A1A1A] transition-colors"
                  >
                    <X size={13} strokeWidth={1.5} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

      </main>
    </div>
  )
}
