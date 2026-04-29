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
}

export interface RecommendationsResponse {
  places: Place[]
}

// Initialise once at module level so the connection is reused across requests
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

    // Claude should return raw JSON, but strip markdown code fences defensively
    const raw = content.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '')

    const parsed: RecommendationsResponse = JSON.parse(raw)
    return Response.json(parsed)
  } catch (err) {
    console.error('Anthropic API error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
