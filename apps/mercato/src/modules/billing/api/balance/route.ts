import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CreditService } from '../../services/credit-service'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['billing.view'] } }

export async function GET(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const creditService = new CreditService(knex)

    const balance = await creditService.getBalance(auth.orgId)
    const packages = await knex('credit_packages').where('is_active', true).orderBy('sort_order')

    return NextResponse.json({ ok: true, data: { balance, packages } })
  } catch (error) {
    console.error('[billing.balance]', error)
    return NextResponse.json({ ok: false, error: 'Failed to get balance' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Billing', summary: 'Credit balance',
  methods: { GET: { summary: 'Get credit balance and packages', tags: ['Billing'] } },
}
