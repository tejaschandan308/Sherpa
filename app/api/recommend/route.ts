import Anthropic from '@anthropic-ai/sdk'

interface RequestBody {
  destination: string
  startDate: string
  endDate: string
  travelStyles: string[]
  pace: string
}

export interface Place {
  name: string
  category: 'sight' | 'food' | 'stay'
  description: string
  whyItMadeTheCut: string
  photoUrl?: string
}

export interface RecommendationsResponse {
  places: Place[]
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Fetches one photo URL for a named place using the Google Places API (New).
// Returns null if the place isn't found or any request fails — callers should
// treat a missing photo as a graceful fallback, not an error.
async function fetchPlacePhoto(placeName: string, destination: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    // Step 1: text search to get the photo resource name
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.photos',
      },
      body: JSON.stringify({ textQuery: `${placeName} ${destination}` }),
    })

    if (!searchRes.ok) return null

    const searchData = await searchRes.json()
    const photoName: string | undefined = searchData.places?.[0]?.photos?.[0]?.name
    if (!photoName) return null

    // Step 2: fetch the photo URI (skipHttpRedirect returns JSON instead of a 302)
    const mediaRes = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=600&skipHttpRedirect=true`,
      { headers: { 'X-Goog-Api-Key': apiKey } }
    )

    if (!mediaRes.ok) return null

    const mediaData = await mediaRes.json()
    return typeof mediaData.photoUri === 'string' ? mediaData.photoUri : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const body: RequestBody = await request.json()
  const { destination, startDate, endDate, travelStyles, pace } = body

  const styleList = travelStyles.length > 0 ? travelStyles.join(', ') : 'general interest'

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are Sherpa, an opinionated travel co-pilot for solo travellers. You curate a tight shortlist of places worth visiting — not a generic tourist guide. You prioritise authenticity over popularity and always explain your reasoning in terms of the specific traveller's style.

Your output must be ONLY valid JSON, with no explanation, no markdown, and no code fences — just the raw JSON object.`,
      messages: [
        {
          role: 'user',
          content: `Plan a trip to ${destination} from ${startDate} to ${endDate}.

Traveller profile:
- Style tags: ${styleList}
- Pace preference: ${pace}

Return exactly 8 recommended places as JSON in this exact format:
{
  "places": [
    {
      "name": "string",
      "category": "sight" | "food" | "stay",
      "description": "string — 2 sentences about the place itself",
      "whyItMadeTheCut": "string — 1-2 sentences specific to this traveller's style tags and pace"
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

    // Fetch one photo per place in parallel; individual failures return null gracefully
    const photoResults = await Promise.allSettled(
      parsed.places.map((place) => fetchPlacePhoto(place.name, destination))
    )

    const places: Place[] = parsed.places.map((place, i) => ({
      ...place,
      photoUrl: photoResults[i].status === 'fulfilled' ? (photoResults[i].value ?? undefined) : undefined,
    }))

    return Response.json({ places })
  } catch (err) {
    console.error('Recommend API error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
