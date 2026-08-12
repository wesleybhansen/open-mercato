export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['payments.manage'] },
}

import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  buildStripeIdempotencyKey,
  isStripeAccountId,
  isStripeSubscriptionId,
  readConnectedAccountFromMetadata,
  readStripeRequestScope,
} from '@/modules/payments/lib/stripe-integrity'

type CancelBody = {
  subscriptionId?: unknown
  cancelAtPeriodEnd?: unknown
}

export async function POST(req: Request) {
  const scope = readStripeRequestScope(await getAuthFromCookies())
  if (!scope) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ ok: false, error: 'Stripe is not configured' }, { status: 503 })

  const body = await readJsonSafe<CancelBody>(req)
  if (!isStripeSubscriptionId(body?.subscriptionId) || typeof body?.cancelAtPeriodEnd !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'Subscription request is invalid' }, { status: 400 })
  }

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const paymentRecord = await knex('payment_records')
      .where('stripe_subscription_id', body.subscriptionId)
      .where('organization_id', scope.organizationId)
      .where('tenant_id', scope.tenantId)
      .first()
    if (!paymentRecord) return NextResponse.json({ ok: false, error: 'Subscription not found' }, { status: 404 })

    const connection = await knex('stripe_connections')
      .where('organization_id', scope.organizationId)
      .where('tenant_id', scope.tenantId)
      .where('is_active', true)
      .first()
    if (!connection || !isStripeAccountId(connection.stripe_account_id)) {
      return NextResponse.json({ ok: false, error: 'Stripe connection is unavailable' }, { status: 409 })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 10_000 })
    const stripeAccount = connection.stripe_account_id
    const current = await stripe.subscriptions.retrieve(body.subscriptionId, {}, { stripeAccount })
    const metadataAccount = readConnectedAccountFromMetadata(current.metadata)
    if (
      current.id !== body.subscriptionId
      || current.metadata?.orgId !== scope.organizationId
      || current.metadata?.tenantId !== scope.tenantId
      || metadataAccount !== stripeAccount
    ) {
      return NextResponse.json({ ok: false, error: 'Subscription ownership could not be verified' }, { status: 409 })
    }

    const idempotencyKey = buildStripeIdempotencyKey('subscription_cancel', scope, [
      paymentRecord.id,
      body.subscriptionId,
      body.cancelAtPeriodEnd,
    ])
    const subscription = body.cancelAtPeriodEnd
      ? await stripe.subscriptions.update(
        body.subscriptionId,
        { cancel_at_period_end: true },
        { stripeAccount, idempotencyKey },
      )
      : await stripe.subscriptions.cancel(
        body.subscriptionId,
        {},
        { stripeAccount, idempotencyKey },
      )

    return NextResponse.json({
      ok: true,
      data: {
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end,
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Stripe subscription update failed' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payments',
  summary: 'Cancel an owned Stripe subscription',
  methods: {
    POST: { summary: 'Cancel a tenant-bound subscription now or at period end', tags: ['Payments'] },
  },
}
