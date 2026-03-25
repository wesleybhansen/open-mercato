import { NextResponse } from 'next/server'
import { TemplateEngine } from '../../services/template-engine'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['landing_pages.view'] },
}

export async function GET() {
  try {
    const engine = new TemplateEngine()
    const grouped = engine.getTemplatesByCategory()

    return NextResponse.json({
      ok: true,
      data: grouped,
      total: Object.values(grouped).flat().length,
    })
  } catch (error) {
    console.error('[landing_pages.templates.list] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to list templates' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Landing Pages',
  summary: 'List available templates',
  methods: {
    GET: { summary: 'List landing page templates grouped by category', tags: ['Landing Pages'] },
  },
}
