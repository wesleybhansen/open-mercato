import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { verifyOAuthState } from '@/lib/oauth-state'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  oauthStateMatchesScope,
  readStripeRequestScope,
  resolveAppBaseUrl,
  resolveStripeConnectClientId,
  stripeEnvironmentMode,
  validateOAuthGrant,
} from '@/modules/payments/lib/stripe-integrity'

export const metadata = { GET: { requireAuth: false } }

type OAuthState = { userId: string; orgId: string; tenantId: string; nonce: string }

function redirect(baseUrl: string, result: string) {
  return NextResponse.redirect(`${baseUrl}/backend/payments?${result}`)
}

// Stripe Connect OAuth callback. The grant, authenticated browser session,
// signed state, connected-account token, and persisted tenant scope must all
// agree before an account is attached.
export async function GET(req: Request) {
  const baseUrl = resolveAppBaseUrl(process.env.APP_URL)
  if (!baseUrl) return NextResponse.json({ ok: false, error: 'Stripe Connect is not configured' }, { status: 503 })

  const url = new URL(req.url)
  if (url.searchParams.has('error')) return redirect(baseUrl, 'stripe_error=authorization_denied')

  const code = url.searchParams.get('code')
  const stateData = verifyOAuthState<OAuthState>(url.searchParams.get('state'))
  const scope = readStripeRequestScope(await getAuthFromCookies())
  if (!code || !stateData || !scope || !oauthStateMatchesScope(stateData, scope)) {
    return redirect(baseUrl, 'stripe_error=invalid_state')
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const platformMode = stripeEnvironmentMode(stripeKey)
  const clientId = resolveStripeConnectClientId({
    secretKey: stripeKey,
    liveClientId: process.env.STRIPE_CONNECT_CLIENT_ID,
    legacyLiveClientId: process.env.STRIPE_CLIENT_ID,
    testClientId: process.env.STRIPE_CONNECT_TEST_CLIENT_ID,
  })
  if (!stripeKey || !clientId || platformMode === 'unavailable') {
    return redirect(baseUrl, 'stripe_error=not_configured')
  }

  try {
    const Stripe = (await import('stripe')).default
    const platform = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 10_000 })
    const token = await platform.oauth.token({ grant_type: 'authorization_code', code })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      return redirect(baseUrl, 'stripe_error=account_verification_failed')
    }

    // The OAuth access token is used once, in memory, to retrieve the account
    // it represents. It is deliberately never logged or persisted.
    const connectedClient = new Stripe(token.access_token, { maxNetworkRetries: 2, timeout: 10_000 })
    const account = await connectedClient.accounts.retrieve()
    const grant = validateOAuthGrant(token, account, platformMode)
    if (!grant) return redirect(baseUrl, 'stripe_error=account_verification_failed')

    const businessName = (
      account.business_profile?.name
      || account.settings?.dashboard?.display_name
      || null
    )?.slice(0, 255) ?? null

    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const stored = await knex.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [grant.accountId])

      const conflict = await trx('stripe_connections')
        .where('stripe_account_id', grant.accountId)
        .where('is_active', true)
        .where((builder) => {
          builder
            .whereNot('organization_id', scope.organizationId)
            .orWhereNot('tenant_id', scope.tenantId)
        })
        .first()
      if (conflict) return false

      const existing = await trx('stripe_connections')
        .where('organization_id', scope.organizationId)
        .where('tenant_id', scope.tenantId)
        .first()

      const values = {
        stripe_account_id: grant.accountId,
        access_token: null,
        refresh_token: null,
        business_name: businessName,
        is_active: true,
        updated_at: new Date(),
      }
      if (existing) {
        await trx('stripe_connections')
          .where('id', existing.id)
          .where('organization_id', scope.organizationId)
          .where('tenant_id', scope.tenantId)
          .update(values)
      } else {
        await trx('stripe_connections').insert({
          id: randomUUID(),
          tenant_id: scope.tenantId,
          organization_id: scope.organizationId,
          ...values,
          created_at: new Date(),
        })
      }
      return true
    })

    if (!stored) return redirect(baseUrl, 'stripe_error=account_in_use')
    return redirect(baseUrl, 'stripe_connected=true')
  } catch {
    return redirect(baseUrl, 'stripe_error=callback_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Stripe Connect',
  summary: 'Complete Stripe Connect OAuth',
  methods: {
    GET: { summary: 'Verify and persist a Stripe Connect OAuth grant', tags: ['Stripe Connect'] },
  },
}
