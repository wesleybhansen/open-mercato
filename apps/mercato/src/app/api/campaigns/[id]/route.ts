import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap()
  const { id } = await params
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const campaign = await knex('email_campaigns')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .whereNull('deleted_at')
      .first()

    if (!campaign) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true, data: campaign })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap()
  const { id } = await params
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const campaign = await knex('email_campaigns')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .whereNull('deleted_at')
      .first()

    if (!campaign) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    if (campaign.status !== 'draft') return NextResponse.json({ ok: false, error: 'Only draft blasts can be edited' }, { status: 400 })

    const body = await req.json()
    const updates: Record<string, any> = {}

    if (body.name !== undefined) updates.name = body.name
    if (body.subject !== undefined) updates.subject = body.subject
    if (body.bodyHtml !== undefined) updates.body_html = body.bodyHtml
    if (body.segmentFilter !== undefined) updates.segment_filter = body.segmentFilter ? JSON.stringify(body.segmentFilter) : null
    if (body.templateId !== undefined) updates.template_id = body.templateId || null

    await knex('email_campaigns').where('id', id).update(updates)

    const updated = await knex('email_campaigns').where('id', id).first()
    return NextResponse.json({ ok: true, data: updated })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap()
  const { id } = await params
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const campaign = await knex('email_campaigns')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .whereNull('deleted_at')
      .first()

    if (!campaign) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

    await knex('email_campaigns').where('id', id).update({ deleted_at: new Date() })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}
