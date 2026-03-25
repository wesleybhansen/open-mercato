import { NextResponse } from 'next/server'
import { AIPageBuilder } from '../../../services/ai-page-builder'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['landing_pages.create'] },
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ ok: false, error: 'messages array required' }, { status: 400 })
    }

    const builder = new AIPageBuilder()
    const response = await builder.chat(messages)

    const isReady = response.includes('---READY---')

    return NextResponse.json({
      ok: true,
      message: response.replace('---READY---', '').trim(),
      ready: isReady,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[landing_pages.ai.chat]', msg, error)
    return NextResponse.json({ ok: false, error: `AI chat failed: ${msg}` }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Landing Pages', summary: 'AI chat for page building',
  methods: { POST: { summary: 'Chat with AI to gather page context', tags: ['Landing Pages'] } },
}
