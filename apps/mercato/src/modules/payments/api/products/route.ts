import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['payments.view'] },
  POST: { requireAuth: true, requireFeatures: ['payments.create'] },
  PUT: { requireAuth: true, requireFeatures: ['payments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['payments.manage'] },
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

    const { name, description, price, currency, billingType, recurringInterval, termsUrl, requiresShipping, collectPhone, productType, courseIds, trialDays } = body
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
      terms_url: termsUrl || null,
      requires_shipping: requiresShipping ?? false,
      collect_phone: collectPhone ?? false,
      product_type: productType || 'digital',
      course_ids: courseIds ? JSON.stringify(courseIds) : '[]',
      trial_days: billingType === 'recurring' && trialDays ? Number(trialDays) : null,
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

export async function PUT(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const body = await req.json()

    const { id, name, description, price, billingType, termsUrl, courseIds, trialDays } = body
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    if (!name || !price) return NextResponse.json({ ok: false, error: 'name and price required' }, { status: 400 })

    await knex('products')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .whereNull('deleted_at')
      .update({
        name,
        description: description || null,
        price: Number(price),
        billing_type: billingType || 'one_time',
        terms_url: termsUrl || null,
        course_ids: courseIds !== undefined ? JSON.stringify(courseIds) : undefined,
        trial_days: billingType === 'recurring' && trialDays ? Number(trialDays) : null,
        updated_at: new Date(),
      })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payments.products.update]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    await knex('products')
      .where('id', id)
      .where('organization_id', auth.orgId)
      .update({ deleted_at: new Date(), updated_at: new Date() })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payments.products.delete]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payments', summary: 'Products',
  methods: {
    GET: { summary: 'List products', tags: ['Payments'] },
    POST: { summary: 'Create product', tags: ['Payments'] },
    PUT: { summary: 'Update product', tags: ['Payments'] },
    DELETE: { summary: 'Delete product (soft)', tags: ['Payments'] },
  },
}
