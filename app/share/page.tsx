'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveBundle } from '../lib/store'
import { decodeShare, forkBundle, type SharePayload } from '../lib/share'
import type { Confidence, DayBlock, DayBlockKind, DecisionType } from '../lib/types'

// ============================================================================
// Shared trip — READ-ONLY companion view (Section 7, item 10)
// ============================================================================
//
// Decodes a trip from the URL hash. No editing, no swipe quiz, no decision
// revisiting — the only write action is "copy to my trips", which forks an
// independent trip into the viewer's own storage. Reasoning/tradeoff is present
// but COLLAPSED by default; the headline (the call itself) leads.

const ORDER: DecisionType[] = ['base_city', 'region_cut', 'splurge_or_skip', 'pace']

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'Clear call',
  close_call: 'Close call',
  worth_a_gut_check: 'Worth a gut check',
}

const BLOCK_LABEL: Record<DayBlockKind, string> = {
  arrival: 'Arrive',
  explore: 'Open day',
  day_trip: 'Day trip',
  open: 'Rest day',
}

function formatMins(mins: number): string {
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

function WhyThis({ reasoning, tradeoff }: { reasoning: string; tradeoff: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] font-medium uppercase text-[#C9683A] hover:text-[#8F5B2D] transition"
        style={{ letterSpacing: '0.12em' }}
      >
        {open ? 'Hide reasoning' : 'Why this →'}
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-[#5A554E] leading-relaxed mb-3">{reasoning}</p>
          <div className="flex gap-3 border-t border-stone-200 pt-3">
            <span
              className="shrink-0 text-[10px] font-medium uppercase text-[#C9683A] pt-0.5"
              style={{ letterSpacing: '0.15em', minWidth: '70px' }}
            >
              Tradeoff
            </span>
            <p className="text-sm text-[#5A554E] leading-relaxed">{tradeoff}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SharePage() {
  const router = useRouter()
  const [payload, setPayload] = useState<SharePayload | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    setPayload(hash ? decodeShare(hash) : null)
    setLoaded(true)
  }, [])

  function copyToMyTrips() {
    if (!payload) return
    const bundle = forkBundle(payload)
    saveBundle(bundle)
    router.push(`/trip/${bundle.trip.id}`)
  }

  if (!loaded) return <div className="min-h-screen bg-[#FAFAF7]" />

  // Malformed or missing link.
  if (!payload) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
        <div className="px-6 py-3 border-b border-stone-200">
          <Link href="/">
            <span className="text-sm text-[#1A1A1A] italic" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              Sherpa
            </span>
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center space-y-5">
            <h1
              className="text-3xl text-[#1A1A1A] italic leading-snug"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              This share link didn’t open.
            </h1>
            <p className="text-[#6B6B6B] leading-relaxed">
              It may be incomplete or out of date. Ask whoever shared it to send a fresh link.
            </p>
            <Link
              href="/"
              className="inline-block text-[11px] font-medium uppercase hover:opacity-70 transition-opacity"
              style={{ letterSpacing: '0.15em', color: '#C9683A' }}
            >
              Plan your own trip →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { trip } = payload
  const decisions = [...payload.decisions].sort(
    (a, b) => ORDER.indexOf(a.decision_type) - ORDER.indexOf(b.decision_type)
  )
  const legs = [...payload.legs].sort((a, b) => a.sequence_order - b.sequence_order)
  const edgeFor = (from: string) => payload.edges.find((e) => e.from_place === from)

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      {/* Minimal header — no app nav for a read-only viewer */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-stone-200">
        <Link href="/">
          <span className="text-sm text-[#1A1A1A] italic" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
            Sherpa
          </span>
        </Link>
        <span
          className="text-[10px] font-medium uppercase text-[#B0A89C]"
          style={{ letterSpacing: '0.18em' }}
        >
          Shared · read-only
        </span>
      </div>

      <div className="max-w-2xl mx-auto px-6 pb-24">
        <div className="pt-12 pb-2">
          <p className="text-[10px] font-medium uppercase text-[#B0A89C] mb-3" style={{ letterSpacing: '0.2em' }}>
            A trip someone shared with you
          </p>
          <h1
            className="text-4xl md:text-5xl text-[#1A1A1A] italic leading-tight"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 300 }}
          >
            {trip.destination}.
          </h1>
          <p className="mt-3 text-[#6B6B6B]">
            {trip.days_total} days · {legs.length} {legs.length === 1 ? 'base' : 'bases'}
          </p>
        </div>

        {/* Copy-to-my-trips: the only write action */}
        <div className="mt-6 flex flex-wrap items-center gap-4 border-y border-stone-200 py-5">
          <button
            onClick={copyToMyTrips}
            className="bg-[#B07242] text-white font-medium px-6 py-2.5 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] transition"
          >
            Copy to my trips
          </button>
          <p className="text-sm text-[#9A9087]">
            Makes your own editable copy — it won’t change theirs.
          </p>
        </div>

        {/* The calls */}
        <section className="mt-10">
          <h2
            className="text-[10px] font-medium uppercase text-[#9A9087] mb-4"
            style={{ letterSpacing: '0.18em' }}
          >
            The calls
          </h2>
          <div className="space-y-5">
            {decisions.map((d) => (
              <div key={d.id} className="rounded-xl border border-stone-200 bg-white p-6">
                <div className="flex items-start justify-between gap-4">
                  <h3
                    className="text-[#1A1A1A] text-xl leading-snug"
                    style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                  >
                    {d.headline}
                  </h3>
                  <span
                    className={`shrink-0 mt-1 text-[9px] font-medium uppercase px-2 py-1 rounded-full ${
                      d.confidence === 'high'
                        ? 'bg-[#E8EDE6] text-[#5A6B52]'
                        : d.confidence === 'close_call'
                          ? 'bg-[#F2E9DF] text-[#8F5B2D]'
                          : 'bg-stone-100 text-[#9A9087]'
                    }`}
                    style={{ letterSpacing: '0.1em' }}
                  >
                    {CONFIDENCE_LABEL[d.confidence]}
                  </span>
                </div>
                <WhyThis reasoning={d.reasoning} tradeoff={d.tradeoff} />
              </div>
            ))}
          </div>
        </section>

        {/* The skeleton */}
        <section className="mt-12">
          <h2
            className="text-[10px] font-medium uppercase text-[#9A9087]"
            style={{ letterSpacing: '0.18em' }}
          >
            The shape of it
          </h2>
          {legs.map((leg) => {
            const blocks = payload.day_blocks
              .filter((b: DayBlock) => b.leg_id === leg.id)
              .sort((a: DayBlock, b: DayBlock) => a.order - b.order)
            const edge = edgeFor(leg.place)
            return (
              <div key={leg.id}>
                <div className="flex items-baseline justify-between pt-10 pb-3 border-b border-stone-200">
                  <h3
                    className="text-[#1A1A1A] italic leading-none"
                    style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 'clamp(2rem, 5vw, 2.75rem)', fontWeight: 300 }}
                  >
                    {leg.place}
                  </h3>
                  <span className="text-[10px] font-medium uppercase text-[#9A9087]" style={{ letterSpacing: '0.12em' }}>
                    {leg.nights} {leg.nights === 1 ? 'night' : 'nights'} · {leg.role}
                  </span>
                </div>

                {leg.caption && (
                  <p
                    className="text-[#6B6B6B] text-sm leading-relaxed italic mt-4"
                    style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                  >
                    {leg.caption}
                  </p>
                )}

                <div className="mt-3 divide-y divide-stone-100">
                  {blocks.map((b: DayBlock) => (
                    <div key={b.id} className="flex gap-4 py-3">
                      <div className="shrink-0 w-20">
                        <span
                          className={`text-[10px] font-medium uppercase ${b.kind === 'open' ? 'text-[#C9683A]' : 'text-[#B0A89C]'}`}
                          style={{ letterSpacing: '0.12em' }}
                        >
                          {BLOCK_LABEL[b.kind]}
                        </span>
                      </div>
                      <div className="flex-1">
                        {b.target && <p className="text-[#1A1A1A] font-medium">{b.target}</p>}
                        {b.caption && <p className="text-sm text-[#6B6B6B] leading-relaxed">{b.caption}</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {edge && (
                  <div className="flex items-center gap-3 py-4 pl-1">
                    <div className="w-px h-8 bg-stone-300 ml-3" />
                    <p className="text-[11px] font-medium uppercase text-[#9A9087]" style={{ letterSpacing: '0.12em' }}>
                      {edge.mode} · {formatMins(edge.duration_minutes) || '—'} to {edge.to_place}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
