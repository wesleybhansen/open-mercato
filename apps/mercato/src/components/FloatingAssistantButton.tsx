'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

export function FloatingAssistantButton() {
  const pathname = usePathname()

  // Hide on the assistant page itself
  if (pathname === '/backend/assistant' || pathname?.startsWith('/backend/assistant/')) {
    return null
  }

  return (
    <Link
      href="/backend/assistant"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex items-center gap-1.5 sm:gap-2 rounded-full bg-accent px-3 py-2.5 sm:px-4 sm:py-3 text-white shadow-lg transition-all hover:shadow-xl hover:scale-105 active:scale-95"
      title="Open AI Assistant"
    >
      <Sparkles className="size-4 sm:size-5" />
      <span className="text-xs sm:text-sm font-medium">Scout</span>
    </Link>
  )
}
