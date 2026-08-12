export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['payments.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['payments.manage'] },
}

import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  isStripeAccountId,
  readStripeRequestScope,
  stripeEnvironmentMode,
} from '@/modules/payments/lib/stripe-integrity'

async function scopedConnection() {
  const scope = readStripeRequestScope(await getAuthFromCookies())
  if (!scope) return null
  const container = await createRequestContainer()
  const knex = (container.resolve('em') as EntityManager).getKnex()
  const connection = await knex('stripe_connections')
    .where('organization_id', scope.organizationId)
    .where('tenant_id', scope.tenantId)
    .where('is_active', true)
    .first()
  return { scope, knex, connection }
}

export async function GET() {
  try {
    const result = await scopedConnection()
    if (!result) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const { connection } = result
    if (!connection) return NextResponse.json({ ok: true, data: null })
    if (!isStripeAccountId(connection.stripe_account_id)) {
      return NextResponse.json({ ok: false, error: 'Stripe connection is invalid' }, { status: 409 })
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: connection.id,
        stripeAccountId: connection.stripe_account_id,
        businessName: connection.business_name,
        livemode: stripeEnvironmentMode(process.env.STRIPE_SECRET_KEY) === 'live',
        isActive: true,
        connectedAt: connection.created_at,
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to fetch connection' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const result = await scopedConnection()
    if (!result) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const { scope, knex, connection } = result
    if (!connection) return NextResponse.json({ ok: true })
    if (!isStripeAccountId(connection.stripe_account_id)) {
      return NextResponse.json({ ok: false, error: 'Stripe connection is invalid' }, { status: 409 })
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID || process.env.STRIPE_CLIENT_ID
    if (!stripeKey || !clientId) {
      return NextResponse.json({ ok: false, error: 'Stripe Connect is not configured' }, { status: 503 })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 10_000 })
    const revoked = await stripe.oauth.deauthorize({
      client_id: clientId,
      stripe_user_id: connection.stripe_account_id,
    })
    if (revoked.stripe_user_id !== connection.stripe_account_id) {
      return NextResponse.json({ ok: false, error: 'Stripe revocation could not be verified' }, { status: 502 })
    }

    const changed = await knex('stripe_connections')
      .where('id', connection.id)
      .where('organization_id', scope.organizationId)
      .where('tenant_id', scope.tenantId)
      .where('stripe_account_id', connection.stripe_account_id)
      .where('is_active', true)
      .update({
        access_token: null,
        refresh_token: null,
        is_active: false,
        updated_at: new Date(),
      })
    if (changed !== 1) {
      return NextResponse.json({ ok: false, error: 'Stripe connection changed during revocation' }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to disconnect' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Stripe Connect',
  summary: 'Manage Stripe Connect connection',
  methods: {
    GET: { summary: 'Get the tenant-bound Stripe connection', tags: ['Stripe Connect'] },
    DELETE: { summary: 'Revoke and deactivate the tenant-bound Stripe connection', tags: ['Stripe Connect'] },
  },
}
