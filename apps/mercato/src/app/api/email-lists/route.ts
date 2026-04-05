import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function GET() {
  await bootstrap()
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const lists = await knex('email_lists')
      .where('organization_id', auth.orgId)
      .orderBy('created_at', 'desc')

    return NextResponse.json({ ok: true, data: lists })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to fetch email lists' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  await bootstrap()
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const body = await req.json()
    const { name, description, sourceType, triggerValues } = body

    if (!name) {
      return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 })
    }

    const id = require('crypto').randomUUID()
    const now = new Date()
    // Store trigger config in description as JSON suffix if auto-trigger is set
    let descText = description || null
    if (sourceType && sourceType !== 'manual' && triggerValues?.length) {
      descText = (description || '') + (description ? '\n' : '') + `[auto_trigger:${JSON.stringify(triggerValues)}]`
    }
    const newList = {
      id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId,
      name,
      description: descText,
      source_type: sourceType || 'manual',
      member_count: 0,
      created_at: now,
      updated_at: now,
    }

    await knex('email_lists').insert(newList)

    return NextResponse.json({ ok: true, data: newList }, { status: 201 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to create email list' }, { status: 500 })
  }
}
