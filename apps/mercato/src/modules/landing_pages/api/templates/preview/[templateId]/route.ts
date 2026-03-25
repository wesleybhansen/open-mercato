import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { TEMPLATES_DIR } from '../../../../services/paths'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request, ctx: any) {
  const templateId = ctx?.params?.templateId
  if (!templateId) {
    return new NextResponse('Not found', { status: 404 })
  }

  const htmlPath = path.join(TEMPLATES_DIR, templateId, 'index.html')
  if (!fs.existsSync(htmlPath)) {
    return new NextResponse('Template not found', { status: 404 })
  }

  const html = fs.readFileSync(htmlPath, 'utf-8')

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Landing Pages',
  summary: 'Template preview',
  methods: { GET: { summary: 'Preview a template', tags: ['Landing Pages'] } },
}
