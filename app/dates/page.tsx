'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SherpaNav from '../components/SherpaNav'
import { checkDestination } from '../lib/placeTiers'
import { readPlanning, writePlanning } from '../lib/planning'

function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DatesPage() {
  const router = useRouter()
  const today = getToday()
  const [destination, setDestination] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const p = readPlanning()
    if (!p?.destination) {
      router.replace('/')
      return
    }
    setDestination(p.destination)
    if (p.startDate) setStartDate(p.startDate)
    if (p.endDate) setEndDate(p.endDate)
    setReady(true)
  }, [router])

  if (!ready || !destination) {
    return <div className="min-h-screen bg-[#FAFAF7]" />
  }

  const check = checkDestination(destination)

  // Honest hard-stop for destinations we can't ground a trip around.
  if (check.status !== 'supported') {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
        <SherpaNav />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center space-y-5">
            <h1
              className="text-3xl text-[#1A1A1A] italic leading-snug"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              {check.status === 'too_broad'
                ? `“${destination}” is a bit broad.`
                : `We don’t have a confident read on ${destination} yet.`}
            </h1>
            <p className="text-[#6B6B6B] leading-relaxed">
              {check.status === 'too_broad'
                ? 'Sherpa reasons within a country or region. Try a specific one — for v0 that’s Portugal.'
                : 'Sherpa only gives a call when it can back it with real distances and a hand-checked read on the places. Right now that’s Portugal. We’d rather say so than guess.'}
            </p>
            <button
              onClick={() => router.push('/')}
              className="text-[11px] font-medium uppercase hover:opacity-70 transition-opacity"
              style={{ letterSpacing: '0.15em', color: '#C9683A' }}
            >
              ← Try another destination
            </button>
          </div>
        </div>
      </div>
    )
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault()
    if (!startDate || !endDate) return
    writePlanning({ startDate, endDate })
    router.push('/swipe')
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7] flex flex-col">
      <SherpaNav />
      <div className="flex-1 flex items-center justify-center px-6">
        <form onSubmit={handleNext} className="w-full max-w-md space-y-8">
          <div>
            <p
              className="text-[10px] font-medium uppercase text-[#B0A89C] mb-2"
              style={{ letterSpacing: '0.2em' }}
            >
              {destination}
            </p>
            <h1 className="text-3xl font-bold text-[#1A1A1A]">When are you going?</h1>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="start" className="block text-sm font-medium text-[#3D3830]">
                Start
              </label>
              <input
                id="start"
                type="date"
                value={startDate}
                min={today}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  if (endDate && endDate < e.target.value) setEndDate('')
                }}
                required
                className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-transparent transition"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="end" className="block text-sm font-medium text-[#3D3830]">
                End
              </label>
              <input
                id="end"
                type="date"
                value={endDate}
                min={startDate || today}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-transparent transition"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-[#B07242] text-white font-medium py-3 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] transition"
          >
            Next
          </button>
        </form>
      </div>
    </div>
  )
}
