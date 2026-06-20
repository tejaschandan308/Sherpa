'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SherpaNav from '../components/SherpaNav'
import { readPlanning, writePlanning } from '../lib/planning'
import { SWIPE_CARDS, type SwipeAnswer } from '../lib/swipeMapping'

// v0: statements are grounded in the real destination (Portugal) where possible
// — naming actual places/distances reads truer than generic personality prompts.
// In a later pass these are generated per-trip from the destination.
const STATEMENTS: Record<string, string> = {
  swipe_1: 'I’d rather know Lisbon and Porto well than skim six Portuguese cities.',
  swipe_2: 'A good trip has empty afternoons in it — not just a full schedule.',
  swipe_3: 'I’d rather book the known-good spot than gamble on the off-map find.',
  swipe_4: 'A 3-hour train to another city is part of the trip, not a chore.',
  swipe_5: 'If I had to choose, the meal matters more than the museum.',
  swipe_6: 'I’d rather wander and see what happens than work off a plan.',
}

export default function SwipePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, SwipeAnswer>>({})

  useEffect(() => {
    const p = readPlanning()
    if (!p?.destination || !p.startDate) {
      router.replace('/')
      return
    }
    setReady(true)
  }, [router])

  if (!ready) return <div className="min-h-screen bg-[#FAFAF7]" />

  const card = SWIPE_CARDS[index]
  const total = SWIPE_CARDS.length

  function answer(value: SwipeAnswer) {
    const next = { ...answers, [card.card_id]: value }
    setAnswers(next)
    if (index + 1 >= total) {
      writePlanning({ swipeAnswers: next })
      router.push('/bridge')
    } else {
      setIndex(index + 1)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
      <SherpaNav />

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Progress dots */}
        <div className="flex gap-1.5 mb-10">
          {SWIPE_CARDS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-6 bg-[#B07242]' : i < index ? 'w-1.5 bg-[#C9683A]' : 'w-1.5 bg-stone-300'
              }`}
            />
          ))}
        </div>

        <div className="w-full max-w-md text-center">
          <p
            className="text-[10px] font-medium uppercase text-[#B0A89C] mb-6"
            style={{ letterSpacing: '0.2em' }}
          >
            Quick gut check · {index + 1} of {total}
          </p>

          <p
            className="text-[#1A1A1A] text-2xl md:text-3xl leading-snug mb-12 min-h-[5rem]"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            “{STATEMENTS[card.card_id]}”
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => answer('disagree')}
              className="flex-1 border border-stone-300 bg-white text-[#4A4540] font-medium py-3 rounded-lg hover:border-stone-400 transition"
            >
              Not really
            </button>
            <button
              onClick={() => answer('agree')}
              className="flex-1 bg-[#B07242] text-white font-medium py-3 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] transition"
            >
              That’s me
            </button>
          </div>

          <p className="mt-6 text-xs text-stone-400">
            Gut reaction — these only nudge the close calls, never the hard facts.
          </p>
        </div>
      </div>
    </div>
  )
}
