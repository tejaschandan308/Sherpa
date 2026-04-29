@AGENTS.md



\# Sherpa — AI Travel Co-Pilot



\## Project context



Sherpa is an AI-powered trip planner for solo travellers. Users enter their destination, dates, and travel style. Sherpa returns a researched, weather-aware, distance-aware shortlist of what's worth doing — with reasoning shown.



\## Tech stack



\- Next.js 15 (App Router)

\- TypeScript

\- Tailwind CSS

\- Claude API (for AI reasoning)

\- Google Maps API (places, photos, reviews, distances)

\- OpenWeather API (forecasts)

\- Browser local storage (no database in v1)



\## Coding preferences



\- I'm new to development — explain what code does as you write it

\- Use Tailwind utility classes only (no separate CSS files)

\- Default to functional React components with hooks

\- Keep components in `app/` (App Router structure)

\- Use TypeScript strictly — no `any` types

\- Add brief comments above non-trivial functions



\## What's built



\- Project initialised, deployed to sherpa-bice.vercel.app

\- Auto-deploy from GitHub `main` branch

\- Environment variables set in Vercel



\## What we're building next



Trip setup form — collects destination, dates, travel style tags, and pace preference. No AI integration yet. Just capture the form input and console.log it for now.



\## Things NOT to do



\- Don't pull in external UI libraries (no shadcn, no Radix, etc) yet — keep dependencies minimal

\- Don't add auth — v1 uses browser local storage

\- Don't restructure folders without asking

