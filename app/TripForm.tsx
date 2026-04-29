'use client'

// This directive marks the file as a Client Component, which is required
// for anything that uses state, event handlers, or browser APIs in Next.js 15.

import { useState } from 'react'

const TRAVEL_STYLE_OPTIONS = [
  'Foodie',
  'History nerd',
  'Nature seeker',
  'Aesthete',
  'Local pretender',
  'Night owl',
] as const

const PACE_OPTIONS = ['Chill', 'Moderate', 'Packed'] as const

// Derive union types from the const arrays so TypeScript catches typos at compile time
type TravelStyle = (typeof TRAVEL_STYLE_OPTIONS)[number]
type Pace = (typeof PACE_OPTIONS)[number]

interface TripFormData {
  destination: string
  startDate: string
  endDate: string
  travelStyles: TravelStyle[]
  pace: Pace
}

export default function TripForm() {
  // Single state object for all form fields
  const [formData, setFormData] = useState<TripFormData>({
    destination: '',
    startDate: '',
    endDate: '',
    travelStyles: [],
    pace: 'Moderate',
  })

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
    e.preventDefault() // stop the browser from reloading the page on submit
    console.log('Trip data:', formData)
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-stone-200 shadow-sm p-8 space-y-8">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-stone-900">Sherpa</h1>
          <p className="mt-1 text-stone-500 text-base">Your trip co-pilot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Destination */}
          <div className="space-y-1.5">
            <label htmlFor="destination" className="block text-sm font-medium text-stone-700">
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
              className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent transition"
            />
          </div>

          {/* Dates — side by side on the same row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="startDate" className="block text-sm font-medium text-stone-700">
                Start date
              </label>
              <input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, startDate: e.target.value }))
                }
                required
                className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent transition"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="endDate" className="block text-sm font-medium text-stone-700">
                End date
              </label>
              <input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, endDate: e.target.value }))
                }
                required
                className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Travel style — pill toggle buttons */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-700">Travel style</p>
            <p className="text-xs text-stone-400">Pick all that apply</p>
            <div className="flex flex-wrap gap-2">
              {TRAVEL_STYLE_OPTIONS.map((style) => {
                const isSelected = formData.travelStyles.includes(style)
                return (
                  <button
                    key={style}
                    type="button" // prevent this button from triggering form submit
                    onClick={() => toggleStyle(style)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      isSelected
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-white text-stone-600 border-stone-300 hover:border-stone-500'
                    }`}
                  >
                    {style}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Pace — styled radio buttons that look like a segmented control */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-700">Pace</p>
            <div className="flex gap-3">
              {PACE_OPTIONS.map((pace) => (
                <label
                  key={pace}
                  className={`flex-1 text-center border rounded-lg py-2.5 text-sm cursor-pointer transition ${
                    formData.pace === pace
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-600 border-stone-300 hover:border-stone-500'
                  }`}
                >
                  {/* sr-only hides the radio input visually; the label provides the click target */}
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
            className="w-full bg-stone-900 text-white font-medium py-3 rounded-lg hover:bg-stone-700 active:bg-stone-800 transition"
          >
            Plan my trip
          </button>

        </form>
      </div>
    </div>
  )
}
