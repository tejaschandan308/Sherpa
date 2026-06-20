'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import SherpaNav from '../../components/SherpaNav'
import { getBundle } from '../../lib/store'
import type { DayBlock, DayBlockKind, Leg, TransitEdge, TripBundle } from '../../lib/types'

// Rendered ENTIRELY from Leg/DayBlock data — never a separate generative pass.
// The restraint is the feature: no clock times, no specific restaurant picks.

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

function TransitRow({ edge }: { edge: TransitEdge }) {
  return (
    <div className="flex items-center gap-3 py-4 pl-1">
      <div className="w-px h-8 bg-stone-300 ml-3" />
      <p className="text-[11px] font-medium uppercase text-[#9A9087]" style={{ letterSpacing: '0.12em' }}>
        {edge.mode} · {formatMins(edge.duration_minutes) || '—'} to {edge.to_place}
      </p>
    </div>
  )
}

function DayBlockRow({ block }: { block: DayBlock }) {
  const isRest = block.kind === 'open'
  return (
    <div className="flex gap-4 py-3">
      <div className="shrink-0 w-20">
        <span
          className={`text-[10px] font-medium uppercase ${isRest ? 'text-[#C9683A]' : 'text-[#B0A89C]'}`}
          style={{ letterSpacing: '0.12em' }}
        >
          {BLOCK_LABEL[block.kind]}
        </span>
      </div>
      <div className="flex-1">
        {block.target && (
          <p className="text-[#1A1A1A] font-medium">{block.target}</p>
        )}
        {block.caption && (
          <p className="text-sm text-[#6B6B6B] leading-relaxed">{block.caption}</p>
        )}
      </div>
    </div>
  )
}

function LegSection({ leg, blocks, index }: { leg: Leg; blocks: DayBlock[]; index: number }) {
  return (
    <section>
      <div className="flex items-baseline justify-between pt-10 pb-3 border-b border-stone-200">
        <h2
          className="text-[#1A1A1A] italic leading-none"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 'clamp(2rem, 5vw, 2.75rem)', fontWeight: 300 }}
        >
          {leg.place}
        </h2>
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
        {blocks
          .sort((a, b) => a.order - b.order)
          .map((b) => (
            <DayBlockRow key={b.id} block={b} />
          ))}
      </div>
      {/* index reserved for future numbering */}
      <span className="hidden">{index}</span>
    </section>
  )
}

export default function SkeletonPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [bundle, setBundle] = useState<TripBundle | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const b = getBundle(id)
    if (!b) {
      router.replace('/')
      return
    }
    setBundle(b)
    setLoaded(true)
  }, [id, router])

  if (!loaded || !bundle) return <div className="min-h-screen bg-[#FAFAF7]" />

  const legs = [...bundle.legs].sort((a, b) => a.sequence_order - b.sequence_order)
  const edgeFor = (from: string) => bundle.edges.find((e) => e.from_place === from)

  return (
    <div className="min-h-screen bg-[#FAFAF7] animate-fade-in-up">
      <SherpaNav />

      <div className="max-w-2xl mx-auto px-6 pb-24">
        <div className="pt-12 pb-2">
          <p className="text-[10px] font-medium uppercase text-[#B0A89C] mb-3" style={{ letterSpacing: '0.2em' }}>
            The shape of it
          </p>
          <h1
            className="text-4xl md:text-5xl text-[#1A1A1A] italic leading-tight"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 300 }}
          >
            {bundle.trip.destination}.
          </h1>
          <p className="mt-3 text-[#6B6B6B]">
            {bundle.trip.days_total} days · {legs.length} {legs.length === 1 ? 'base' : 'bases'} ·
            a skeleton, not a schedule.
          </p>
        </div>

        {legs.length === 0 ? (
          <p className="mt-10 text-[#9A9087]">No skeleton yet — confirm your decisions first.</p>
        ) : (
          <div>
            {legs.map((leg, i) => {
              const blocks = bundle.day_blocks.filter((b) => b.leg_id === leg.id)
              const edge = edgeFor(leg.place)
              return (
                <div key={leg.id}>
                  <LegSection leg={leg} blocks={blocks} index={i} />
                  {edge && <TransitRow edge={edge} />}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-12 flex gap-3">
          <button
            onClick={() => router.push(`/trip/${id}/decisions`)}
            className="text-sm text-[#3D3830] underline underline-offset-2 hover:text-[#1A1A1A]"
          >
            Revisit the calls
          </button>
        </div>
      </div>
    </div>
  )
}
