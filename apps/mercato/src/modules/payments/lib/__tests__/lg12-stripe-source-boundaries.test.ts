/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const moduleRoot = path.resolve(__dirname, '../..')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8')
}

describe('LG-12 Stripe source boundaries', () => {
  it('permits connection only through user- and tenant-bound OAuth', () => {
    const start = source('api/stripe/connect-oauth/route.ts')
    const callback = source('api/stripe/connect-oauth/callback/route.ts')
    const connections = source('api/stripe/connections/route.ts')
    const paymentsPage = source('backend/payments/page.tsx')

    expect(start).not.toContain('POST:')
    expect(start).toContain('userId: scope.userId')
    expect(start).toContain('tenantId: scope.tenantId')
    expect(start).toContain('nonce: randomUUID()')
    expect(start).toContain('resolveStripeConnectClientId({')
    expect(start).toContain('testClientId: process.env.STRIPE_CONNECT_TEST_CLIENT_ID')
    expect(callback).toContain('oauthStateMatchesScope(stateData, scope)')
    expect(callback).toContain('resolveStripeConnectClientId({')
    expect(callback).toContain("access_token: null")
    expect(callback).toContain("refresh_token: null")
    expect(callback).not.toContain('access_token: token.access_token')
    expect(connections).toContain('stripe.oauth.deauthorize')
    expect(connections).toContain('resolveStripeConnectClientId({')
    expect(connections).toContain(".where('tenant_id', scope.tenantId)")
    expect(paymentsPage).not.toContain('manualAccountId')
    expect(paymentsPage).not.toContain('connectStripeManually')
  })

  it('keeps checkout, invoice links, records, refunds, and cancellations tenant-bound', () => {
    for (const relativePath of [
      'api/stripe/connect/route.ts',
      'api/invoices/[id]/send/route.ts',
      'api/records/route.ts',
      'api/stripe/refund/route.ts',
      'api/stripe/cancel-subscription/route.ts',
    ]) {
      const value = source(relativePath)
      expect(value).toContain('tenant_id')
      expect(value).toContain('organization_id')
    }

    const checkout = source('api/stripe/connect/route.ts')
    const invoice = source('api/invoices/[id]/send/route.ts')
    const refund = source('api/stripe/refund/route.ts')
    const cancellation = source('api/stripe/cancel-subscription/route.ts')
    expect(checkout).toContain('buildStripeSuccessUrl(baseUrl)')
    expect(invoice).toContain('buildStripeSuccessUrl(baseUrl)')
    expect(checkout).toContain("buildStripeIdempotencyKey('checkout'")
    expect(invoice).toContain("buildStripeIdempotencyKey('invoice_checkout'")
    expect(refund).toContain("buildStripeIdempotencyKey('refund'")
    expect(cancellation).toContain("buildStripeIdempotencyKey('subscription_cancel'")
    expect(cancellation).toContain('Subscription ownership could not be verified')
  })

  it('verifies the signed webhook before exact connected-account and tenant admission', () => {
    const webhook = source('api/stripe/webhook/route.ts')
    expect(webhook).toContain('stripe.webhooks.constructEvent(body, sig, webhookSecret)')
    expect(webhook).toContain('resolveStripeWebhookScope')
    expect(webhook).toContain(".where('stripe_account_id', event.account)")
    expect(webhook).toContain(".where('tenant_id', tenantId)")
    expect(webhook).toContain("if (session.payment_status !== 'paid')")
    expect(webhook).toContain(".onConflict().ignore().returning('id')")
    expect(webhook).not.toContain("JSON.parse(body)")
    expect(webhook).not.toContain("console.log(`[stripe.webhook]")
  })

  it('binds every enabled app-specific Stripe checkout to tenant and connected account', () => {
    const applicationRoot = path.resolve(moduleRoot, '..')
    for (const relativePath of [
      'courses/api/checkout/route.ts',
      'landing_pages/api/checkout/route.ts',
      'landing_pages/api/funnels/public/[slug]/checkout/route.ts',
      'landing_pages/api/funnels/public/[slug]/upsell/route.ts',
      'customers/api/crm-events/public/[slug]/checkout/route.ts',
    ]) {
      const value = fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8')
      expect(value).toContain('tenant_id')
      expect(value).toContain('connectedAccount:')
      expect(value).toContain('buildStripeIdempotencyKey(')
      expect(value).not.toContain("|| 'http://localhost:3000'")
    }
  })

  it('keeps the public success endpoint generic and data-independent', () => {
    const success = source('api/stripe/success/route.ts')
    expect(success).toContain('requireAuth: false')
    expect(success).toContain("'Cache-Control': 'no-store, max-age=0'")
    for (const forbidden of ['queryOne', 'payment_records', 'invoices', 'business_profiles', 'session_id']) {
      expect(success).not.toContain(forbidden)
    }
  })

  it('adds only the nullable invoice terms column required by the existing API contract', () => {
    const migration = source('migrations/Migration20260812070256.ts')
    const invoiceRoute = source('api/invoices/route.ts')

    expect(migration.match(/this\.addSql\(/g)).toHaveLength(2)
    expect(migration).toContain('alter table "invoices" add column if not exists "terms_url" text null;')
    expect(migration).toContain('alter table "invoices" drop column if exists "terms_url";')
    expect(migration).not.toContain('alter column')
    expect(migration).not.toContain('drop table')
    expect(invoiceRoute).toContain('terms_url: termsUrl || null')
  })

  it('keeps invoice checkout idempotency stable while storing the generated link', () => {
    const route = source('api/stripe/connect/route.ts')

    expect(route).toContain("resourceRevision = new Date(invoice.updated_at).toISOString()")
    expect(route).toContain(".update({ stripe_payment_link: session.url })")
    expect(route).not.toContain(".update({ stripe_payment_link: session.url, updated_at: new Date() })")
  })
})
