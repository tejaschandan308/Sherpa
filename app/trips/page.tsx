'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { getAllBundles, deleteBundle } from '../lib/store'
import type { TripBundle } from '../lib/types'

// ============================================================================
// My Trips dashboard (Section 7, item 7) — reads the NEW decision/leg model
// ============================================================================
//
// Cards report on the trip's *decision* progress and what's *booked*, not the
// old "N places curated" framing. Sorting by proximity to departure is handled
// in the store (getAllBundles), so this screen just renders what it's handed.

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

/** How many decisions the user has actually settled (confirmed or overridden)
 *  out of the total generated — the "4 of 4 decisions made" stat. */
function decisionProgress(b: TripBundle): { made: number; total: number } {
  const total = b.decisions.length
  const made = b.decisions.filter(
    (d) => d.status === 'confirmed' || d.status === 'overridden'
  ).length
  return { made, total }
}

/** Count of things marked booked — i.e. locked because a document is attached,
 *  to a whole leg or a specific day-block. (Locking lands with the documents
 *  feature; until then this reads 0, which is correct.) */
function bookedCount(b: TripBundle): number {
  return (
    b.legs.filter((l) => l.locked).length +
    b.day_blocks.filter((d) => d.locked).length
  )
}

/** Whole-day local diff from today to an ISO date (negative = in the past). */
function daysFromToday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** A short, human label for where the trip sits relative to now — drives the
 *  same ordering the store sorts by, surfaced on the card. */
function departureLabel(b: TripBundle): string {
  const toStart = daysFromToday(b.trip.start_date)
  if (toStart > 1) return `In ${toStart} days`
  if (toStart === 1) return 'Tomorrow'
  if (toStart === 0) return 'Departs today'
  // Already started — is it still running, or done?
  return daysFromToday(b.trip.end_date) >= 0 ? 'In progress' : 'Past trip'
}

export default function TripsPage() {
  const router = useRouter()
  const [bundles, setBundles] = useState<TripBundle[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setBundles(getAllBundles())
    setLoaded(true)
  }, [])

  function handleDelete(e: React.MouseEvent, tripId: string) {
    e.stopPropagation()
    deleteBundle(tripId)
    setBundles((prev) => prev.filter((b) => b.trip.id !== tripId))
  }

  // Continue where the trip left off: into the skeleton if it's been built,
  // otherwise back to the decisions screen to finish/build it.
  function openTrip(b: TripBundle) {
    router.push(b.legs.length > 0 ? `/trip/${b.trip.id}` : `/trip/${b.trip.id}/decisions`)
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
          {bundles.length > 0 && (
            <p
              className="text-[9px] font-medium uppercase text-[#9A9087] mt-4"
              style={{ letterSpacing: '0.15em' }}
            >
              {bundles.length} saved
            </p>
          )}
        </div>

        {/* Empty state */}
        {bundles.length === 0 ? (
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
            {bundles.map((b) => {
              const { made, total } = decisionProgress(b)
              const booked = bookedCount(b)
              const complete = total > 0 && made === total

              return (
                <div
                  key={b.trip.id}
                  onClick={() => openTrip(b)}
                  className="relative py-7 border-b border-stone-200 cursor-pointer group pr-8"
                >
                  {/* Top line: destination + where it sits relative to now */}
                  <div className="flex items-baseline justify-between gap-4">
                    <h2
                      className="italic text-[#1A1A1A] leading-snug group-hover:text-[#8F5B2D] transition-colors"
                      style={{
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: '1.5rem',
                        fontWeight: 300,
                      }}
                    >
                      {b.trip.destination}
                    </h2>
                    <span
                      className="shrink-0 text-[9px] font-medium uppercase text-[#B0A89C]"
                      style={{ letterSpacing: '0.15em' }}
                    >
                      {departureLabel(b)}
                    </span>
                  </div>

                  <p className="text-xs text-[#9A9087] mt-1.5">
                    {formatShortDate(b.trip.start_date)} – {formatShortDate(b.trip.end_date)}{' '}
                    {b.trip.end_date.slice(0, 4)} · {b.trip.days_total} days
                  </p>

                  {/* Stats row: decision completion + booked count */}
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span
                      className={`text-[9px] font-medium uppercase ${
                        complete ? 'text-[#5A6B52]' : 'text-[#C9683A]'
                      }`}
                      style={{ letterSpacing: '0.15em' }}
                    >
                      {total === 0
                        ? 'No decisions yet'
                        : `${made} of ${total} decision${total === 1 ? '' : 's'} made`}
                    </span>
                    <span className="text-[#D8D2C8] text-[9px]">·</span>
                    <span
                      className="text-[9px] font-medium uppercase text-[#B0A89C]"
                      style={{ letterSpacing: '0.15em' }}
                    >
                      {booked > 0 ? `${booked} booked` : 'Nothing booked yet'}
                    </span>
                  </div>

                  {/* Delete — bare X, no background */}
                  <button
                    onClick={(e) => handleDelete(e, b.trip.id)}
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
