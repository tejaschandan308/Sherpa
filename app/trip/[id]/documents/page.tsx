'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import SherpaNav from '../../../components/SherpaNav'
import { getBundle, saveBundle } from '../../../lib/store'
import {
  addDocument,
  removeDocument,
  setDocumentTarget,
  MAX_DOC_BYTES,
} from '../../../lib/documents'
import type { DayBlock, DayBlockKind, Leg, TripBundle } from '../../../lib/types'

// ============================================================================
// Documents shelf (Section 7, item 9) — upload, attach, resolve later
// ============================================================================
//
// A tagged file shelf: upload a file, attach it to a whole leg or one specific
// day-block (or leave it unattached and resolve it here later). Attaching sets
// the lock automatically — that logic lives in lib/documents.ts, this screen
// only drives it. NO parsing of file contents.

const BLOCK_LABEL: Record<DayBlockKind, string> = {
  arrival: 'Arrival',
  explore: 'Open day',
  day_trip: 'Day trip',
  open: 'Rest day',
}

interface TargetOption {
  value: string
  label: string
}

/** Builds the attach-target dropdown options: unattached, each leg, and each
 *  specific day-block under its leg. */
function targetOptions(legs: Leg[], dayBlocks: DayBlock[]): TargetOption[] {
  const opts: TargetOption[] = [{ value: 'none', label: 'Unattached' }]
  const ordered = [...legs].sort((a, b) => a.sequence_order - b.sequence_order)
  for (const leg of ordered) {
    opts.push({ value: `leg:${leg.id}`, label: `${leg.place} — whole stay` })
    const blocks = dayBlocks.filter((b) => b.leg_id === leg.id).sort((a, b) => a.order - b.order)
    blocks.forEach((b, i) => {
      const base = b.target ? `${BLOCK_LABEL[b.kind]} to ${b.target}` : BLOCK_LABEL[b.kind]
      opts.push({ value: `block:${b.id}`, label: `${leg.place} · ${base} (day ${i + 1})` })
    })
  }
  return opts
}

/** Current dropdown value for a document, from its attachment. */
function valueForDoc(doc: { leg_id: string | null; day_block_id: string | null }): string {
  if (doc.day_block_id) return `block:${doc.day_block_id}`
  if (doc.leg_id) return `leg:${doc.leg_id}`
  return 'none'
}

/** Parses a dropdown value back into a document target. */
function targetFromValue(value: string): { leg_id?: string | null; day_block_id?: string | null } {
  if (value.startsWith('leg:')) return { leg_id: value.slice(4), day_block_id: null }
  if (value.startsWith('block:')) return { day_block_id: value.slice(6), leg_id: null }
  return { leg_id: null, day_block_id: null }
}

export default function DocumentsPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [bundle, setBundle] = useState<TripBundle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function persist(next: TripBundle) {
    setBundle(next)
    saveBundle(next)
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !bundle) return
    setError(null)

    Array.from(files).forEach((file) => {
      if (file.size > MAX_DOC_BYTES) {
        setError(`"${file.name}" is too large (max ${Math.round(MAX_DOC_BYTES / 1000)} KB in v1).`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const ref = typeof reader.result === 'string' ? reader.result : ''
        if (!ref) return
        // Read the freshest bundle each time so multiple files don't clobber.
        const current = getBundle(id) ?? bundle
        persist(addDocument(current, { filename: file.name, ref }))
      }
      reader.readAsDataURL(file)
    })

    // Reset the input so re-selecting the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const options = targetOptions(bundle.legs, bundle.day_blocks)
  const docs = [...bundle.documents].sort((a, b) => b.uploaded_at - a.uploaded_at)

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      <SherpaNav />

      <main className="max-w-2xl mx-auto px-6 pb-24">
        <div className="pt-12 pb-8">
          <Link
            href={`/trip/${id}`}
            className="text-[11px] font-medium uppercase text-[#9A9087] hover:text-[#1A1A1A] transition"
            style={{ letterSpacing: '0.12em' }}
          >
            ← {bundle.trip.destination}
          </Link>
          <h1
            className="mt-4 text-3xl md:text-4xl text-[#1A1A1A] italic leading-tight"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 300 }}
          >
            Documents.
          </h1>
          <p className="mt-3 text-[#6B6B6B]">
            Bookings and tickets. Attach one to a stay or a specific day and it’s marked booked —
            Sherpa stores the file, it doesn’t read it.
          </p>
        </div>

        {/* Upload */}
        <div className="border-y border-stone-200 py-6">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="block w-full text-sm text-[#5A554E] file:mr-4 file:rounded-lg file:border-0 file:bg-[#B07242] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#8F5B2D] file:transition"
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        {/* List */}
        {docs.length === 0 ? (
          <p
            className="py-16 italic text-[1.25rem] text-[#9A9087]"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 300 }}
          >
            Nothing on the shelf yet.
          </p>
        ) : (
          <div>
            {docs.map((doc) => {
              const attached = Boolean(doc.leg_id || doc.day_block_id)
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 py-5 border-b border-stone-200"
                >
                  <div className="flex-1 min-w-0">
                    <a
                      href={doc.ref}
                      download={doc.filename}
                      className="block truncate text-[#1A1A1A] hover:text-[#8F5B2D] transition"
                      title={doc.filename}
                    >
                      {doc.filename}
                    </a>
                    <p
                      className="mt-1 text-[9px] font-medium uppercase"
                      style={{
                        letterSpacing: '0.15em',
                        color: attached ? '#5A6B52' : '#B0A89C',
                      }}
                    >
                      {attached ? 'Booked' : 'On the shelf — not attached'}
                    </p>
                  </div>

                  <select
                    value={valueForDoc(doc)}
                    onChange={(e) => persist(setDocumentTarget(bundle, doc.id, targetFromValue(e.target.value)))}
                    className="shrink-0 max-w-[55%] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-[#3D3830] focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
                  >
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => persist(removeDocument(bundle, doc.id))}
                    aria-label="Delete document"
                    className="shrink-0 text-[#C0B8B0] hover:text-[#1A1A1A] transition-colors"
                  >
                    <X size={14} strokeWidth={1.5} />
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
