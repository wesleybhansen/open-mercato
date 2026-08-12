export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['payments.create'] },
}

import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  buildStripeIdempotencyKey,
  buildStripeSuccessUrl,
  isStripeAccountId,
  readHttpsUrl,
  readPositiveAmount,
  readStripeRequestScope,
  resolveAppBaseUrl,
} from '@/modules/payments/lib/stripe-integrity'

type CheckoutBody = {
  type?: unknown
  productId?: unknown
  invoiceId?: unknown
  customerEmail?: unknown
}

type LineItem = {
  price_data: {
    currency: string
    product_data: { name: string; description?: string }
    unit_amount: number
    recurring?: { interval: string }
  }
  quantity: number
}

function stringValue(value: unknown, max = 255): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function invoiceLineItems(value: unknown, currency: string): LineItem[] | null {
  const items = typeof value === 'string'
    ? (() => { try { return JSON.parse(value) } catch { return null } })()
    : value
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return null
  const result: LineItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as Record<string, unknown>
    const name = stringValue(item.name)
    const price = readPositiveAmount(Number(item.price))
    const quantity = Number(item.quantity ?? 1)
    if (!name || price === null || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000) return null
    result.push({
      price_data: {
        currency,
        product_data: { name },
        unit_amount: Math.round(price * 100),
      },
      quantity,
    })
  }
  return result
}

export async function POST(req: Request) {
  const scope = readStripeRequestScope(await getAuthFromCookies())
  if (!scope) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const baseUrl = resolveAppBaseUrl(process.env.APP_URL)
  if (!stripeKey || !baseUrl) {
    return NextResponse.json({ ok: false, error: 'Stripe is not configured' }, { status: 503 })
  }

  const body = await readJsonSafe<CheckoutBody>(req)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  }

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const stripeConnection = await knex('stripe_connections')
      .where('organization_id', scope.organizationId)
      .where('tenant_id', scope.tenantId)
      .where('is_active', true)
      .first()
    if (!stripeConnection || !isStripeAccountId(stripeConnection.stripe_account_id)) {
      return NextResponse.json({ ok: false, error: 'Connect Stripe before accepting payments' }, { status: 409 })
    }

    const type = body.type
    const productId = stringValue(body.productId)
    const invoiceId = stringValue(body.invoiceId)
    const customerEmail = typeof body.customerEmail === 'string' && body.customerEmail.trim().length <= 320
      ? body.customerEmail.trim()
      : undefined
    const metadata: Record<string, string> = {
      orgId: scope.organizationId,
      tenantId: scope.tenantId,
      connectedAccount: stripeConnection.stripe_account_id,
    }

    let lineItems: LineItem[]
    let isSubscription = false
    let termsUrl: string | null = null
    let resourceId: string
    let resourceRevision: string
    let trialDays: number | null = null

    if (type === 'product' && productId) {
      const product = await knex('products')
        .where('id', productId)
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .whereNull('deleted_at')
        .first()
      const price = readPositiveAmount(Number(product?.price))
      const name = stringValue(product?.name)
      if (!product || price === null || !name) {
        return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 })
      }
      const currency = stringValue(product.currency, 3)?.toLowerCase()
      if (!currency || !/^[a-z]{3}$/.test(currency)) {
        return NextResponse.json({ ok: false, error: 'Product currency is invalid' }, { status: 409 })
      }
      isSubscription = product.billing_type === 'recurring'
      const recurringInterval = isSubscription ? stringValue(product.recurring_interval || 'month', 16) : null
      if (isSubscription && !recurringInterval) {
        return NextResponse.json({ ok: false, error: 'Product billing interval is invalid' }, { status: 409 })
      }
      lineItems = [{
        price_data: {
          currency,
          product_data: {
            name,
            ...(stringValue(product.description, 500) ? { description: stringValue(product.description, 500)! } : {}),
          },
          unit_amount: Math.round(price * 100),
          ...(recurringInterval ? { recurring: { interval: recurringInterval } } : {}),
        },
        quantity: 1,
      }]
      metadata.productId = product.id
      metadata.type = 'product'
      termsUrl = readHttpsUrl(product.terms_url)
      resourceId = product.id
      resourceRevision = new Date(product.updated_at).toISOString()
      trialDays = Number.isSafeInteger(product.trial_days) && product.trial_days > 0 && product.trial_days <= 730
        ? product.trial_days
        : null
    } else if (type === 'invoice' && invoiceId) {
      const invoice = await knex('invoices')
        .where('id', invoiceId)
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .whereNull('deleted_at')
        .first()
      if (!invoice) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })
      const currency = stringValue(invoice.currency, 3)?.toLowerCase()
      if (!currency || !/^[a-z]{3}$/.test(currency)) {
        return NextResponse.json({ ok: false, error: 'Invoice currency is invalid' }, { status: 409 })
      }
      const parsedItems = invoiceLineItems(invoice.line_items, currency)
      if (!parsedItems) return NextResponse.json({ ok: false, error: 'Invoice lines are invalid' }, { status: 409 })
      lineItems = parsedItems
      metadata.invoiceId = invoice.id
      metadata.type = 'invoice'
      termsUrl = readHttpsUrl(invoice.terms_url)
      resourceId = invoice.id
      resourceRevision = new Date(invoice.updated_at).toISOString()
    } else {
      return NextResponse.json({ ok: false, error: 'A product or invoice is required' }, { status: 400 })
    }

    if (!termsUrl) {
      const profile = await knex('business_profiles')
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .first()
      termsUrl = readHttpsUrl(profile?.terms_url)
    }

    const sessionParams: Record<string, unknown> = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: buildStripeSuccessUrl(baseUrl),
      cancel_url: `${baseUrl}/backend/payments`,
      metadata,
      customer_email: customerEmail,
    }
    if (isSubscription) {
      sessionParams.subscription_data = {
        metadata,
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      }
    }
    if (termsUrl) {
      sessionParams.consent_collection = { terms_of_service: 'required' }
      sessionParams.custom_text = {
        terms_of_service_acceptance: { message: `I agree to the [Terms of Service](${termsUrl})` },
      }
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 10_000 })
    const idempotencyKey = buildStripeIdempotencyKey('checkout', scope, [
      type,
      resourceId,
      resourceRevision,
      customerEmail || null,
    ])
    const session = await stripe.checkout.sessions.create(sessionParams, {
      stripeAccount: stripeConnection.stripe_account_id,
      idempotencyKey,
    })
    if (!session.url) return NextResponse.json({ ok: false, error: 'Stripe did not return a checkout URL' }, { status: 502 })

    if (type === 'invoice' && invoiceId) {
      const changed = await knex('invoices')
        .where('id', invoiceId)
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .whereNull('deleted_at')
        .update({ stripe_payment_link: session.url, updated_at: new Date() })
      if (changed !== 1) return NextResponse.json({ ok: false, error: 'Invoice changed during checkout creation' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.id })
  } catch {
    return NextResponse.json({ ok: false, error: 'Stripe checkout failed' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payments',
  summary: 'Create a tenant-bound Stripe Checkout Session',
  methods: {
    POST: { summary: 'Create checkout for an owned product or invoice', tags: ['Payments'] },
  },
}
