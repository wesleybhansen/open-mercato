import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['payments.view'] },
  POST: { requireAuth: true, requireFeatures: ['payments.create'] },
}

export async function GET(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()

    const products = await knex('products')
      .where('tenant_id', auth.tenantId)
      .where('organization_id', auth.orgId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')

    return NextResponse.json({ ok: true, data: products })
  } catch (error) {
    console.error('[payments.products.list]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const body = await req.json()

    const { name, description, price, currency, billingType, recurringInterval } = body
    if (!name || !price) return NextResponse.json({ ok: false, error: 'name and price required' }, { status: 400 })

    const id = require('crypto').randomUUID()
    await knex('products').insert({
      id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId,
      name,
      description: description || null,
      price: Number(price),
      currency: currency || 'USD',
      billing_type: billingType || 'one_time',
      recurring_interval: recurringInterval || null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    })

    const product = await knex('products').where('id', id).first()
    return NextResponse.json({ ok: true, data: product }, { status: 201 })
  } catch (error) {
    console.error('[payments.products.create]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payments', summary: 'Products',
  methods: {
    GET: { summary: 'List products', tags: ['Payments'] },
    POST: { summary: 'Create product', tags: ['Payments'] },
  },
}
