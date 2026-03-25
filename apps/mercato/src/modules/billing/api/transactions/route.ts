import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['billing.view'] } }

export async function GET(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const url = new URL(req.url)

    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20')
    const service = url.searchParams.get('service')

    let query = knex('credit_transactions').where('organization_id', auth.orgId)
    if (service) query = query.where('service', service)

    const [{ count: total }] = await query.clone().count()
    const transactions = await query.select('*').orderBy('created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize)

    return NextResponse.json({ ok: true, data: transactions, pagination: { page, pageSize, total: Number(total) } })
  } catch (error) {
    console.error('[billing.transactions]', error)
    return NextResponse.json({ ok: false, error: 'Failed to get transactions' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Billing', summary: 'Credit transactions',
  methods: { GET: { summary: 'List credit transactions', tags: ['Billing'] } },
}
