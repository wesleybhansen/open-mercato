export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['payments.manage'] },
}

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { signOAuthState } from '@/lib/oauth-state'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  readStripeRequestScope,
  resolveAppBaseUrl,
  resolveStripeConnectClientId,
} from '@/modules/payments/lib/stripe-integrity'

// Stripe accounts may only be connected through Stripe's OAuth grant. There is
// deliberately no POST/manual-account-id path: an acct_ prefix proves syntax,
// not ownership.
export async function GET() {
  const scope = readStripeRequestScope(await getAuthFromCookies())
  if (!scope) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const clientId = resolveStripeConnectClientId({
    secretKey: stripeKey,
    liveClientId: process.env.STRIPE_CONNECT_CLIENT_ID,
    legacyLiveClientId: process.env.STRIPE_CLIENT_ID,
    testClientId: process.env.STRIPE_CONNECT_TEST_CLIENT_ID,
  })
  const baseUrl = resolveAppBaseUrl(process.env.APP_URL)
  if (!clientId || !stripeKey || !baseUrl) {
    return NextResponse.json({ ok: false, error: 'Stripe Connect is not configured' }, { status: 503 })
  }

  const state = signOAuthState({
    userId: scope.userId,
    orgId: scope.organizationId,
    tenantId: scope.tenantId,
    nonce: randomUUID(),
  })
  const redirectUri = `${baseUrl}/api/payments/stripe/connect-oauth/callback`

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(stripeKey, {
    maxNetworkRetries: 0,
    timeout: 10_000,
  })
  const authorizeUrl = stripe.oauth.authorizeUrl({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    state,
    redirect_uri: redirectUri,
  })
  return NextResponse.redirect(authorizeUrl)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Stripe Connect',
  summary: 'Start Stripe Connect OAuth',
  methods: {
    GET: { summary: 'Redirect to Stripe Connect OAuth authorization', tags: ['Stripe Connect'] },
  },
}
