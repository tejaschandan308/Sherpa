import Link from 'next/link'
import TripForm from './TripForm'

// Layered mountain silhouette — decorative hero element
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
      {/* Hiker dot at trail end */}
      <circle cx="280" cy="165" r="3.5" fill="#ADA69A" />
    </svg>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#FAFAF7]">

      {/* Editorial header strip */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-stone-200">
        <span
          className="text-sm text-[#1A1A1A] italic"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Sherpa
        </span>
        <Link
          href="/trips"
          className="text-[10px] font-medium text-[#9A9087] uppercase hover:text-[#1A1A1A] transition-colors"
          style={{ letterSpacing: '0.18em' }}
        >
          My Trips
        </Link>
      </div>

      {/* Hero — headline + illustration */}
      <section className="max-w-5xl mx-auto px-8 pt-12 pb-16 flex items-center gap-16">
        <div className="flex-1">
          <h1
            className="text-5xl md:text-6xl text-[#1A1A1A] leading-[1.1] font-bold"
          >
            Skip the 14
            <br />
            browser tabs.
          </h1>
          <p className="mt-5 text-lg text-[#6B6B6B] leading-relaxed max-w-sm">
            Tell me where. I&rsquo;ll tell you what&rsquo;s worth it.
          </p>
        </div>

        {/* Illustration: decorative, hidden on small screens */}
        <div className="hidden lg:block w-80 xl:w-96 flex-shrink-0 opacity-90">
          <MountainIllustration />
        </div>
      </section>

      {/* Form section */}
      <section className="max-w-xl mx-auto px-8 pb-24">
        <p
          className="text-[10px] font-medium text-[#999] uppercase mb-6"
          style={{ letterSpacing: '0.2em' }}
        >
          Plan your trip
        </p>
        <TripForm />
      </section>

    </main>
  )
}
