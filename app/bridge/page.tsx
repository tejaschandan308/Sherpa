'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import SherpaNav from '../components/SherpaNav'
import { readPlanning } from '../lib/planning'
import { saveBundle } from '../lib/store'
import {
  buildTripShape,
  deckToPriors,
  strongestPriors,
  SWIPE_CARDS,
  type SwipeAnswer,
  type SwipePrior,
} from '../lib/swipeMapping'
import type { Decision, TripBundle } from '../lib/types'

// Soft, non-declarative phrasing — a |0.6| signal isn't strong enough to claim
// as a confident read, so the tone stays "you'd lean toward…". Keyed by
// dimension + answer direction.
const LEANINGS: Record<string, string> = {
  'depth_breadth:agree': 'knowing a couple of places deeply over sampling a lot',
  'depth_breadth:disagree': 'covering more ground over going deep on a few places',
  'pace:agree': 'a slower pace with room to do nothing',
  'pace:disagree': 'a fuller schedule that keeps moving',
  'risk_tolerance:agree': 'the known-good choice over the gamble',
  'risk_tolerance:disagree': 'taking a chance on the off-map find',
  'transit_tolerance:agree': 'treating a long train as part of the trip',
  'transit_tolerance:disagree': 'keeping travel days short',
  'food_vs_culture:agree': 'the meal over the museum',
  'food_vs_culture:disagree': 'the museum over the meal',
  'structure:agree': 'wandering over working off a plan',
  'structure:disagree': 'a plan over winging it',
}

function leaningPhrase(prior: SwipePrior, answers: Record<string, SwipeAnswer>): string {
  const card = SWIPE_CARDS.find((c) => c.dimension === prior.dimension)
  const answer = card ? answers[card.card_id] : undefined
  return LEANINGS[`${prior.dimension}:${answer}`] ?? prior.dimension
}

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const ms = new Date(ey, em - 1, ed).getTime() - new Date(sy, sm - 1, sd).getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

export default function BridgePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planning = useMemo(() => readPlanning(), [])
  const answers = planning?.swipeAnswers ?? {}
  const priors = useMemo(() => deckToPriors(answers), [answers])
  const top = useMemo(() => strongestPriors(priors, 3), [priors])

  useEffect(() => {
    if (!planning?.destination || !planning.startDate || !planning.swipeAnswers) {
      router.replace('/')
      return
    }
    setReady(true)
  }, [planning, router])

  if (!ready || !planning) return <div className="min-h-screen bg-[#FAFAF7]" />

  async function seeDecisions() {
    if (!planning?.startDate || !planning.endDate) return
    setGenerating(true)
    setError(null)

    const days_total = daysBetween(planning.startDate, planning.endDate)
    const trip_shape = buildTripShape(priors, {}, true)
    const tripId = `trip_${Date.now()}`

    try {
      const res = await fetch('/api/plan/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: planning.destination,
          start_date: planning.startDate,
          days_total,
          trip_shape,
          prior_answers: Object.entries(answers).map(([card_id, answer]) => ({ card_id, answer })),
        }),
      })
      if (!res.ok) throw new Error('Generation failed')
      const data = (await res.json()) as { decisions: Decision[] }

      const now = Date.now()
      const bundle: TripBundle = {
        trip: {
          id: tripId,
          destination: planning.destination,
          start_date: planning.startDate,
          end_date: planning.endDate,
          days_total,
          trip_shape,
          created_at: now,
          updated_at: now,
        },
        decisions: data.decisions.map((d) => ({ ...d, trip_id: tripId })),
        legs: [],
        edges: [],
        day_blocks: [],
        documents: [],
      }
      saveBundle(bundle)
      router.push(`/trip/${tripId}/decisions`)
    } catch {
      setError('Something went wrong generating your decisions. Please try again.')
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
      <SherpaNav />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-lg">
          <p
            className="text-[10px] font-medium uppercase text-[#B0A89C] mb-4"
            style={{ letterSpacing: '0.2em' }}
          >
            Here’s what I picked up
          </p>

          <h1
            className="text-3xl md:text-4xl text-[#1A1A1A] leading-snug mb-8"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            You’d lean toward…
          </h1>

          <ul className="space-y-4 mb-10">
            {top.map((p) => (
              <li key={p.dimension} className="flex gap-3 items-baseline">
                <span className="text-[#C9683A] text-lg leading-none">·</span>
                <span className="text-lg text-[#3D3830] leading-relaxed">
                  {leaningPhrase(p, answers)}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-sm text-[#9A9087] leading-relaxed mb-8">
            Nothing locked in — these just tip the close calls when the facts don’t
            settle them on their own.
          </p>

          <button
            onClick={seeDecisions}
            disabled={generating}
            className="w-full bg-[#B07242] text-white font-medium py-3 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] disabled:opacity-60 transition"
          >
            {generating ? 'Thinking it through…' : 'See the calls'}
          </button>

          {error && <p className="mt-4 text-sm text-red-600 text-center">{error}</p>}
        </div>
      </div>
    </div>
  )
}
