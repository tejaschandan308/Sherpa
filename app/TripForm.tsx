'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const TRAVEL_STYLE_OPTIONS = [
  'Foodie',
  'History nerd',
  'Nature seeker',
  'Aesthete',
  'Local pretender',
  'Night owl',
] as const

const PACE_OPTIONS = ['Chill', 'Moderate', 'Packed'] as const

type TravelStyle = (typeof TRAVEL_STYLE_OPTIONS)[number]
type Pace = (typeof PACE_OPTIONS)[number]

interface TripFormData {
  destination: string
  startDate: string
  endDate: string
  travelStyles: TravelStyle[]
  pace: Pace
}

// Returns today's date as YYYY-MM-DD in the user's local timezone
function getToday(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function TripForm() {
  const today = getToday()
  const router = useRouter()

  const [formData, setFormData] = useState<TripFormData>({
    destination: '',
    startDate: '',
    endDate: '',
    travelStyles: [],
    pace: 'Moderate',
  })

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Toggle a style tag: add it if absent, remove it if already selected
  function toggleStyle(style: TravelStyle) {
    setFormData((prev) => ({
      ...prev,
      travelStyles: prev.travelStyles.includes(style)
        ? prev.travelStyles.filter((s) => s !== style)
        : [...prev.travelStyles, style],
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      // Save form data for the results page to pick up, then navigate immediately
      // so the loading experience happens there rather than on this form.
      sessionStorage.setItem('sherpa_pending_trip', JSON.stringify(formData))
      sessionStorage.removeItem('sherpa_recommendations')
      sessionStorage.removeItem('sherpa_trip')
      router.push('/results')
    } catch {
      setError('Unable to save your trip. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Destination */}
      <div className="space-y-1.5">
        <label htmlFor="destination" className="block text-sm font-medium text-[#3D3830]">
          Where are you going?
        </label>
        <input
          id="destination"
          type="text"
          placeholder="e.g., Lisbon, Portugal"
          value={formData.destination}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, destination: e.target.value }))
          }
          required
          className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-[#1A1A1A] placeholder:text-stone-400 bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-transparent transition"
        />
        <p className="text-xs text-[#9A9087]">
          Works best with a specific city or region (e.g., &lsquo;Lisbon&rsquo; or &lsquo;Algarve&rsquo; rather than &lsquo;Portugal&rsquo;)
        </p>
      </div>

      {/* Dates — side by side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="startDate" className="block text-sm font-medium text-[#3D3830]">
            Start date
          </label>
          <input
            id="startDate"
            type="date"
            value={formData.startDate}
            min={today}
            onChange={(e) => {
              const newStart = e.target.value
              setFormData((prev) => ({
                ...prev,
                startDate: newStart,
                endDate: prev.endDate && prev.endDate < newStart ? '' : prev.endDate,
              }))
            }}
            required
            className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-transparent transition"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="endDate" className="block text-sm font-medium text-[#3D3830]">
            End date
          </label>
          <input
            id="endDate"
            type="date"
            value={formData.endDate}
            min={formData.startDate || today}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, endDate: e.target.value }))
            }
            required
            className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-transparent transition"
          />
        </div>
      </div>

      {/* Travel style — pill toggles */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#3D3830]">Travel style</p>
        <p className="text-xs text-stone-400">Pick all that apply</p>
        <div className="flex flex-wrap gap-2">
          {TRAVEL_STYLE_OPTIONS.map((style) => {
            const isSelected = formData.travelStyles.includes(style)
            return (
              <button
                key={style}
                type="button"
                onClick={() => toggleStyle(style)}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  isSelected
                    ? 'bg-[#B07242] text-white border-[#B07242]'
                    : 'bg-white text-[#4A4540] border-stone-300 hover:border-stone-400'
                }`}
              >
                {style}
              </button>
            )
          })}
        </div>
      </div>

      {/* Pace — segmented control */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#3D3830]">Pace</p>
        <div className="flex gap-3">
          {PACE_OPTIONS.map((pace) => (
            <label
              key={pace}
              className={`flex-1 text-center border rounded-lg py-2.5 text-sm cursor-pointer transition ${
                formData.pace === pace
                  ? 'bg-[#B07242] text-white border-[#B07242]'
                  : 'bg-white text-[#4A4540] border-stone-300 hover:border-stone-400'
              }`}
            >
              <input
                type="radio"
                name="pace"
                value={pace}
                checked={formData.pace === pace}
                onChange={() => setFormData((prev) => ({ ...prev, pace }))}
                className="sr-only"
              />
              {pace}
            </label>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-[#B07242] text-white font-medium py-3 rounded-lg hover:bg-[#8F5B2D] active:bg-[#7A4A22] disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        Plan my trip
      </button>

      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

    </form>
  )
}
