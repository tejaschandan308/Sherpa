'use client'

import Link from 'next/link'

export default function SherpaNav() {
  return (
    <nav className="px-8 py-6 flex items-center justify-between">
      <Link
        href="/"
        className="text-[#1A1A1A] text-xl font-bold tracking-tight hover:opacity-75 transition-opacity"
      >
        Sherpa
      </Link>
      <Link
        href="/trips"
        className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
      >
        My Trips
      </Link>
    </nav>
  )
}
