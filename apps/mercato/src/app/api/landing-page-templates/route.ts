import { NextResponse } from 'next/server'
import { TemplateEngine } from '@/modules/landing_pages/services/template-engine'

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
    console.error('[templates.list]', error)
    return NextResponse.json({ ok: false, error: 'Failed to list templates' }, { status: 500 })
  }
}
