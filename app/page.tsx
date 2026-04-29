import TripForm from './TripForm'

// Layered mountain silhouette illustration — purely decorative, uses warm muted tones
function MountainIllustration() {
  return (
    <svg
      viewBox="0 0 480 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full"
      aria-hidden="true"
    >
      {/* Distant range — lightest */}
      <path
        d="M0 280 L110 88 L192 168 L296 38 L392 118 L480 78 L480 280Z"
        fill="#E4DFD6"
      />
      {/* Mid range */}
      <path
        d="M0 280 L78 152 L162 206 L264 98 L358 164 L480 128 L480 280Z"
        fill="#D5CEBF"
      />
      {/* Foreground range — richest */}
      <path
        d="M0 280 L56 196 L144 230 L228 154 L314 200 L410 166 L480 184 L480 280Z"
        fill="#C6BEB0"
      />
      {/* Winding trail */}
      <path
        d="M162 280 Q194 254 212 234 Q231 212 248 196 Q265 180 280 165"
        stroke="#ADA69A"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      {/* Hiker at trail end */}
      <circle cx="280" cy="165" r="3.5" fill="#ADA69A" />
    </svg>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#FAFAF7]">

      {/* Wordmark — top-left, feels like a real product nav */}
      <nav className="px-8 py-6">
        <span className="text-[#1A1A1A] text-xl font-bold tracking-tight">Sherpa</span>
      </nav>

      {/* Hero — big headline + illustration side by side */}
      <section className="max-w-5xl mx-auto px-8 pt-6 pb-20 flex items-center gap-16">
        <div className="flex-1">
          <h1 className="text-6xl font-bold text-[#1A1A1A] leading-[1.1] tracking-tight">
            Your trip
            <br />
            co-pilot.
          </h1>
          <p className="mt-5 text-xl text-[#6B6B6B] leading-relaxed max-w-sm">
            Tell me where you're going. I'll tell you what's actually worth your time.
          </p>
        </div>

        {/* Illustration hidden on small screens so the form isn't crowded */}
        <div className="hidden lg:block w-80 xl:w-96 flex-shrink-0 opacity-75">
          <MountainIllustration />
        </div>
      </section>

      {/* Form section */}
      <section className="max-w-xl mx-auto px-8 pb-24">
        <p className="text-xs font-semibold tracking-widest uppercase text-[#9A9087] mb-6">
          Plan your trip
        </p>
        <TripForm />
      </section>

    </main>
  )
}
