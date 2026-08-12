/** @jest-environment node */

import {
  buildStripeIdempotencyKey,
  buildStripeSuccessUrl,
  isStripeAccountId,
  isStripeCheckoutSessionId,
  isStripePaymentIntentId,
  isStripeSubscriptionId,
  oauthStateMatchesScope,
  readHttpsUrl,
  readStripeRequestScope,
  resolveAppBaseUrl,
  resolveRefundAmount,
  resolveStripeWebhookScope,
  stripeEnvironmentMode,
  validateOAuthGrant,
} from '../stripe-integrity'

const scope = {
  userId: 'user-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
}

describe('LG-12 Stripe integrity helpers', () => {
  it('requires a complete user, organization, and tenant scope', () => {
    expect(readStripeRequestScope({ sub: 'user-1', orgId: 'org-1', tenantId: 'tenant-1' })).toEqual(scope)
    expect(readStripeRequestScope({ sub: 'user-1', orgId: 'org-1' })).toBeNull()
    expect(readStripeRequestScope({ sub: '', orgId: 'org-1', tenantId: 'tenant-1' })).toBeNull()
  })

  it('binds OAuth state and grants to the exact browser and Stripe account', () => {
    expect(oauthStateMatchesScope({ userId: 'user-1', orgId: 'org-1', tenantId: 'tenant-1', nonce: 'nonce' }, scope)).toBe(true)
    expect(oauthStateMatchesScope({ userId: 'other', orgId: 'org-1', tenantId: 'tenant-1', nonce: 'nonce' }, scope)).toBe(false)
    expect(oauthStateMatchesScope({ userId: 'user-1', orgId: 'org-1', tenantId: 'tenant-1', nonce: '' }, scope)).toBe(false)

    expect(validateOAuthGrant(
      { stripe_user_id: 'acct_Test123', access_token: 'access', livemode: false },
      { id: 'acct_Test123' },
      'test',
    )).toEqual({ accountId: 'acct_Test123', accessToken: 'access', livemode: false })
    expect(validateOAuthGrant(
      { stripe_user_id: 'acct_Test123', access_token: 'access', livemode: true },
      { id: 'acct_Other' },
      'live',
    )).toBeNull()
    expect(validateOAuthGrant(
      { stripe_user_id: 'acct_Test123', access_token: 'access', livemode: true },
      { id: 'acct_Test123' },
      'test',
    )).toBeNull()
  })

  it('accepts only bounded Stripe identifiers and safe application URLs', () => {
    expect(isStripeAccountId('acct_123ABC')).toBe(true)
    expect(isStripeCheckoutSessionId('cs_test_123ABC')).toBe(true)
    expect(isStripePaymentIntentId('pi_123ABC')).toBe(true)
    expect(isStripeSubscriptionId('sub_123ABC')).toBe(true)
    expect(isStripeAccountId('acct_bad/path')).toBe(false)
    expect(isStripeCheckoutSessionId('http://example.com')).toBe(false)

    expect(resolveAppBaseUrl('https://crm.example.com/unsafe?x=1#fragment')).toBe('https://crm.example.com')
    expect(resolveAppBaseUrl('http://127.0.0.1:3000/path')).toBe('http://127.0.0.1:3000')
    expect(resolveAppBaseUrl('http://crm.example.com')).toBeNull()
    expect(resolveAppBaseUrl('https://user:secret@crm.example.com')).toBeNull()
    expect(readHttpsUrl('https://example.com/terms')).toBe('https://example.com/terms')
    expect(readHttpsUrl('javascript:alert(1)')).toBeNull()
    expect(buildStripeSuccessUrl('https://crm.example.com')).toBe(
      'https://crm.example.com/api/payments/stripe/success?session_id={CHECKOUT_SESSION_ID}',
    )
  })

  it('classifies Stripe modes and derives stable scoped idempotency keys', () => {
    expect(stripeEnvironmentMode('sk_test_example')).toBe('test')
    expect(stripeEnvironmentMode('sk_live_example')).toBe('live')
    expect(stripeEnvironmentMode('other')).toBe('unavailable')
    const first = buildStripeIdempotencyKey('refund', scope, ['payment-1', 100])
    expect(first).toBe(buildStripeIdempotencyKey('refund', scope, ['payment-1', 100]))
    expect(first).not.toBe(buildStripeIdempotencyKey('refund', { ...scope, tenantId: 'tenant-2' }, ['payment-1', 100]))
    expect(first).toMatch(/^lg12_refund_[a-f0-9]{48}$/)
  })

  it('admits only a positive refund within the remaining balance', () => {
    expect(resolveRefundAmount({ originalAmount: 100, previouslyRefunded: 25, requestedAmount: 10 })).toEqual({
      amount: 10,
      maxRefundable: 75,
    })
    expect(resolveRefundAmount({ originalAmount: 100, previouslyRefunded: 25, requestedAmount: undefined })).toEqual({
      amount: 75,
      maxRefundable: 75,
    })
    expect(resolveRefundAmount({ originalAmount: 100, previouslyRefunded: 25, requestedAmount: 76 })).toBeNull()
    expect(resolveRefundAmount({ originalAmount: 100, previouslyRefunded: 25, requestedAmount: -1 })).toBeNull()
    expect(resolveRefundAmount({ originalAmount: 100, previouslyRefunded: 100, requestedAmount: 1 })).toBeNull()
  })

  it('requires event account, metadata, and active persisted scope to agree', () => {
    const connection = {
      organization_id: 'org-1',
      tenant_id: 'tenant-1',
      stripe_account_id: 'acct_Test123',
      is_active: true,
    }
    expect(resolveStripeWebhookScope({
      eventAccount: 'acct_Test123',
      metadata: { orgId: 'org-1', tenantId: 'tenant-1', connectedAccount: 'acct_Test123' },
      connection,
    })).toEqual({ organizationId: 'org-1', tenantId: 'tenant-1', stripeAccountId: 'acct_Test123' })
    expect(resolveStripeWebhookScope({
      eventAccount: 'acct_Test123',
      metadata: { orgId: 'org-1', tenantId: 'tenant-2', connectedAccount: 'acct_Test123' },
      connection,
    })).toBeNull()
    expect(resolveStripeWebhookScope({
      eventAccount: 'acct_Test123',
      metadata: { orgId: 'org-1', tenantId: 'tenant-1', connectedAccount: 'acct_Other' },
      connection,
    })).toBeNull()
  })
})
