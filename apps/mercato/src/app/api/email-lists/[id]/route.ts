import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap()
  const { id } = await params
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const list = await knex('email_lists')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .first()

    if (!list) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: list })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to fetch email list' }, { status: 500 })
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

    const existing = await knex('email_lists')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .first()

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const updates: Record<string, unknown> = { updated_at: new Date() }

    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.sourceType !== undefined) updates.source_type = body.sourceType

    await knex('email_lists').where('id', id).update(updates)

    const updated = await knex('email_lists').where('id', id).first()

    return NextResponse.json({ ok: true, data: updated })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to update email list' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap()
  const { id } = await params
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const existing = await knex('email_lists')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .first()

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    await knex('email_lists').where('id', id).delete()

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to delete email list' }, { status: 500 })
  }
}
