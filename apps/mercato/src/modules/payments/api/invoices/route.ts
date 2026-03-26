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
    const url = new URL(req.url)
    const status = url.searchParams.get('status')

    let query = knex('invoices')
      .where('tenant_id', auth.tenantId)
      .where('organization_id', auth.orgId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')

    if (status) query = query.where('status', status)

    const invoices = await query.limit(50)
    return NextResponse.json({ ok: true, data: invoices })
  } catch (error) {
    console.error('[payments.invoices.list]', error)
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

    const { contactId, dealId, lineItems, notes, dueDate, currency } = body
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json({ ok: false, error: 'At least one line item required' }, { status: 400 })
    }

    // Calculate totals
    const subtotal = lineItems.reduce((sum: number, item: any) => sum + (Number(item.price) * (item.quantity || 1)), 0)
    const tax = 0 // TODO: tax calculation
    const total = subtotal + tax

    // Generate invoice number
    const [{ count }] = await knex('invoices')
      .where('organization_id', auth.orgId)
      .count()
    const invoiceNumber = `INV-${String(Number(count) + 1).padStart(4, '0')}`

    const id = require('crypto').randomUUID()
    await knex('invoices').insert({
      id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId,
      invoice_number: invoiceNumber,
      contact_id: contactId || null,
      deal_id: dealId || null,
      status: 'draft',
      line_items: JSON.stringify(lineItems),
      subtotal, tax, total,
      currency: currency || 'USD',
      due_date: dueDate || null,
      notes: notes || null,
      created_at: new Date(),
      updated_at: new Date(),
    })

    const invoice = await knex('invoices').where('id', id).first()
    return NextResponse.json({ ok: true, data: invoice }, { status: 201 })
  } catch (error) {
    console.error('[payments.invoices.create]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payments', summary: 'Invoices',
  methods: {
    GET: { summary: 'List invoices', tags: ['Payments'] },
    POST: { summary: 'Create invoice', tags: ['Payments'] },
  },
}
