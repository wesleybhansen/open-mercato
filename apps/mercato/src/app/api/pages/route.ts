import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { query, queryOne } from '@/app/api/funnels/db'
import crypto from 'crypto'

export async function GET() {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const pages = await query(
      'SELECT * FROM landing_pages WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [auth.orgId]
    )
    return NextResponse.json({ ok: true, data: pages })
  } catch (error) {
    console.error('[pages.list]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { title, slug, templateId, templateCategory, config } = body

    if (!title?.trim() || !slug?.trim()) return NextResponse.json({ ok: false, error: 'Title and slug are required' }, { status: 400 })

    const existing = await queryOne('SELECT id FROM landing_pages WHERE slug = $1 AND organization_id = $2 AND deleted_at IS NULL', [slug, auth.orgId])
    if (existing) return NextResponse.json({ ok: false, error: 'A page with this slug already exists' }, { status: 409 })

    const id = crypto.randomUUID()
    const now = new Date()

    await query(
      'INSERT INTO landing_pages (id, tenant_id, organization_id, title, slug, template_id, template_category, config, status, owner_user_id, view_count, submission_count, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [id, auth.tenantId, auth.orgId, title.trim(), slug.trim(), templateId || null, templateCategory || null, config ? JSON.stringify(config) : null, 'draft', auth.sub, 0, 0, now, now]
    )

    // Create default form
    await query(
      'INSERT INTO landing_page_forms (id, tenant_id, organization_id, landing_page_id, name, fields, success_message, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [crypto.randomUUID(), auth.tenantId, auth.orgId, id, 'default', JSON.stringify([
        { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Your name' },
        { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
      ]), "Thank you! We'll be in touch.", now, now]
    )

    const page = await queryOne('SELECT * FROM landing_pages WHERE id = $1', [id])
    return NextResponse.json({ ok: true, data: page }, { status: 201 })
  } catch (error) {
    console.error('[pages.create]', error)
    const msg = error instanceof Error ? error.message : 'Failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
