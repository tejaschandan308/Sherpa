'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import SherpaNav from '../../../components/SherpaNav'
import { getBundle, saveBundle } from '../../../lib/store'
import { DEMO_DECISION_QUESTIONS, DEMO_TRIP_ID } from '../../../lib/demoTrip'
import { computeImpact, impactLines, type RevisitImpact } from '../../../lib/revisit'
import { deriveLocks, remapDocuments } from '../../../lib/documents'
import type {
  Confidence,
  Decision,
  DecisionHistory,
  DecisionType,
  TripBundle,
} from '../../../lib/types'

// The order decisions are asked in (base city first — it gates the rest).
const ORDER: DecisionType[] = ['base_city', 'region_cut', 'splurge_or_skip', 'pace']

// Neutral ask-first framing questions for REAL trips. Deliberately free of any
// trip duration — the actual day count is shown in the header, and hardcoding
// "14 days" here is exactly what used to leak the demo's length onto a real
// trip. These set up the choice without revealing Sherpa's stance. (The seeded
// Portugal demo keeps its own richer, duration-specific questions; those must
// never appear on a trip the user actually created.)
const FRAMING_QUESTIONS: Record<DecisionType, string> = {
  base_city:
    'Both Lisbon and Porto are on your list. Do you base yourself in one city and day-trip out, or actually split your nights between the two?',
  region_cut:
    'You can’t do the whole country well in one trip. If something has to give between the southern coast and the green north — which way do you lean?',
  splurge_or_skip:
    'The Douro Valley is the classic wine day-trip from Porto. Worth carving out a full day for it this time, or let it go?',
  pace: 'Do you want every day to count, or some room to do nothing?',
}

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
  // Revisit state: which decision is being reconsidered, the staged change +
  // its computed impact awaiting confirmation, and whether a commit is running.
  const [revisitingId, setRevisitingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    decisionId: string
    newStance: string
    impact: RevisitImpact
  } | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    const b = getBundle(id)
    if (!b) {
      router.replace('/')
      return
    }
    setBundle(b)
    // Already-settled decisions (a returning/revisiting user) open straight to
    // their verdict rather than re-asking the question.
    const initialPhase: Record<string, Phase> = {}
    const initialPicks: Record<string, string> = {}
    for (const d of b.decisions) {
      if (d.status === 'confirmed' || d.status === 'overridden') initialPhase[d.id] = 'revealed'
      if (d.user_answer) initialPicks[d.id] = d.user_answer
    }
    setPhase(initialPhase)
    setPicks(initialPicks)
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

  // Stage a proposed change and compute its exact (deterministic) impact, shown
  // for confirmation before anything is committed.
  function startPreview(decision: Decision, newStance: string) {
    if (!bundle) return
    const impact = computeImpact(bundle, decision.decision_type, newStance)
    setPreview({ decisionId: decision.id, newStance, impact })
  }

  function cancelRevisit() {
    setRevisitingId(null)
    setPreview(null)
  }

  // Commit a revisited decision: record the before-state in DecisionHistory,
  // flip the stance, and regenerate the skeleton from the new decision set.
  async function applyRevisit(decision: Decision, newStance: string) {
    if (!bundle) return
    setApplying(true)

    // Timestamp captured inside a callback boundary (Date.now is impure and the
    // lint rule rejects a bare call in the component body — same reason settle()
    // stamps inside its .map callback).
    const historyRow: DecisionHistory = (() => {
      const changedAt = Date.now()
      return {
        id: `hist_${decision.id}_${changedAt}`,
        decision_id: decision.id,
        trip_id: bundle.trip.id,
        prev_stance: decision.stance,
        prev_status: decision.status,
        next_stance: newStance as Decision['stance'],
        next_status: 'overridden',
        changed_at: changedAt,
      }
    })()

    const updatedDecisions = bundle.decisions.map((d) =>
      d.id === decision.id
        ? { ...d, stance: newStance as Decision['stance'], status: 'overridden' as const, updated_at: Date.now() }
        : d
    )

    const confirmed: Partial<Record<DecisionType, string>> = {}
    for (const d of updatedDecisions) confirmed[d.decision_type] = d.stance

    try {
      // Deterministic regeneration (+ fresh voice-pass captions) from the new
      // decision set — the same path the initial build uses. When the change
      // touched booked/edited items the user reached this point through the
      // conflict banner (keep-mine vs use-the-decision), so it's never silent;
      // attachments are re-mapped below rather than orphaned.
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
      // Re-point document attachments at the regenerated structure (ids change
      // on regen). Targets that no longer exist become unattached rather than
      // lost; deriveLocks then recomputes locks from the surviving attachments.
      const documents = remapDocuments(
        bundle.documents,
        bundle.legs,
        bundle.day_blocks,
        data.legs,
        data.dayBlocks
      )
      const updated: TripBundle = deriveLocks({
        ...bundle,
        decisions: updatedDecisions,
        legs: data.legs,
        edges: data.edges,
        day_blocks: data.dayBlocks,
        documents,
        decision_history: [...(bundle.decision_history ?? []), historyRow],
      })
      saveBundle(updated)
      setBundle(updated)
      setRevisitingId(null)
      setPreview(null)
    } catch {
      // Leave the preview open so the user can retry.
    } finally {
      setApplying(false)
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
                    {(id === DEMO_TRIP_ID
                      ? DEMO_DECISION_QUESTIONS[d.decision_type]
                      : FRAMING_QUESTIONS[d.decision_type]) ?? d.headline}
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
                      <div>
                        {/* Settled status + the entry point to reconsider it */}
                        {revisitingId !== d.id && preview?.decisionId !== d.id && (
                          <div className="flex items-center justify-between gap-4">
                            <p
                              className="text-[11px] font-medium uppercase text-[#9A9087]"
                              style={{ letterSpacing: '0.12em' }}
                            >
                              {d.status === 'confirmed'
                                ? '✓ Locked in'
                                : '✓ Your call: ' + stanceLabel(d.decision_type, d.stance)}
                            </p>
                            {bundle.legs.length > 0 && (
                              <button
                                onClick={() => {
                                  setPreview(null)
                                  setRevisitingId(d.id)
                                }}
                                className="shrink-0 text-[11px] font-medium uppercase text-[#C9683A] hover:text-[#8F5B2D] transition"
                                style={{ letterSpacing: '0.12em' }}
                              >
                                Change this call
                              </button>
                            )}
                          </div>
                        )}

                        {/* Revisit: pick a different stance to preview */}
                        {revisitingId === d.id && preview?.decisionId !== d.id && (
                          <div>
                            <p className="text-sm text-[#5A554E] mb-3">Switch this to —</p>
                            <div className="flex flex-wrap gap-2">
                              {OPTIONS[d.decision_type].map((o) => (
                                <button
                                  key={o.stance}
                                  disabled={o.stance === d.stance}
                                  onClick={() => startPreview(d, o.stance)}
                                  className="px-4 py-2 rounded-full text-sm border border-stone-300 bg-white text-[#4A4540] hover:border-[#B07242] hover:text-[#1A1A1A] disabled:opacity-40 disabled:cursor-default disabled:hover:border-stone-300 transition"
                                >
                                  {o.label}
                                  {o.stance === d.stance ? ' (current)' : ''}
                                </button>
                              ))}
                              <button
                                onClick={cancelRevisit}
                                className="px-4 py-2 rounded-full text-sm text-[#9A9087] hover:text-[#1A1A1A] transition"
                              >
                                Never mind
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Impact preview — exact, deterministic diff before committing */}
                        {preview?.decisionId === d.id && (
                          <div>
                            <p className="text-sm text-[#9A9087] mb-3">
                              Switching to{' '}
                              <span className="text-[#5A554E]">
                                {stanceLabel(d.decision_type, preview.newStance)}
                              </span>{' '}
                              would change your skeleton:
                            </p>

                            {preview.impact.changed ? (
                              <ul className="space-y-1.5 mb-4">
                                {impactLines(preview.impact).map((line, i) => (
                                  <li key={i} className="flex gap-2 text-sm text-[#3D3830]">
                                    <span className="text-[#C9683A] leading-none">·</span>
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-[#3D3830] mb-4">
                                This wouldn’t change your skeleton — same legs and days either way.
                              </p>
                            )}

                            {preview.impact.affected.length > 0 ? (
                              <>
                                {/* Conflict banner — no auto-resolution; the user
                                    must choose keep-mine vs use-the-decision. */}
                                <div className="rounded-lg border border-[#E4C9B8] bg-[#FBF3EC] p-4 mb-4">
                                  <p
                                    className="text-[10px] font-medium uppercase text-[#8F5B2D] mb-2"
                                    style={{ letterSpacing: '0.12em' }}
                                  >
                                    This conflicts with what you’ve booked or edited
                                  </p>
                                  <ul className="space-y-1 mb-3">
                                    {preview.impact.affected.map((a, i) => (
                                      <li key={i} className="text-sm text-[#5A554E]">
                                        {a.label}{' '}
                                        <span className="text-[#9A9087]">
                                          ({a.reason === 'locked' ? 'booked' : 'your edit'})
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="text-xs text-[#8F5B2D] leading-relaxed">
                                    Use the new plan and these get rebuilt — your uploaded files stay
                                    on the shelf, but Sherpa can’t cancel or change any real bookings,
                                    so you’ll need to handle those yourself. Or keep your version and
                                    nothing changes.
                                  </p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    disabled={applying}
                                    onClick={() => applyRevisit(d, preview.newStance)}
                                    className="px-4 py-2 rounded-lg text-sm bg-[#B07242] text-white hover:bg-[#8F5B2D] disabled:opacity-60 transition"
                                  >
                                    {applying ? 'Updating…' : 'Use the new plan'}
                                  </button>
                                  <button
                                    disabled={applying}
                                    onClick={cancelRevisit}
                                    className="px-4 py-2 rounded-lg text-sm border border-stone-300 bg-white text-[#4A4540] hover:border-stone-400 disabled:opacity-60 transition"
                                  >
                                    Keep my version
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    disabled={applying}
                                    onClick={() => applyRevisit(d, preview.newStance)}
                                    className="px-4 py-2 rounded-lg text-sm bg-[#B07242] text-white hover:bg-[#8F5B2D] disabled:opacity-60 transition"
                                  >
                                    {applying ? 'Updating…' : 'Apply this change'}
                                  </button>
                                  <button
                                    disabled={applying}
                                    onClick={cancelRevisit}
                                    className="px-4 py-2 rounded-lg text-sm border border-stone-300 bg-white text-[#4A4540] hover:border-stone-400 disabled:opacity-60 transition"
                                  >
                                    Never mind
                                  </button>
                                </div>

                                <p className="text-[11px] text-[#9A9087] mt-3 leading-relaxed">
                                  Changing a call only updates your Sherpa plan — it never touches real
                                  bookings.
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
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
