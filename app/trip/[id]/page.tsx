'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import SherpaNav from '../../components/SherpaNav'
import { getBundle } from '../../lib/store'
import { documentsForBlock, documentsForLeg } from '../../lib/documents'
import { buildShareUrl } from '../../lib/share'
import type {
  DayBlock,
  DayBlockKind,
  Leg,
  TransitEdge,
  TripBundle,
  TripDocument,
} from '../../lib/types'

// A small "booked" marker — shown wherever a document attachment has locked a
// leg or day-block.
function BookedTag() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-medium uppercase text-[#5A6B52]"
      style={{ letterSpacing: '0.12em' }}
    >
      <Lock size={9} strokeWidth={2} /> Booked
    </span>
  )
}

// Filenames attached to a leg/block, rendered small beneath it.
function AttachedDocs({ docs }: { docs: TripDocument[] }) {
  if (docs.length === 0) return null
  return (
    <p className="text-xs text-[#9A9087] mt-1">
      {docs.map((d) => d.filename).join(' · ')}
    </p>
  )
}

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

function DayBlockRow({ block, docs }: { block: DayBlock; docs: TripDocument[] }) {
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
        <div className="flex items-center justify-between gap-3">
          {block.target ? (
            <p className="text-[#1A1A1A] font-medium">{block.target}</p>
          ) : (
            <span />
          )}
          {block.locked && <BookedTag />}
        </div>
        {block.caption && (
          <p className="text-sm text-[#6B6B6B] leading-relaxed">{block.caption}</p>
        )}
        <AttachedDocs docs={docs} />
      </div>
    </div>
  )
}

function LegSection({
  leg,
  blocks,
  index,
  bundle,
}: {
  leg: Leg
  blocks: DayBlock[]
  index: number
  bundle: TripBundle
}) {
  const legDocs = documentsForLeg(bundle, leg.id)
  return (
    <section>
      <div className="flex items-baseline justify-between pt-10 pb-3 border-b border-stone-200">
        <h2
          className="text-[#1A1A1A] italic leading-none"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 'clamp(2rem, 5vw, 2.75rem)', fontWeight: 300 }}
        >
          {leg.place}
        </h2>
        <span className="flex items-center gap-3 text-[10px] font-medium uppercase text-[#9A9087]" style={{ letterSpacing: '0.12em' }}>
          {leg.locked && <BookedTag />}
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

      <AttachedDocs docs={legDocs} />

      <div className="mt-3 divide-y divide-stone-100">
        {blocks
          .sort((a, b) => a.order - b.order)
          .map((b) => (
            <DayBlockRow key={b.id} block={b} docs={documentsForBlock(bundle, b.id)} />
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
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const b = getBundle(id)
    if (!b) {
      router.replace('/')
      return
    }
    setBundle(b)
    setLoaded(true)
  }, [id, router])

  // Build a read-only share link (trip encoded in the URL hash) and copy it.
  function share() {
    if (!bundle) return
    const url = buildShareUrl(bundle)
    setShareUrl(url)
    setCopied(false)
    navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied(true))
      .catch(() => {})
  }

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
                  <LegSection leg={leg} blocks={blocks} index={i} bundle={bundle} />
                  {edge && <TransitRow edge={edge} />}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-12 flex gap-5 items-center">
          <button
            onClick={() => router.push(`/trip/${id}/decisions`)}
            className="text-sm text-[#3D3830] underline underline-offset-2 hover:text-[#1A1A1A]"
          >
            Revisit the calls
          </button>
          <Link
            href={`/trip/${id}/documents`}
            className="text-sm text-[#3D3830] underline underline-offset-2 hover:text-[#1A1A1A]"
          >
            Documents{bundle.documents.length > 0 ? ` (${bundle.documents.length})` : ''}
          </Link>
          <button
            onClick={share}
            className="text-sm text-[#3D3830] underline underline-offset-2 hover:text-[#1A1A1A]"
          >
            Share
          </button>
        </div>

        {shareUrl && (
          <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
            <p className="text-[10px] font-medium uppercase text-[#9A9087] mb-2" style={{ letterSpacing: '0.12em' }}>
              {copied ? 'Link copied' : 'Read-only share link'}
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 rounded-md border border-stone-300 bg-[#FAFAF7] px-3 py-2 text-sm text-[#5A554E] focus:outline-none"
              />
              <button
                onClick={share}
                className="shrink-0 rounded-md bg-[#B07242] px-4 py-2 text-sm font-medium text-white hover:bg-[#8F5B2D] transition"
              >
                Copy
              </button>
            </div>
            <p className="mt-2 text-xs text-[#9A9087] leading-relaxed">
              Anyone with this link can view the trip (not edit it). Your booking files aren’t included.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
