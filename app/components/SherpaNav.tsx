'use client'

import Link from 'next/link'

export default function SherpaNav() {
  return (
    <nav className="px-6 py-3 flex items-center justify-between border-b border-stone-200">
      <Link href="/">
        <span
          className="text-sm text-[#1A1A1A] italic"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Sherpa
        </span>
      </Link>
      <Link
        href="/trips"
        className="text-[10px] font-medium text-[#9A9087] uppercase hover:text-[#1A1A1A] transition-colors"
        style={{ letterSpacing: '0.18em' }}
      >
        My Trips
      </Link>
    </nav>
  )
}
