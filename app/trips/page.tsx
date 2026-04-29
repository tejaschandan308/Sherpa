'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import SherpaNav from '../components/SherpaNav'
import { getAllTrips, deleteTrip, type SavedTrip } from '../lib/trips'

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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
      <SherpaNav />

      <main className="max-w-2xl mx-auto px-6 py-10">

        {/* Page header */}
        <div className="space-y-1 mb-10">
          <p className="text-xs font-semibold text-[#9A9087] tracking-widest uppercase">Saved</p>
          <h1 className="text-3xl font-bold tracking-tight text-[#1A1A1A]">
            Your trips
            {trips.length > 0 && (
              <span className="ml-2 text-2xl font-normal text-[#9A9087]">({trips.length})</span>
            )}
          </h1>
        </div>

        {/* Empty state */}
        {trips.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <p className="text-[#6B6B6B]">No trips yet. Plan your first trip to get started.</p>
            <Link
              href="/"
              className="inline-block bg-[#B07242] text-white font-medium px-6 py-2.5 rounded-lg hover:bg-[#8F5B2D] transition text-sm"
            >
              Plan a trip
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {trips.map((trip) => {
              const heroPhoto = trip.places[0]?.photoUrl
              return (
                <div
                  key={trip.id}
                  onClick={() => router.push(`/results?tripId=${trip.id}`)}
                  className="relative bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
                >
                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(e, trip.id)}
                    aria-label="Delete trip"
                    className="absolute top-3 right-3 z-10 p-1.5 bg-white/80 backdrop-blur-sm rounded-full text-[#9A9087] hover:text-[#1A1A1A] hover:bg-white transition shadow-sm"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>

                  <div className="flex">
                    {/* Hero image */}
                    {heroPhoto ? (
                      <div className="relative w-36 shrink-0">
                        <Image
                          src={heroPhoto}
                          alt={trip.destination}
                          fill
                          className="object-cover"
                          sizes="144px"
                        />
                      </div>
                    ) : (
                      <div className="w-36 shrink-0 bg-stone-100" />
                    )}

                    {/* Card content */}
                    <div className="flex-1 p-5 space-y-2.5 min-w-0">
                      <div>
                        <h2 className="text-lg font-bold text-[#1A1A1A] leading-snug truncate pr-6">
                          {trip.destination}
                        </h2>
                        <p className="text-xs text-[#9A9087] mt-0.5">
                          {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
                        </p>
                      </div>

                      {trip.styleTags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {trip.styleTags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] bg-stone-100 text-[#6B6B6B] px-2 py-0.5 rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="text-xs text-[#9A9087]">
                        {trip.places.length} place{trip.places.length !== 1 ? 's' : ''} curated
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
