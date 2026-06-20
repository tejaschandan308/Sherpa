'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import SherpaNav from '../../../components/SherpaNav'
import { getBundle, saveBundle } from '../../../lib/store'
import { DEMO_DECISION_QUESTIONS } from '../../../lib/demoTrip'
import type { Confidence, Decision, DecisionType, TripBundle } from '../../../lib/types'

// The order decisions are asked in (base city first — it gates the rest).
const ORDER: DecisionType[] = ['base_city', 'region_cut', 'splurge_or_skip', 'pace']

// The two opposing leanings offered during the "ask first" step. The middle
// option (e.g. pace=standard) isn't offered as a lean — Sherpa can still land
// there, but the user is asked to pick a side.
const OPTIONS: Record<DecisionType, { stance: string; label: string }[]> = {
  base_city: [
    { stance: 'split', label: 'Split my time between cities' },
    { stance: 'single', label: 'Base in one city' },
  ],
  region_cut: [
    { stance: 'cut_algarve', label: 'Keep the north, drop the Algarve' },
    { stance: 'cut_porto', label: 'Keep the coast, drop Porto' },
  ],
  splurge_or_skip: [
    { stance: 'add', label: 'Add the Douro day-trip' },
    { stance: 'skip', label: 'Skip the Douro' },
  ],
  pace: [
    { stance: 'relaxed', label: 'Leave room to breathe' },
    { stance: 'packed', label: 'Pack it in' },
  ],
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'Clear call',
  close_call: 'Close call',
  worth_a_gut_check: 'Worth a gut check',
}

function stanceLabel(type: DecisionType, stance: string): string {
  return OPTIONS[type].find((o) => o.stance === stance)?.label ?? stance
}

type Phase = 'asking' | 'revealed'

export default function DecisionsPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [bundle, setBundle] = useState<TripBundle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<Record<string, Phase>>({})
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [building, setBuilding] = useState(false)

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

  const decisions = [...bundle.decisions].sort(
    (a, b) => ORDER.indexOf(a.decision_type) - ORDER.indexOf(b.decision_type)
  )

  function reveal(decision: Decision, pickedStance: string) {
    setPicks((p) => ({ ...p, [decision.id]: pickedStance }))
    setPhase((p) => ({ ...p, [decision.id]: 'revealed' }))
  }

  function settle(decision: Decision, finalStance: string) {
    // Confirm = accept Sherpa's stance; override = keep the user's pick.
    const status = finalStance === decision.stance ? 'confirmed' : 'overridden'
    const updated: TripBundle = {
      ...bundle!,
      decisions: bundle!.decisions.map((d) =>
        d.id === decision.id
          ? { ...d, stance: finalStance as Decision['stance'], status, user_answer: picks[decision.id], updated_at: Date.now() }
          : d
      ),
    }
    setBundle(updated)
    saveBundle(updated)
  }

  const allSettled = decisions.every((d) => d.status === 'confirmed' || d.status === 'overridden')

  async function buildSkeleton() {
    if (!bundle) return
    // Demo (or already-built) bundle has legs — just go.
    if (bundle.legs.length > 0) {
      router.push(`/trip/${id}`)
      return
    }
    setBuilding(true)
    const confirmed: Partial<Record<DecisionType, string>> = {}
    for (const d of bundle.decisions) confirmed[d.decision_type] = d.stance

    try {
      const res = await fetch('/api/plan/legs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: bundle.trip.id,
          destination: bundle.trip.destination,
          days_total: bundle.trip.days_total,
          decisions: confirmed,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      const updated: TripBundle = { ...bundle, legs: data.legs, edges: data.edges, day_blocks: data.dayBlocks }
      saveBundle(updated)
      router.push(`/trip/${id}`)
    } catch {
      setBuilding(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      <SherpaNav />

      <div className="max-w-2xl mx-auto px-6 pb-24">
        <div className="pt-12 pb-8">
          <p className="text-[10px] font-medium uppercase text-[#B0A89C] mb-3" style={{ letterSpacing: '0.2em' }}>
            {bundle.trip.destination} · {bundle.trip.days_total} days
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] leading-tight">
            The calls that shape this trip.
          </h1>
          <p className="mt-3 text-[#6B6B6B]">A few at a time. Tell me how you’re leaning first.</p>
        </div>

        <div className="space-y-6">
          {decisions.map((d) => {
            const p: Phase = phase[d.id] ?? 'asking'
            const settled = d.status === 'confirmed' || d.status === 'overridden'
            const userPick = picks[d.id]
            const agreed = userPick === d.stance

            return (
              <div key={d.id} className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                {/* ASK FIRST: the question + the user's leaning, before any verdict */}
                <div className="p-6">
                  <p
                    className="text-[#1A1A1A] text-xl leading-snug"
                    style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                  >
                    {DEMO_DECISION_QUESTIONS[d.decision_type] ?? d.headline}
                  </p>

                  {p === 'asking' && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {OPTIONS[d.decision_type].map((o) => (
                        <button
                          key={o.stance}
                          onClick={() => reveal(d, o.stance)}
                          className="px-4 py-2 rounded-full text-sm border border-stone-300 bg-white text-[#4A4540] hover:border-[#B07242] hover:text-[#1A1A1A] transition"
                        >
                          {o.label}
                        </button>
                      ))}
                      <button
                        onClick={() => reveal(d, '')}
                        className="px-4 py-2 rounded-full text-sm text-[#9A9087] hover:text-[#1A1A1A] transition"
                      >
                        Not sure — what do you think?
                      </button>
                    </div>
                  )}
                </div>

                {/* REVEAL: Sherpa's stance framed as a response to what they said */}
                {p === 'revealed' && (
                  <div className="border-t border-stone-200 bg-[#FCFBF8] p-6">
                    {userPick && (
                      <p className="text-sm text-[#9A9087] mb-3">
                        You leaned toward <span className="text-[#5A554E]">{stanceLabel(d.decision_type, userPick)}</span>.
                        {agreed ? ' Same read here —' : ' Here’s where I’d push back —'}
                      </p>
                    )}
                    {!userPick && <p className="text-sm text-[#9A9087] mb-3">Here’s my read —</p>}

                    <div className="flex items-start justify-between gap-4 mb-3">
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

                    <p className="text-[#5A554E] leading-relaxed mb-4">{d.reasoning}</p>

                    <div className="flex gap-3 border-t border-stone-200 pt-4 mb-5">
                      <span
                        className="shrink-0 text-[10px] font-medium uppercase text-[#C9683A] pt-0.5"
                        style={{ letterSpacing: '0.15em', minWidth: '70px' }}
                      >
                        Tradeoff
                      </span>
                      <p className="text-sm text-[#5A554E] leading-relaxed">{d.tradeoff}</p>
                    </div>

                    {settled ? (
                      <p className="text-[11px] font-medium uppercase text-[#9A9087]" style={{ letterSpacing: '0.12em' }}>
                        {d.status === 'confirmed' ? '✓ Locked in' : '✓ Your call: ' + stanceLabel(d.decision_type, d.stance)}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => settle(d, d.stance)}
                          className="px-4 py-2 rounded-lg text-sm bg-[#B07242] text-white hover:bg-[#8F5B2D] transition"
                        >
                          Go with that
                        </button>
                        {userPick && !agreed && (
                          <button
                            onClick={() => settle(d, userPick)}
                            className="px-4 py-2 rounded-lg text-sm border border-stone-300 bg-white text-[#4A4540] hover:border-stone-400 transition"
                          >
                            Keep mine ({stanceLabel(d.decision_type, userPick)})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {allSettled && (
          <div className="mt-10 text-center">
            <button
              onClick={buildSkeleton}
              disabled={building}
              className="bg-[#B07242] text-white font-medium px-8 py-3 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] disabled:opacity-60 transition"
            >
              {building ? 'Laying out the days…' : 'See the skeleton →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
