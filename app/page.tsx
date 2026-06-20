'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { buildDemoBundle, DEMO_TRIP_ID } from './lib/demoTrip'
import { saveBundle } from './lib/store'
import { writePlanning } from './lib/planning'
import { checkDestination } from './lib/placeTiers'

// A real, static example of Sherpa's core output: a stance with the rejected
// alternative crossed out, plus the honest tradeoff. NOT a generic illustration
// — the hero IS the product.
function ExampleDecisionCard() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <p
        className="text-[10px] font-medium uppercase text-[#B0A89C] mb-3"
        style={{ letterSpacing: '0.2em' }}
      >
        The call
      </p>
      <h3
        className="text-[#1A1A1A] text-2xl leading-snug mb-4"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        Split Lisbon &amp; Porto.{' '}
        <span className="text-[#B0A89C] line-through decoration-1">
          Day-trip Porto from Lisbon.
        </span>
      </h3>
      <div className="flex gap-3 border-t border-stone-200 pt-4">
        <span
          className="shrink-0 text-[10px] font-medium uppercase text-[#C9683A] pt-0.5"
          style={{ letterSpacing: '0.15em', minWidth: '78px' }}
        >
          Tradeoff
        </span>
        <p className="text-sm text-[#5A554E] leading-relaxed">
          Costs one hotel switch and a travel day. But day-tripping Porto means
          ~6 hours of train for half a day on the ground.
        </p>
      </div>
    </div>
  )
}

export default function Home() {
  const router = useRouter()
  const [destination, setDestination] = useState('')
  const [destError, setDestError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const dest = destination.trim()
    if (!dest) return

    // Catch a vague/unrecognized destination here so the user gets feedback
    // immediately instead of after the dates step (Section 7 edge state).
    const check = checkDestination(dest)
    if (check.status === 'too_broad') {
      setDestError(`“${dest}” is a bit broad — try a country or region. For v0 that’s Portugal.`)
      return
    }
    if (check.status === 'component_place') {
      setDestError(
        `${check.place} is part of a ${check.region} trip, not a destination on its own — try “${check.region}” and we’ll help you decide how much time it deserves.`
      )
      return
    }
    if (check.status === 'unrecognized') {
      setDestError(`We don’t have a confident read on “${dest}” yet. Right now that’s Portugal.`)
      return
    }

    setDestError(null)
    writePlanning({ destination: dest })
    router.push('/dates')
  }

  function openExample() {
    // Seed the Portugal demo and jump straight to its decisions.
    saveBundle(buildDemoBundle())
    router.push(`/trip/${DEMO_TRIP_ID}/decisions`)
  }

  return (
    <main className="min-h-screen bg-[#FAFAF7]">
      {/* Editorial header strip */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-stone-200">
        <span
          className="text-sm text-[#1A1A1A] italic"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Sherpa
        </span>
        <Link
          href="/trips"
          className="text-[10px] font-medium text-[#9A9087] uppercase hover:text-[#1A1A1A] transition-colors"
          style={{ letterSpacing: '0.18em' }}
        >
          My Trips
        </Link>
      </div>

      <section className="max-w-5xl mx-auto px-8 pt-16 pb-20 grid md:grid-cols-2 gap-14 items-center">
        {/* Left: pitch + input */}
        <div>
          <h1 className="text-4xl md:text-5xl text-[#1A1A1A] leading-[1.1] font-bold">
            The few calls that
            <br />
            actually shape a trip.
          </h1>
          <p className="mt-5 text-lg text-[#6B6B6B] leading-relaxed max-w-md">
            Not a list of places. Sherpa surfaces what to cut, what to split,
            what to skip — each with the honest tradeoff — then lays out the days.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-3">
            <label htmlFor="destination" className="block text-sm font-medium text-[#3D3830]">
              Where are you going?
            </label>
            <div className="flex gap-2">
              <input
                id="destination"
                type="text"
                placeholder="e.g., Portugal"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value)
                  if (destError) setDestError(null)
                }}
                className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-[#1A1A1A] placeholder:text-stone-400 bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-transparent transition"
              />
              <button
                type="submit"
                className="bg-[#B07242] text-white font-medium px-5 py-2.5 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] transition"
              >
                Start
              </button>
            </div>
            {destError && (
              <p className="text-sm text-[#8F5B2D]">{destError}</p>
            )}
            <button
              type="button"
              onClick={openExample}
              className="text-[11px] font-medium uppercase hover:opacity-70 transition-opacity"
              style={{ letterSpacing: '0.15em', color: '#C9683A' }}
            >
              Or walk through the Portugal example →
            </button>
          </form>
        </div>

        {/* Right: the real example card */}
        <div className="md:pl-4">
          <ExampleDecisionCard />
        </div>
      </section>
    </main>
  )
}
