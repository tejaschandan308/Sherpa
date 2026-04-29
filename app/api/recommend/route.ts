import Anthropic from '@anthropic-ai/sdk'

interface RequestBody {
  destination: string
  startDate: string
  endDate: string
  travelStyles: string[]
  pace: string
}

export interface PlaceReview {
  authorName: string
  rating: number
  text: string
  relativePublishTimeDescription: string
}

export interface Place {
  name: string
  category: 'sight' | 'food' | 'stay'
  description: string
  whyItMadeTheCut: string
  photoUrl?: string
  rating?: number
  userRatingCount?: number
  reviews?: PlaceReview[]
  distanceText?: string
  distanceMeters?: number
  durationText?: string
  transitLabel?: 'Walkable' | 'Transit accessible' | 'Best by taxi'
}

export interface RecommendationsResponse {
  places: Place[]
  weatherSummary?: string
}

// --- Internal types ---

interface PlaceGoogleData {
  photoUrl: string | null
  rating: number | null
  userRatingCount: number | null
  reviews: PlaceReview[]
  location: Coordinates | null
}

interface TransitInfo {
  distanceText: string
  distanceMeters: number
  durationText?: string
  transitLabel: 'Walkable' | 'Transit accessible' | 'Best by taxi'
}

interface DistanceMatrixElement {
  status: string
  distance?: { text: string; value: number }
  duration?: { text: string; value: number }
}

interface GoogleReview {
  rating?: number
  text?: { text?: string }
  originalText?: { text?: string }
  relativePublishTimeDescription?: string
  authorAttribution?: { displayName?: string }
}

interface Coordinates {
  lat: number
  lng: number
}

// Loosely typed to match the OpenWeather API shape before we normalise it
interface ForecastItem {
  dt: number
  main: { temp: number }
  weather: { main: string }[]
  rain?: { '3h'?: number }
  pop?: number
}

// --- Clients ---

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// --- Helpers ---

function formatAuthorName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// Geocodes a free-text destination into coordinates using the Google Geocoding API.
// Returns null on any failure so callers can skip weather gracefully.
async function fetchCoordinates(destination: string): Promise<Coordinates | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destination)}&key=${apiKey}`
    )
    if (!res.ok) return null
    const data = await res.json()
    const loc = data.results?.[0]?.geometry?.location
    if (!loc) return null
    return { lat: loc.lat, lng: loc.lng }
  } catch {
    return null
  }
}

// Builds a weather context string for Claude.
// Within 16 days of the trip: calls the OpenWeather forecast endpoint and summarises
// temperatures, dominant conditions, and likely rainy days.
// Beyond 16 days: returns a prompt telling Claude to use its seasonal knowledge instead.
// Returns null on any failure so the Claude call proceeds without weather context.
async function fetchWeatherContext(
  lat: number,
  lng: number,
  destination: string,
  startDate: string,
  endDate: string
): Promise<string | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY
  if (!apiKey) return null

  // Parse as local midnight to avoid UTC date-shift issues in the day-count
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const tripStart = new Date(sy, sm - 1, sd)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysUntilTrip = Math.round((tripStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  const monthName = tripStart.toLocaleString('en-US', { month: 'long' })

  if (daysUntilTrip > 16) {
    return (
      `Trip is too far out for a real forecast — use your general seasonal knowledge ` +
      `for ${destination} in ${monthName}.`
    )
  }

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&units=metric&appid=${apiKey}`
    )
    if (!res.ok) return null
    const data = await res.json()

    // Filter to items whose UTC date falls within the trip window
    const tripForecasts: ForecastItem[] = (data.list ?? []).filter((item: ForecastItem) => {
      const itemDate = new Date(item.dt * 1000).toISOString().slice(0, 10)
      return itemDate >= startDate && itemDate <= endDate
    })

    if (tripForecasts.length === 0) {
      return (
        `Forecast data doesn't cover these exact dates — use your general seasonal knowledge ` +
        `for ${destination} in ${monthName}.`
      )
    }

    const temps = tripForecasts.map((f) => f.main.temp)
    const minTemp = Math.round(Math.min(...temps))
    const maxTemp = Math.round(Math.max(...temps))

    // Count distinct calendar days that look rainy (>40% precipitation probability, or rain in code)
    const rainyDays = new Set(
      tripForecasts
        .filter(
          (f) =>
            (f.rain?.['3h'] ?? 0) > 0 ||
            (f.pop ?? 0) > 0.4 ||
            ['Rain', 'Drizzle', 'Thunderstorm'].includes(f.weather[0]?.main ?? '')
        )
        .map((f) => new Date(f.dt * 1000).toISOString().slice(0, 10))
    ).size

    // Dominant weather condition across all forecast items
    const conditionCounts: Record<string, number> = {}
    for (const f of tripForecasts) {
      const main = f.weather[0]?.main ?? 'Unknown'
      conditionCounts[main] = (conditionCounts[main] ?? 0) + 1
    }
    const dominant =
      Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mixed'

    const conditionLabel: Record<string, string> = {
      Clear: 'mostly sunny',
      Clouds: 'partly cloudy',
      Rain: 'rainy',
      Drizzle: 'drizzly',
      Thunderstorm: 'stormy',
      Snow: 'snowy',
      Mist: 'misty',
      Fog: 'foggy',
    }
    const conditionDesc = conditionLabel[dominant] ?? dominant.toLowerCase()
    const rainNote =
      rainyDays > 0
        ? `, ${rainyDays} rainy day${rainyDays > 1 ? 's' : ''} likely`
        : ', no significant rain expected'

    return `Forecast for these dates: temperatures around ${minTemp}–${maxTemp}°C, ${conditionDesc}${rainNote}.`
  } catch {
    return null
  }
}

// Fetches photo, rating, review count, and up to 3 reviews for a named place.
// All fields return null / empty on any failure so callers degrade gracefully.
async function fetchPlaceData(placeName: string, destination: string): Promise<PlaceGoogleData> {
  const empty: PlaceGoogleData = { photoUrl: null, rating: null, userRatingCount: null, reviews: [], location: null }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return empty

  try {
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.photos,places.rating,places.userRatingCount,places.reviews,places.location',
      },
      body: JSON.stringify({ textQuery: `${placeName} ${destination}` }),
    })

    if (!searchRes.ok) return empty

    const searchData = await searchRes.json()
    const googlePlace = searchData.places?.[0]
    if (!googlePlace) return empty

    // Photo — second request to resolve the resource name into a CDN URL
    let photoUrl: string | null = null
    const photoName: string | undefined = googlePlace.photos?.[0]?.name
    if (photoName) {
      const mediaRes = await fetch(
        `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=600&skipHttpRedirect=true`,
        { headers: { 'X-Goog-Api-Key': apiKey } }
      )
      if (mediaRes.ok) {
        const mediaData = await mediaRes.json()
        if (typeof mediaData.photoUri === 'string') photoUrl = mediaData.photoUri
      }
    }

    // Reviews — normalise and strip surnames for privacy
    const rawReviews: GoogleReview[] = googlePlace.reviews ?? []
    const reviews: PlaceReview[] = rawReviews.slice(0, 3).map((r) => ({
      authorName: formatAuthorName(r.authorAttribution?.displayName ?? 'Anonymous'),
      rating: r.rating ?? 0,
      text: r.text?.text ?? r.originalText?.text ?? '',
      relativePublishTimeDescription: r.relativePublishTimeDescription ?? '',
    }))

    // Location — Places API (New) returns { latitude, longitude } under the "location" field
    const locData = googlePlace.location
    const location: Coordinates | null =
      locData && typeof locData.latitude === 'number' && typeof locData.longitude === 'number'
        ? { lat: locData.latitude, lng: locData.longitude }
        : null

    return {
      photoUrl,
      rating: typeof googlePlace.rating === 'number' ? googlePlace.rating : null,
      userRatingCount:
        typeof googlePlace.userRatingCount === 'number' ? googlePlace.userRatingCount : null,
      reviews,
      location,
    }
  } catch {
    return empty
  }
}

// Batches all place locations into a single Distance Matrix call and returns transit info per place.
// Uses transit mode; falls back to estimated walk time for places under 1.5 km.
async function fetchTransitData(
  cityCoords: Coordinates,
  placeLocations: (Coordinates | null)[]
): Promise<(TransitInfo | null)[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return placeLocations.map(() => null)

  // Build destinations string from only the places where we have coordinates
  const validIndices: number[] = []
  const destinationParts: string[] = []
  for (let i = 0; i < placeLocations.length; i++) {
    const loc = placeLocations[i]
    if (loc) {
      validIndices.push(i)
      destinationParts.push(`${loc.lat},${loc.lng}`)
    }
  }
  if (destinationParts.length === 0) return placeLocations.map(() => null)

  try {
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${cityCoords.lat},${cityCoords.lng}` +
      `&destinations=${destinationParts.join('|')}` +
      `&mode=transit` +
      `&key=${apiKey}`

    const res = await fetch(url)
    if (!res.ok) return placeLocations.map(() => null)

    const data = await res.json()
    const elements: DistanceMatrixElement[] = data.rows?.[0]?.elements ?? []

    const result: (TransitInfo | null)[] = placeLocations.map(() => null)

    for (let j = 0; j < validIndices.length; j++) {
      const idx = validIndices[j]
      const el = elements[j]
      if (!el?.distance) continue

      const distanceMeters = el.distance.value
      const distanceText = el.distance.text
      let transitLabel: TransitInfo['transitLabel']
      let durationText: string | undefined

      if (distanceMeters < 1500) {
        transitLabel = 'Walkable'
        const walkMins = Math.max(1, Math.round(distanceMeters / 83))
        durationText = `${walkMins} min walk`
      } else if (el.status === 'OK' && el.duration) {
        const durationMins = Math.round(el.duration.value / 60)
        transitLabel = durationMins < 60 ? 'Transit accessible' : 'Best by taxi'
        durationText = `${durationMins} min by transit`
      } else {
        transitLabel = 'Best by taxi'
        durationText = undefined
      }

      result[idx] = { distanceText, distanceMeters, durationText, transitLabel }
    }

    return result
  } catch {
    return placeLocations.map(() => null)
  }
}

export async function POST(request: Request) {
  const body: RequestBody = await request.json()
  const { destination, startDate, endDate, travelStyles, pace } = body

  const styleList = travelStyles.length > 0 ? travelStyles.join(', ') : 'general interest'

  // Geocode → weather context (both steps skip gracefully on failure)
  const coords = await fetchCoordinates(destination)
  const weatherContext = coords
    ? await fetchWeatherContext(coords.lat, coords.lng, destination, startDate, endDate)
    : null

  // Injected verbatim into the user message only when weather data was obtained
  const weatherSection = weatherContext ? `\nWeather context for this trip:\n${weatherContext}\n` : ''

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are Sherpa, an opinionated travel co-pilot for solo travellers. You curate a tight shortlist of places worth visiting — not a generic tourist guide. You prioritise authenticity over popularity and always explain your reasoning in terms of the specific traveller's style.

When weather data is provided, weave it into your "whyItMadeTheCut" reasoning only where it genuinely changes the recommendation — skip beach activities on rainy days, highlight perfect seasonal timing, flag indoor alternatives in bad weather. Don't mention weather on every place; only where it actually matters.

Your output must be ONLY valid JSON, with no explanation, no markdown, and no code fences — just the raw JSON object.`,
      messages: [
        {
          role: 'user',
          content: `Plan a trip to ${destination} from ${startDate} to ${endDate}.

Traveller profile:
- Style tags: ${styleList}
- Pace preference: ${pace}
${weatherSection}
Return exactly 8 recommended places as JSON in this exact format:
{
  "weatherSummary": "string — 1-2 sentences on what the conditions mean for this trip (omit this field entirely if no weather data was provided)",
  "places": [
    {
      "name": "string",
      "category": "sight" | "food" | "stay",
      "description": "string — 2 sentences about the place itself",
      "whyItMadeTheCut": "string — 1-2 sentences specific to this traveller's style, pace, and weather where relevant"
    }
  ]
}

Mix the categories: roughly 4 sights, 2 food, 2 stays. Be opinionated — name what makes each place worth it for THIS traveller.`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return Response.json({ error: 'Unexpected response type from Claude' }, { status: 500 })
    }

    const raw = content.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '')
    const parsed: RecommendationsResponse = JSON.parse(raw)

    // Fetch Google Places data for all places in parallel; individual failures degrade gracefully
    const googleDataResults = await Promise.allSettled(
      parsed.places.map((place) => fetchPlaceData(place.name, destination))
    )

    // Extract the per-place coordinates we just fetched, then run a single batched Distance Matrix call
    const placeLocations = googleDataResults.map((r) =>
      r.status === 'fulfilled' ? r.value.location : null
    )
    const transitResults: (TransitInfo | null)[] = coords
      ? await fetchTransitData(coords, placeLocations)
      : placeLocations.map(() => null)

    const places: Place[] = parsed.places.map((place, i) => {
      const data: PlaceGoogleData =
        googleDataResults[i].status === 'fulfilled'
          ? googleDataResults[i].value
          : { photoUrl: null, rating: null, userRatingCount: null, reviews: [], location: null }

      const transit = transitResults[i]

      return {
        ...place,
        photoUrl: data.photoUrl ?? undefined,
        rating: data.rating ?? undefined,
        userRatingCount: data.userRatingCount ?? undefined,
        reviews: data.reviews.length > 0 ? data.reviews : undefined,
        ...(transit && {
          distanceText: transit.distanceText,
          distanceMeters: transit.distanceMeters,
          durationText: transit.durationText,
          transitLabel: transit.transitLabel,
        }),
      }
    })

    return Response.json({ places, weatherSummary: parsed.weatherSummary })
  } catch (err) {
    console.error('Recommend API error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
