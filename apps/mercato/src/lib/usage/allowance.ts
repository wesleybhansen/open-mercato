import 'server-only'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { getNoliCoreClient, resolveOrgByoKeys, type ByoProvider } from '@open-mercato/shared/lib/noli/core-client'
import {
  LIVE_NOLI_SUBSCRIPTION_STATUSES,
  resolveAllowanceBillingPeriod,
  type NoliBillingSubscription,
} from '@open-mercato/shared/lib/noli/billing-period'
import type { EntityManager } from '@mikro-orm/postgresql'
import { after } from 'next/server'
import {
  beginGdprLocalWriteLease,
  beginGdprUserWriteLease,
  type GdprLocalWriteLease,
} from '@open-mercato/core/modules/auth/lib/gdprLocalWriteLease'

/*
 * P-3 allowance gate for the CRM customer-facing AI suite, with unified BYOK
 * fall-through. Resolves the noli org from the Mercato org and checks the pooled
 * credit allowance ($40/user = 10M tokens, every seat). Within the pool
 * → allowed (platform key). Over the pool:
 *   - org has a BYO key for this feature's provider → allowed, `byoApiKey` set
 *     (use it for the call + meter byoKey: true).
 *   - no key → blocked with the pause-and-prompt message.
 * Most CRM AI runs on Gemini, so `provider` defaults to 'google'. FAIL-OPEN.
 *
 *   const gate = await checkCustomersAiAllowance(auth)
 *   if (!gate.allowed) return NextResponse.json({ error: gate.message }, { status: 402 })
 *   const apiKey = gate.byoApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY
 *   // ...call the provider with apiKey...
 *   void meterCustomersAi(auth, { ..., byoKey: !!gate.byoApiKey })
 */
const FIRST_TWO_SEAT_CENTS = 4000
const EXTRA_SEAT_CENTS = 4000;
const CREDITS_PER_CENT = 2500
const TOKENS_PER_BOOST = 10_000_000 // each purchased token-boost add-on (P-9)

export const ALLOWANCE_BLOCK_MESSAGE =
  "You've used your team's monthly AI allowance. Add your own provider API key or upgrade your plan to keep using AI."

export type AllowanceResult = { allowed: boolean; message?: string; byoApiKey?: string }

export type CustomersAiExternalGrantReceipt = {
  grantId: string
  organizationId: string
  localUserId: string
  noliOrgId: string
  provider: string
  purpose: string
  expiresAt: string
}

type CustomersAiProcessorScope = {
  createExternalGrant: (args: {
    provider: string
    purpose: string
    lifetimeSeconds: number
  }) => Promise<CustomersAiExternalGrantReceipt>
  revokeExternalGrant: (grant: CustomersAiExternalGrantReceipt) => Promise<void>
}

const GDPR_AI_BLOCK_MESSAGE =
  'AI operations are unavailable while this account is being deleted.'
const LOCAL_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function resolveLocalUserId(auth: {
  sub?: string | null
  userId?: string | null
}): string | null {
  const userId = auth.userId?.trim()
  if (userId && LOCAL_USER_ID.test(userId)) return userId
  const subject = auth.sub?.trim()
  return subject && LOCAL_USER_ID.test(subject) ? subject : null
}

async function releaseProcessorLeases(
  userLease: GdprLocalWriteLease | null,
  organizationLease: GdprLocalWriteLease,
): Promise<void> {
  let releaseError: unknown
  try {
    await userLease?.release()
  } catch (error) {
    releaseError = error
  }
  try {
    await organizationLease.release()
  } catch (error) {
    releaseError ??= error
  }
  if (releaseError) throw releaseError
}

type ProcessorLeaseSet = {
  organizationLease: GdprLocalWriteLease
  userLease: GdprLocalWriteLease | null
}

const processorLeaseContextToken = Symbol('customers-ai-processor-lease')
type ProcessorLeaseContext = {
  token: typeof processorLeaseContextToken
  em: EntityManager
  orgId: string
  localUserId: string | null
}

async function acquireProcessorLeases(
  em: EntityManager,
  auth: { orgId: string; sub?: string | null; userId?: string | null },
): Promise<ProcessorLeaseSet | null> {
  const database = em.getKnex()
  const organizationLease = await beginGdprLocalWriteLease(
    database as never,
    auth.orgId,
    'processor',
  )
  if (!organizationLease) return null

  const localUserId = resolveLocalUserId(auth)
  let userLease: GdprLocalWriteLease | null = null
  try {
    userLease = localUserId
      ? await beginGdprUserWriteLease(database as never, localUserId, 'processor')
      : null
    if (localUserId && !userLease) {
      await organizationLease.release()
      return null
    }
    return { organizationLease, userLease }
  } catch (error) {
    await releaseProcessorLeases(userLease, organizationLease).catch(() => {})
    throw error
  }
}

async function registerRequestProcessorLeases(
  em: EntityManager,
  auth: { orgId: string; sub?: string | null; userId?: string | null },
): Promise<boolean> {
  let leases: ProcessorLeaseSet | null = null
  try {
    const acquired = await acquireProcessorLeases(em, auth)
    if (!acquired) return false
    leases = acquired
    after(() => releaseProcessorLeases(acquired.userLease, acquired.organizationLease))
    return true
  } catch {
    if (leases) {
      await releaseProcessorLeases(leases.userLease, leases.organizationLease).catch(() => {})
    }
    return false
  }
}

export async function checkCustomersAiAllowance(
  auth: {
    orgId?: string | null
    sub?: string | null
    userId?: string | null
  } | null | undefined,
  provider: ByoProvider = 'google',
  processorLeaseContext?: ProcessorLeaseContext,
): Promise<AllowanceResult> {
  if (!auth?.orgId) return { allowed: true }
  let em: EntityManager
  if (processorLeaseContext) {
    const localUserId = resolveLocalUserId(auth)
    if (
      processorLeaseContext.token !== processorLeaseContextToken
      || processorLeaseContext.orgId !== auth.orgId
      || processorLeaseContext.localUserId !== localUserId
    ) {
      return { allowed: false, message: GDPR_AI_BLOCK_MESSAGE }
    }
    em = processorLeaseContext.em
  } else {
    const container = await createRequestContainer().catch(() => null)
    if (!container) return { allowed: false, message: GDPR_AI_BLOCK_MESSAGE }
    try {
      em = container.resolve('em') as EntityManager
    } catch {
      return { allowed: false, message: GDPR_AI_BLOCK_MESSAGE }
    }
    if (!(await registerRequestProcessorLeases(em, { ...auth, orgId: auth.orgId }))) {
      return { allowed: false, message: GDPR_AI_BLOCK_MESSAGE }
    }
  }

  try {
    const org = await em.findOne(Organization, { id: auth.orgId })
    if (!org?.noliOrgId) return { allowed: true } // not linked to noli-core
    const supabase = getNoliCoreClient()

    const now = new Date()
    const [membersResult, subscriptionsResult] = await Promise.all([
      supabase.from('organization_members').select('user_id').eq('organization_id', org.noliOrgId),
      supabase
        .from('subscriptions')
        .select('id, seats, token_boosts, status, billing_interval, current_period_start, updated_at')
        .eq('organization_id', org.noliOrgId)
        .in('status', [...LIVE_NOLI_SUBSCRIPTION_STATUSES]),
    ])
    if (membersResult.error || subscriptionsResult.error) return { allowed: true }
    const members = membersResult.data
    const subs = subscriptionsResult.data
    // Paid seats (base + purchased overflow) drive allowance, matching the hub —
    // a Team with unfilled seats still gets its full pooled budget. Fall back to
    // the member count for legacy/unsubscribed orgs.
    type AllowanceSubscription = NoliBillingSubscription & {
      seats: number | null
      token_boosts: number | null
    }
    const { subscription: sub, periodStart } = resolveAllowanceBillingPeriod(
      (subs as AllowanceSubscription[] | null) ?? [],
      now,
    )
    const usageResult = await supabase
      .from('ai_usage')
      .select('credits_consumed')
      .eq('organization_id', org.noliOrgId)
      .eq('byo_key', false)
      .gte('ts', periodStart.toISOString())
    if (usageResult.error) return { allowed: true }
    const usage = usageResult.data
    const memberSeats = Math.max(1, ((members as unknown[]) ?? []).length)
    const seats = sub?.seats && sub.seats > 0 ? sub.seats : memberSeats
    const tokenBoosts = sub?.token_boosts ?? 0
    const used = (((usage as { credits_consumed: number | null }[]) ?? []).reduce(
      (sum, r) => sum + (r.credits_consumed ?? 0),
      0,
    ))
    // Admin allowance override (comps / support bumps) — sum non-expired
    // user_cap_overrides across the org's members. Mirrors the hub's
    // getOrgAdminOverrideCredits so an override set in the admin dashboard
    // applies to CRM too (CRM inlines its own allowance math).
    const memberIds = ((members as { user_id: string }[]) ?? []).map((m) => m.user_id)
    let overrideCredits = 0
    if (memberIds.length) {
      const overridesResult = await supabase
        .from('user_cap_overrides')
        .select('monthly_credits, expires_at')
        .in('user_id', memberIds)
      if (overridesResult.error) return { allowed: true }
      const ov = overridesResult.data
      const nowIso = now.toISOString()
      overrideCredits = ((ov as { monthly_credits: number | null; expires_at: string | null }[]) ?? []).reduce(
        (s, r) => (r.expires_at && r.expires_at < nowIso ? s : s + Math.max(0, r.monthly_credits ?? 0)),
        0,
      )
    }
    const allowanceCents =
      Math.min(2, seats) * FIRST_TWO_SEAT_CENTS + Math.max(0, seats - 2) * EXTRA_SEAT_CENTS
    const allowanceCredits = allowanceCents * CREDITS_PER_CENT + tokenBoosts * TOKENS_PER_BOOST + overrideCredits
    if (allowanceCredits > 0 && used >= allowanceCredits) {
      // Over allowance: fall through to the org's own key for this provider.
      const keys = await resolveOrgByoKeys(org.noliOrgId)
      const byoApiKey = keys[provider]
      if (byoApiKey) return { allowed: true, byoApiKey }
      return { allowed: false, message: ALLOWANCE_BLOCK_MESSAGE }
    }
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}

export type CustomersAiAllowanceLease = CustomersAiProcessorScope & {
  gate: AllowanceResult
  release: () => Promise<void>
}

function createCustomersAiProcessorScope(
  em: EntityManager,
  auth: { orgId: string; sub?: string | null; userId?: string | null },
  leases: ProcessorLeaseSet,
  gate: AllowanceResult,
): CustomersAiProcessorScope {
  let externalGrantCreated = false
  let externalGrant: CustomersAiExternalGrantReceipt | null = null
  return {
    createExternalGrant: async (args) => {
      if (!gate.allowed) {
        throw new Error('CRM external processor grant requires an allowed AI operation')
      }
      const localUserId = resolveLocalUserId(auth)
      if (!localUserId || !leases.userLease) {
        throw new Error('CRM external processor grant requires an authenticated user lease')
      }
      if (externalGrantCreated) {
        throw new Error('CRM processor operation already created an external grant')
      }
      if (
        !args.provider.trim()
        || !args.purpose.trim()
        || !Number.isInteger(args.lifetimeSeconds)
        || args.lifetimeSeconds < 1
        || args.lifetimeSeconds > 4200
      ) {
        throw new Error('CRM external processor grant parameters are invalid')
      }

      const grantId = randomUUID()
      const database = em.getKnex() as unknown as {
        raw: (
          sql: string,
          bindings: readonly unknown[],
        ) => Promise<{ rows?: Array<{ receipt?: unknown }> }>
      }
      const result = await database.raw(
        `select public.crm_gdpr_create_external_processor_grant(
           ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?
         ) as receipt`,
        [
          auth.orgId,
          localUserId,
          leases.organizationLease.leaseId,
          leases.userLease.leaseId,
          grantId,
          args.provider,
          args.purpose,
          grantId,
          args.lifetimeSeconds,
        ],
      )
      const receipt = result.rows?.[0]?.receipt as
        | Partial<CustomersAiExternalGrantReceipt>
        | undefined
      const expiresAt =
        typeof receipt?.expiresAt === 'string' ? Date.parse(receipt.expiresAt) : Number.NaN
      if (
        receipt?.grantId !== grantId
        || receipt.organizationId !== auth.orgId
        || receipt.localUserId !== localUserId
        || typeof receipt.noliOrgId !== 'string'
        || !receipt.noliOrgId
        || receipt.provider !== args.provider.trim()
        || receipt.purpose !== args.purpose.trim()
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
      ) {
        throw new Error('CRM external processor grant receipt was not exact')
      }
      externalGrantCreated = true
      externalGrant = { ...receipt } as CustomersAiExternalGrantReceipt
      return { ...externalGrant }
    },
    revokeExternalGrant: async (grant) => {
      if (
        !externalGrant
        || grant.grantId !== externalGrant.grantId
        || grant.organizationId !== externalGrant.organizationId
        || grant.localUserId !== externalGrant.localUserId
        || grant.noliOrgId !== externalGrant.noliOrgId
        || grant.provider !== externalGrant.provider
        || grant.purpose !== externalGrant.purpose
        || grant.expiresAt !== externalGrant.expiresAt
      ) {
        throw new Error('CRM external processor grant revocation was not exact')
      }

      const exactGrant = externalGrant
      const database = em.getKnex() as unknown as {
        raw: (
          sql: string,
          bindings: readonly unknown[],
        ) => Promise<{ rows?: Array<{ grantId?: unknown }> }>
      }
      const result = await database.raw(
        `delete from public.gdpr_external_processor_grants
          where grant_id = ?::uuid
            and organization_id = ?::uuid
            and local_user_id = ?::uuid
            and noli_org_id = ?
            and provider = ?
            and purpose = ?
            and external_binding_sha256 = encode(sha256(convert_to(?::text, 'UTF8')), 'hex')
            and expires_at = ?::timestamptz
        returning grant_id::text as "grantId"`,
        [
          exactGrant.grantId,
          exactGrant.organizationId,
          exactGrant.localUserId,
          exactGrant.noliOrgId,
          exactGrant.provider,
          exactGrant.purpose,
          exactGrant.grantId,
          exactGrant.expiresAt,
        ],
      )
      if (
        result.rows?.length !== 1
        || result.rows[0]?.grantId !== exactGrant.grantId
      ) {
        throw new Error('CRM external processor grant revocation was not acknowledged')
      }
      externalGrant = null
    },
  }
}

/** Acquires explicit leases that can be handed to a registered background
 * task. Callers must release the returned lease after that task settles. */
export async function beginCustomersAiAllowance(
  em: EntityManager,
  auth: { orgId: string; sub?: string | null; userId?: string | null },
  provider: ByoProvider = 'google',
): Promise<CustomersAiAllowanceLease | null> {
  let leases: ProcessorLeaseSet | null = null
  try {
    leases = await acquireProcessorLeases(em, auth)
    if (!leases) return null
    const context: ProcessorLeaseContext = {
      token: processorLeaseContextToken,
      em,
      orgId: auth.orgId,
      localUserId: resolveLocalUserId(auth),
    }
    const gate = await checkCustomersAiAllowance(auth, provider, context)
    const scope = createCustomersAiProcessorScope(em, auth, leases, gate)
    const acquiredLeases = leases
    let releasePromise: Promise<void> | null = null
    return {
      gate,
      ...scope,
      release: () => {
        releasePromise ??= releaseProcessorLeases(
          acquiredLeases.userLease,
          acquiredLeases.organizationLease,
        )
        return releasePromise
      },
    }
  } catch {
    if (leases) await releaseProcessorLeases(leases.userLease, leases.organizationLease).catch(() => {})
    return null
  }
}

/** Runs background AI work under explicit processor leases. Unlike the normal
 * request gate, this does not depend on Next's request lifecycle. */
export async function withCustomersAiAllowance<T>(
  em: EntityManager,
  auth: { orgId: string; sub?: string | null; userId?: string | null },
  provider: ByoProvider,
  operation: (gate: AllowanceResult, scope: CustomersAiProcessorScope) => Promise<T>,
): Promise<{ executed: false } | { executed: true; value: T }> {
  const lease = await beginCustomersAiAllowance(em, auth, provider)
  if (!lease) return { executed: false }
  try {
    return {
      executed: true,
      value: await operation(lease.gate, {
        createExternalGrant: lease.createExternalGrant,
        revokeExternalGrant: lease.revokeExternalGrant,
      }),
    }
  } finally {
    await lease.release()
  }
}
