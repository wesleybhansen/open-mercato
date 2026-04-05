import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function GET() {
  try {
    await bootstrap()
    const auth = await getAuthFromCookies()
    if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const contacts = await knex('customer_entities')
      .where('organization_id', auth.orgId)
      .where('kind', 'person')
      .whereNotNull('primary_email')
      .whereNull('deleted_at')
      .select('id', 'display_name', 'primary_email')
      .orderBy('display_name', 'asc')
      .limit(500)

    return NextResponse.json({ ok: true, data: contacts })
  } catch (error) {
    console.error('[email-lists.contacts]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}
