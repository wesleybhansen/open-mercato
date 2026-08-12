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
  isStripeCheckoutSessionId,
  isStripePaymentIntentId,
  readStripeRequestScope,
  resolveRefundAmount,
} from '@/modules/payments/lib/stripe-integrity'

type RefundReason = 'requested_by_customer' | 'duplicate' | 'fraudulent'

type RefundBody = {
  paymentRecordId?: unknown
  amount?: unknown
  reason?: unknown
}

const REFUND_REASONS = new Set<RefundReason>(['requested_by_customer', 'duplicate', 'fraudulent'])

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function POST(req: Request) {
  const scope = readStripeRequestScope(await getAuthFromCookies())
  if (!scope) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ ok: false, error: 'Stripe is not configured' }, { status: 503 })

  const body = await readJsonSafe<RefundBody>(req)
  const paymentRecordId = typeof body?.paymentRecordId === 'string' ? body.paymentRecordId.trim() : ''
  const reason = body?.reason === undefined ? undefined : body.reason
  if (!paymentRecordId || paymentRecordId.length > 255) {
    return NextResponse.json({ ok: false, error: 'Payment record is required' }, { status: 400 })
  }
  if (reason !== undefined && (typeof reason !== 'string' || !REFUND_REASONS.has(reason as RefundReason))) {
    return NextResponse.json({ ok: false, error: 'Refund reason is invalid' }, { status: 400 })
  }

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 10_000 })

    const result = await knex.transaction(async (trx) => {
      const paymentRecord = await trx('payment_records')
        .where('id', paymentRecordId)
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .forUpdate()
        .first()
      if (!paymentRecord) return { status: 404 as const, error: 'Payment record not found' }
      if (paymentRecord.status === 'refunded') return { status: 409 as const, error: 'Payment is already fully refunded' }

      const connection = await trx('stripe_connections')
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .where('is_active', true)
        .first()
      if (!connection || !isStripeAccountId(connection.stripe_account_id)) {
        return { status: 409 as const, error: 'Stripe connection is unavailable' }
      }
      const stripeAccount = connection.stripe_account_id

      let paymentIntentId: unknown = paymentRecord.stripe_payment_intent_id
      if (!isStripePaymentIntentId(paymentIntentId)) {
        const sessionId = paymentRecord.stripe_checkout_session_id
        if (!isStripeCheckoutSessionId(sessionId)) {
          return { status: 409 as const, error: 'Payment intent is unavailable' }
        }
        const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount })
        paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      }
      if (!isStripePaymentIntentId(paymentIntentId)) {
        return { status: 409 as const, error: 'Payment intent is unavailable' }
      }

      const resolved = resolveRefundAmount({
        originalAmount: paymentRecord.amount,
        previouslyRefunded: paymentRecord.refunded_amount,
        requestedAmount: body?.amount,
      })
      if (!resolved) return { status: 400 as const, error: 'Refund amount is invalid' }
      const amountInMinorUnits = Math.round(resolved.amount * 100)
      if (!Number.isSafeInteger(amountInMinorUnits) || amountInMinorUnits <= 0) {
        return { status: 400 as const, error: 'Refund amount is invalid' }
      }

      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amountInMinorUnits,
        ...(reason ? { reason: reason as RefundReason } : {}),
      }, {
        stripeAccount,
        idempotencyKey: buildStripeIdempotencyKey('refund', scope, [
          paymentRecord.id,
          Number(paymentRecord.refunded_amount || 0),
          amountInMinorUnits,
          reason || null,
        ]),
      })

      const previouslyRefunded = Number(paymentRecord.refunded_amount || 0)
      const originalAmount = Number(paymentRecord.amount)
      const totalRefunded = previouslyRefunded + resolved.amount
      const isFullRefund = totalRefunded >= originalAmount
      const nextStatus = isFullRefund ? 'refunded' : 'partially_refunded'
      const changed = await trx('payment_records')
        .where('id', paymentRecord.id)
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .update({
          status: nextStatus,
          refunded_amount: totalRefunded,
          metadata: JSON.stringify({
            ...parseMetadata(paymentRecord.metadata),
            refund_id: refund.id,
            last_refund_amount: resolved.amount,
            total_refunded: totalRefunded,
            refunded_at: new Date().toISOString(),
          }),
        })
      if (changed !== 1) throw new Error('payment_record_update_refused')

      return {
        status: 200 as const,
        data: {
          amount: resolved.amount,
          totalRefunded,
          status: nextStatus,
        },
        timeline: paymentRecord.contact_id ? {
          contactId: paymentRecord.contact_id,
          currency: paymentRecord.currency,
          amount: resolved.amount,
          reason: reason || null,
          isFullRefund,
        } : null,
      }
    })

    if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    if (result.timeline) {
      try {
        const { logTimelineEvent } = await import('@/lib/timeline')
        await logTimelineEvent(knex, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          contactId: result.timeline.contactId,
          eventType: 'refund',
          title: result.timeline.isFullRefund ? 'Payment refunded' : 'Partial refund issued',
          description: `${result.timeline.amount.toFixed(2)} ${(result.timeline.currency || 'USD').toUpperCase()} refunded`,
          metadata: {
            amount: result.timeline.amount,
            currency: result.timeline.currency,
            reason: result.timeline.reason,
            isFullRefund: result.timeline.isFullRefund,
          },
        })
      } catch {
        // The Stripe refund and payment ledger update are authoritative; timeline projection is best effort.
      }
    }
    return NextResponse.json({ ok: true, data: result.data })
  } catch {
    return NextResponse.json({ ok: false, error: 'Stripe refund failed' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payments',
  summary: 'Refund an owned Stripe payment',
  methods: {
    POST: { summary: 'Create an idempotent refund for a tenant-bound payment', tags: ['Payments'] },
  },
}
