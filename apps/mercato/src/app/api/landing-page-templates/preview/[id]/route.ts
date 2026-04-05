import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

function resolveTemplatesDir(): string {
  const direct = path.join(process.cwd(), 'templates')
  if (fs.existsSync(direct)) return direct
  const nested = path.join(process.cwd(), 'apps', 'mercato', 'templates')
  if (fs.existsSync(nested)) return nested
  return direct
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const templatesDir = resolveTemplatesDir()
    const htmlPath = path.join(templatesDir, id, 'index.html')

    if (!fs.existsSync(htmlPath)) {
      return new Response('Template not found', { status: 404 })
    }

    const html = fs.readFileSync(htmlPath, 'utf-8')
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  } catch {
    return new Response('Error loading template', { status: 500 })
  }
}
