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
}

export interface RecommendationsResponse {
  places: Place[]
}

// Internal shape of data fetched from Google Places per place
interface PlaceGoogleData {
  photoUrl: string | null
  rating: number | null
  userRatingCount: number | null
  reviews: PlaceReview[]
}

// Loosely typed to match whatever the Places API returns before we normalise it
interface GoogleReview {
  rating?: number
  text?: { text?: string }
  originalText?: { text?: string }
  relativePublishTimeDescription?: string
  authorAttribution?: { displayName?: string }
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Strips the surname down to an initial for privacy: "Jane Doe" → "Jane D."
function formatAuthorName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// Fetches photo, rating, review count, and up to 3 reviews for a place.
// All fields return null / empty on any failure so callers degrade gracefully.
async function fetchPlaceData(placeName: string, destination: string): Promise<PlaceGoogleData> {
  const empty: PlaceGoogleData = { photoUrl: null, rating: null, userRatingCount: null, reviews: [] }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return empty

  try {
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.photos,places.rating,places.userRatingCount,places.reviews',
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

    return {
      photoUrl,
      rating: typeof googlePlace.rating === 'number' ? googlePlace.rating : null,
      userRatingCount: typeof googlePlace.userRatingCount === 'number' ? googlePlace.userRatingCount : null,
      reviews,
    }
  } catch {
    return empty
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

    // Fetch Google Places data for all places in parallel; individual failures degrade gracefully
    const googleDataResults = await Promise.allSettled(
      parsed.places.map((place) => fetchPlaceData(place.name, destination))
    )

    const places: Place[] = parsed.places.map((place, i) => {
      const data: PlaceGoogleData =
        googleDataResults[i].status === 'fulfilled'
          ? googleDataResults[i].value
          : { photoUrl: null, rating: null, userRatingCount: null, reviews: [] }

      return {
        ...place,
        photoUrl: data.photoUrl ?? undefined,
        rating: data.rating ?? undefined,
        userRatingCount: data.userRatingCount ?? undefined,
        reviews: data.reviews.length > 0 ? data.reviews : undefined,
      }
    })

    return Response.json({ places })
  } catch (err) {
    console.error('Recommend API error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
