import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { query, queryOne } from '@/app/api/funnels/db'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const page = await queryOne('SELECT * FROM landing_pages WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [id, auth.orgId])
    if (!page) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

    const forms = await query('SELECT * FROM landing_page_forms WHERE landing_page_id = $1', [id])
    const submissions = await query('SELECT * FROM form_submissions WHERE landing_page_id = $1 ORDER BY created_at DESC LIMIT 20', [id])

    return NextResponse.json({ ok: true, data: { ...page, forms, recentSubmissions: submissions } })
  } catch (error) {
    console.error('[pages.get]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const page = await queryOne('SELECT * FROM landing_pages WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [id, auth.orgId])
    if (!page) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const sets: string[] = ['updated_at = $1']
    const vals: any[] = [new Date()]
    let idx = 2

    if (body.title !== undefined) { sets.push(`title = $${idx}`); vals.push(body.title); idx++ }
    if (body.slug !== undefined) { sets.push(`slug = $${idx}`); vals.push(body.slug); idx++ }
    if (body.config !== undefined) { sets.push(`config = $${idx}`); vals.push(JSON.stringify(body.config)); idx++ }
    if (body.publishedHtml !== undefined) { sets.push(`published_html = $${idx}`); vals.push(body.publishedHtml); idx++ }
    if (body.status !== undefined) {
      sets.push(`status = $${idx}`); vals.push(body.status); idx++
      if (body.status === 'published' && page.status !== 'published') {
        sets.push(`published_at = $${idx}`); vals.push(new Date()); idx++
      }
      if (body.status === 'draft' || body.status === 'archived') {
        sets.push(`published_html = $${idx}`); vals.push(null); idx++
      }
    }

    vals.push(id)
    await query(`UPDATE landing_pages SET ${sets.join(', ')} WHERE id = $${idx}`, vals)

    // Update form if provided
    if (body.formFields) {
      const existingForm = await queryOne('SELECT id FROM landing_page_forms WHERE landing_page_id = $1', [id])
      if (existingForm) {
        await query('UPDATE landing_page_forms SET fields = $1, success_message = $2, redirect_url = $3, updated_at = $4 WHERE id = $5',
          [JSON.stringify(body.formFields), body.successMessage || "Thank you!", body.redirectUrl || null, new Date(), existingForm.id])
      }
    }

    const updated = await queryOne('SELECT * FROM landing_pages WHERE id = $1', [id])
    return NextResponse.json({ ok: true, data: updated })
  } catch (error) {
    console.error('[pages.update]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    await query('UPDATE landing_pages SET deleted_at = $1, status = $2, published_html = NULL WHERE id = $3 AND organization_id = $4',
      [new Date(), 'archived', id, auth.orgId])
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[pages.delete]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}
