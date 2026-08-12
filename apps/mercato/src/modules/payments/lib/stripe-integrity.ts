import { createHash } from 'crypto'

export type StripeRequestScope = {
  userId: string
  organizationId: string
  tenantId: string
}

type AuthLike = {
  sub?: unknown
  orgId?: unknown
  tenantId?: unknown
} | null | undefined

type OAuthStateLike = {
  userId?: unknown
  orgId?: unknown
  tenantId?: unknown
  nonce?: unknown
} | null | undefined

type OAuthGrantLike = {
  stripe_user_id?: unknown
  access_token?: unknown
  livemode?: unknown
} | null | undefined

type StripeAccountLike = {
  id?: unknown
} | null | undefined

const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/
const STRIPE_CONNECT_CLIENT_ID = /^ca_[A-Za-z0-9]+$/
const STRIPE_CHECKOUT_SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9]+$/
const STRIPE_PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/
const STRIPE_SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readStripeRequestScope(auth: AuthLike): StripeRequestScope | null {
  const userId = nonEmptyString(auth?.sub)
  const organizationId = nonEmptyString(auth?.orgId)
  const tenantId = nonEmptyString(auth?.tenantId)
  if (!userId || !organizationId || !tenantId) return null
  return { userId, organizationId, tenantId }
}

export function oauthStateMatchesScope(state: OAuthStateLike, scope: StripeRequestScope): boolean {
  return nonEmptyString(state?.nonce) !== null
    && state?.userId === scope.userId
    && state?.orgId === scope.organizationId
    && state?.tenantId === scope.tenantId
}

export function stripeEnvironmentMode(secretKey: string | undefined): 'test' | 'live' | 'unavailable' {
  if (secretKey?.startsWith('sk_test_')) return 'test'
  if (secretKey?.startsWith('sk_live_')) return 'live'
  return 'unavailable'
}

export function resolveStripeConnectClientId(input: {
  secretKey: string | undefined
  liveClientId: string | undefined
  legacyLiveClientId: string | undefined
  testClientId: string | undefined
}): string | null {
  const mode = stripeEnvironmentMode(input.secretKey)
  const liveClientId = nonEmptyString(input.liveClientId) ?? nonEmptyString(input.legacyLiveClientId)
  const testClientId = nonEmptyString(input.testClientId)
  if (mode === 'live') {
    return liveClientId && STRIPE_CONNECT_CLIENT_ID.test(liveClientId) ? liveClientId : null
  }
  if (mode === 'test') {
    if (!testClientId || !STRIPE_CONNECT_CLIENT_ID.test(testClientId)) return null
    if (liveClientId && testClientId === liveClientId) return null
    return testClientId
  }
  return null
}

export function resolveAppBaseUrl(raw: string | undefined): string | null {
  const candidate = raw?.trim()
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !localHttp) return null
    if (parsed.username || parsed.password) return null
    parsed.pathname = '/'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function buildStripeSuccessUrl(baseUrl: string): string {
  return `${baseUrl}/api/payments/stripe/success?session_id={CHECKOUT_SESSION_ID}`
}

export function readHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function isStripeAccountId(value: unknown): value is string {
  return typeof value === 'string' && STRIPE_ACCOUNT_ID.test(value)
}

export function isStripeCheckoutSessionId(value: unknown): value is string {
  return typeof value === 'string' && STRIPE_CHECKOUT_SESSION_ID.test(value)
}

export function isStripePaymentIntentId(value: unknown): value is string {
  return typeof value === 'string' && STRIPE_PAYMENT_INTENT_ID.test(value)
}

export function isStripeSubscriptionId(value: unknown): value is string {
  return typeof value === 'string' && STRIPE_SUBSCRIPTION_ID.test(value)
}

export function validateOAuthGrant(
  grant: OAuthGrantLike,
  account: StripeAccountLike,
  platformMode: 'test' | 'live' | 'unavailable',
): { accountId: string; accessToken: string; livemode: boolean } | null {
  const accountId = grant?.stripe_user_id
  const accessToken = grant?.access_token
  const livemode = grant?.livemode
  if (!isStripeAccountId(accountId)) return null
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null
  if (typeof livemode !== 'boolean') return null
  if (account?.id !== accountId) return null
  if (platformMode === 'unavailable' || (platformMode === 'live') !== livemode) return null
  return { accountId, accessToken, livemode }
}

export function buildStripeIdempotencyKey(
  operation: string,
  scope: Pick<StripeRequestScope, 'organizationId' | 'tenantId'>,
  parts: Array<string | number | boolean | null | undefined>,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([operation, scope.organizationId, scope.tenantId, ...parts]))
    .digest('hex')
  return `lg12_${operation}_${digest.slice(0, 48)}`
}

export function readPositiveAmount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value
}

export function resolveRefundAmount(input: {
  originalAmount: unknown
  previouslyRefunded: unknown
  requestedAmount: unknown
}): { amount: number; maxRefundable: number } | null {
  const originalAmount = Number(input.originalAmount)
  const previouslyRefunded = Number(input.previouslyRefunded ?? 0)
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return null
  if (!Number.isFinite(previouslyRefunded) || previouslyRefunded < 0 || previouslyRefunded >= originalAmount) return null
  const maxRefundable = originalAmount - previouslyRefunded
  const amount = input.requestedAmount === undefined || input.requestedAmount === null
    ? maxRefundable
    : readPositiveAmount(input.requestedAmount)
  if (amount === null || amount > maxRefundable) return null
  return { amount, maxRefundable }
}

export type StripeWebhookScope = {
  organizationId: string
  tenantId: string
  stripeAccountId: string
}

export function resolveStripeWebhookScope(input: {
  eventAccount: unknown
  metadata: unknown
  connection: {
    organization_id?: unknown
    tenant_id?: unknown
    stripe_account_id?: unknown
    is_active?: unknown
  } | null | undefined
}): StripeWebhookScope | null {
  if (!isStripeAccountId(input.eventAccount)) return null
  if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) return null
  const metadata = input.metadata as Record<string, unknown>
  const organizationId = nonEmptyString(metadata.orgId)
  const tenantId = nonEmptyString(metadata.tenantId)
  if (!organizationId || !tenantId || metadata.connectedAccount !== input.eventAccount) return null
  if (input.connection?.is_active !== true) return null
  if (input.connection.organization_id !== organizationId) return null
  if (input.connection.tenant_id !== tenantId) return null
  if (input.connection.stripe_account_id !== input.eventAccount) return null
  return { organizationId, tenantId, stripeAccountId: input.eventAccount }
}

export function readConnectedAccountFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const accountId = (metadata as Record<string, unknown>).connectedAccount
  return isStripeAccountId(accountId) ? accountId : null
}
