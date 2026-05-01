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

export interface SmartNote {
  type: string
  text: string
}

export interface RecommendationsResponse {
  places: Place[]
  weatherSummary?: string
  smartNotes?: SmartNote[]
  destinationAdverb?: string
  tripFrame?: string
  temperatureRange?: string
  weatherKicker?: string
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

// Fetches a hero photo for the destination by trying multiple search queries in order.
// Logs each step so failures are visible in server logs. Returns null if all queries fail.
async function fetchDestinationHeroPhotoUrl(destination: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  // Broadest-first: city gives the richest photo pool; landmark/tourism are narrower fallbacks
  const queries = [`${destination} city`, `${destination} landmark`, destination]

  for (const query of queries) {
    try {
      const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.photos,places.displayName',
        },
        body: JSON.stringify({ textQuery: query }),
      })

      if (!searchRes.ok) {
        console.warn(`[hero] searchText HTTP ${searchRes.status} for query: "${query}"`)
        continue
      }

      const searchData = await searchRes.json()
      const photoName: string | undefined = searchData.places?.[0]?.photos?.[0]?.name

      if (!photoName) {
        console.log(`[hero] no photos returned for query: "${query}"`)
        continue
      }

      const mediaRes = await fetch(
        `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1600&skipHttpRedirect=true`,
        { headers: { 'X-Goog-Api-Key': apiKey } }
      )

      if (!mediaRes.ok) {
        console.warn(`[hero] media fetch HTTP ${mediaRes.status} for query: "${query}"`)
        continue
      }

      const mediaData = await mediaRes.json()
      if (typeof mediaData.photoUri === 'string') {
        console.log(`[hero] success with query: "${query}"`)
        return mediaData.photoUri
      }

      console.warn(`[hero] no photoUri in media response for query: "${query}"`)
    } catch (err) {
      console.error(`[hero] error for query "${query}":`, err)
    }
  }

  console.warn(`[hero] all queries exhausted for destination: "${destination}"`)
  return null
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

After building the place list, write 2–4 smartNotes. Use these types:
- "cluster": places close enough to visit in one go
- "day_trip": a place warranting a dedicated full day
- "warning": a closure day, crowd issue, or combination that wastes time
- "timing": a specific time when a place is meaningfully better

STRICT RULES for each note's "text" field:
- 15 words OR FEWER. Count them. No exceptions.
- One sentence only. No semicolons joining multiple clauses.
- Direct statement. No "you can", "you'll find", "make sure to", "remember to".
- Must reference an actual place name from the recommendations.

CORRECT examples (count the words — all under 15):
- "Gruut, Vrijdagmarkt, and Publiek — all within a 10-minute walk." (11 words)
- "Graslei at 8pm in May. After the boats dock." (9 words)
- "SMAK is closed Mondays. Don't plan a rainy-day escape there." (10 words)
- "Dok Noord deserves a full afternoon, not a detour." (9 words)

WRONG examples (too long — do not produce notes like these):
- "Gruut Brewery, Vrijdagmarkt, and Publiek restaurant are all within a 10-minute walk of each other in the old centre. Stack them into one evening: early dinner at Publiek, then a tasting flight at Gruut."
- "Graslei is genuinely stunning at golden hour — show up around 8pm in early May when the light hits the guild houses perfectly."

Quality over quantity. 2 sharp notes beats 4 mediocre ones. If you cannot make a useful note in 15 words, omit it.

Also generate these editorial fields:
- destinationAdverb: A single word capturing how this traveller should move through this destination. Ground it in their style tags and the destination's character. One word only, no punctuation, no exclamation marks. Examples: Lisbon + foodie/nature → "slowly"; Tokyo + night owl → "electric"; Spiti + nature seeker → "quietly"; Kyoto + slow travel → "deliberately".
- tripFrame: One confident magazine-style sentence, present tense, 5–8 words, ends with a period. No filler adjectives. Examples: "An eight-day walking week."; "Five nights, two neighborhoods."; "A slow loop through Honshu."
- temperatureRange: A clean temperature string using an em-dash (—), not a hyphen. Example: "18° — 24°". Use the trip's actual weather context when provided; otherwise use your seasonal knowledge for the destination and month.
- weatherKicker: A punchy 6-10 word phrase summarising the weather conditions for this trip. One clause, no period, all lowercase except temperatures or proper nouns. Different from weatherSummary — this is a kicker, not prose. Examples: "warm afternoons, cool evenings, three rainy days"; "hot and dry, classic Mediterranean May"; "crisp dry days, sub-zero nights at altitude"; "mostly sunny with one unsettled afternoon". Omit this field entirely if no weather data was provided.

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
  "destinationAdverb": "string — single word, no punctuation",
  "tripFrame": "string — 5-8 word magazine sentence, present tense, ends with period",
  "temperatureRange": "string — e.g. \"18° — 24°\" using em-dash",
  "weatherKicker": "string — 6-10 word punchy phrase, no period, all lowercase (omit entirely if no weather data was provided)",
  "weatherSummary": "string — 1-2 sentences on what the conditions mean for this trip (omit this field entirely if no weather data was provided)",
  "smartNotes": [
    { "type": "cluster" | "day_trip" | "warning" | "timing", "text": "string — casual, specific, actionable. Reference actual place names." }
  ],
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

    // Fetch hero photo + all place data in parallel; individual failures degrade gracefully
    const allFetchResults = await Promise.allSettled([
      fetchDestinationHeroPhotoUrl(destination),
      ...parsed.places.map((place) => fetchPlaceData(place.name, destination)),
    ])
    const heroPhotoResult = allFetchResults[0] as PromiseSettledResult<string | null>
    const googleDataResults = allFetchResults.slice(1) as PromiseSettledResult<PlaceGoogleData>[]

    // Hero photo: destination search result → first place's photo → undefined (no image)
    const heroPhotoFromSearch =
      heroPhotoResult.status === 'fulfilled' ? heroPhotoResult.value : null
    if (heroPhotoResult.status === 'rejected') {
      console.error('[hero] destination fetch rejected:', heroPhotoResult.reason)
    }
    const heroPhotoFallback =
      googleDataResults[0]?.status === 'fulfilled' ? googleDataResults[0].value.photoUrl : null
    if (!heroPhotoFromSearch) {
      console.log(`[hero] using fallback: ${heroPhotoFallback ? 'first place photo' : 'none — no image will show'}`)
    }
    const destinationHeroPhotoUrl = heroPhotoFromSearch ?? heroPhotoFallback ?? undefined

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

    return Response.json({
      places,
      weatherSummary: parsed.weatherSummary,
      weatherKicker: parsed.weatherKicker,
      smartNotes: parsed.smartNotes ?? [],
      destinationAdverb: parsed.destinationAdverb,
      tripFrame: parsed.tripFrame,
      temperatureRange: parsed.temperatureRange,
      destinationHeroPhotoUrl,
    })
  } catch (err) {
    console.error('Recommend API error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
