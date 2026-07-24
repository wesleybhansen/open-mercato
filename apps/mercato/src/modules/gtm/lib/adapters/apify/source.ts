import {
  capabilityCovers,
  type AdapterCapability,
  type AdapterDescriptor,
  type AdapterResult,
  type Candidate,
  type SourceAdapter,
  type SourceSearchPlan,
} from '../types'
import {
  APIFY_CAPABILITY_KINDS,
  buildActorInput,
  extractPostUrl,
  isApifyCapabilityKind,
  normalizeItems,
  resolveActorId,
  type ApifyCapabilityKind,
  type ApifyEnv,
} from './actors'
import {
  APIFY_DEFAULT_TIMEOUT_MS,
  runActorSync,
  type ApifyFetchLike,
  type ApifyRunOutcome,
} from './client'

/*
 * Apify-backed social-engagement SOURCE adapter (SPEC-066 section 11.1/11.3).
 * The first real provider adapter; a drop-in for the fixture source adapter
 * through the same SourceAdapter contract, so lib/research/execute.ts (the
 * 11.2 reserve -> shadow -> start -> call -> settle wrapper) needs no change.
 *
 * SHIPS DARK, DELIBERATELY. `search` refuses unless BOTH
 *   GTM_APIFY_ENABLED === 'true'  AND  a token is configured.
 * This is not a convenience flag. The source is legally gated: scraping
 * LinkedIn violates LinkedIn's ToS regardless of tool, LinkedIn actively
 * litigates scrapers (v. Proxycurl 2025, v. ProAPIs), and reselling scraped
 * personal data adds CCPA "sale" plus GDPR layers where downstream liability
 * is ours, not the marketplace's. See
 * `Software Strategy/gtm-data-sources-origami-map-2026-07-24.md`, sections
 * "THE critical legal finding" and "Apify commercial posture". The standing
 * rule is: no provider spend until a written customer-serving license exists
 * and Wesley approves the spend per run. The gate default of OFF is how that
 * rule is enforced in code.
 *
 * Refusal is returned as an error AdapterResult, never thrown: the wrapper
 * settles it as a definitive failure with zero charged credits.
 */

export const APIFY_SOURCE_ADAPTER_ID = 'apify-social-source'

// Receipt contract: the ledger settles pay-per-result on the units the actor
// actually returned, so the run must be identifiable and countable.
export const APIFY_RECEIPT_FIELDS = ['actor_id', 'run_id', 'item_count'] as const

/*
 * PROVISIONAL LICENSE FLAG.
 *
 * The descriptor below declares export / customer_display / outreach_allowed
 * as true because that is what the product needs from this layer. That
 * declaration is PROVISIONAL, pending the legal review recorded in the
 * data-sources map. AdapterDescriptor is a frozen shape (SPEC-066 11.1) with
 * no metadata or extension field, so the flag cannot live inside the
 * descriptor without changing the shared contract type. It is exported here
 * instead and asserted in tests, so nothing can quietly forget it.
 */
export const APIFY_PROVISIONAL_LICENSE = true

// Env gate default: OFF. Both conditions must hold.
export const APIFY_ENABLED_ENV = 'GTM_APIFY_ENABLED'
export const APIFY_TOKEN_ENVS = ['GTM_APIFY_TOKEN', 'APIFY_TOKEN'] as const
// Origami charges 0.2 credits per social engagement result; the researched
// marketplace cost is $1.20-2.00 / 1k for LinkedIn. Overridable per deploy.
export const APIFY_CREDITS_PER_RESULT_ENV = 'GTM_APIFY_CREDITS_PER_RESULT'
export const APIFY_DEFAULT_CREDITS_PER_RESULT = 0.2
export const APIFY_TIMEOUT_MS_ENV = 'GTM_APIFY_TIMEOUT_MS'
// Batch ceiling; the plan's max_candidates caps below this.
export const APIFY_MAX_BATCH = 100

function processEnv(): ApifyEnv {
  return process.env as unknown as ApifyEnv
}

export function apifyEnabled(env: ApifyEnv = processEnv()): boolean {
  return env[APIFY_ENABLED_ENV] === 'true'
}

export function apifyToken(env: ApifyEnv = processEnv()): string | null {
  for (const name of APIFY_TOKEN_ENVS) {
    const value = (env[name] ?? '').trim()
    if (value) return value
  }
  return null
}

// Registry-facing gate: BOTH conditions, default off.
export function apifySourceEnabled(env: ApifyEnv = processEnv()): boolean {
  return apifyEnabled(env) && apifyToken(env) !== null
}

function creditsPerResult(env: ApifyEnv): number {
  const parsed = Number(env[APIFY_CREDITS_PER_RESULT_ENV])
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : APIFY_DEFAULT_CREDITS_PER_RESULT
}

function timeoutMs(env: ApifyEnv): number {
  const parsed = Number(env[APIFY_TIMEOUT_MS_ENV])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : APIFY_DEFAULT_TIMEOUT_MS
}

function capabilityRow(signalKind: ApifyCapabilityKind): AdapterCapability {
  return {
    signal_kind: signalKind,
    // V1 is US B2B people only; a company unit or another geography fails
    // closed at plan time rather than being silently attempted.
    entity_units: ['people'],
    geographies: ['US'],
    channels: ['email', 'linkedin', 'x'],
  }
}

export function apifySourceDescriptor(env: ApifyEnv = processEnv()): AdapterDescriptor {
  return {
    adapter_id: APIFY_SOURCE_ADAPTER_ID,
    layer: 'source',
    capabilities: APIFY_CAPABILITY_KINDS.map(capabilityRow),
    constraints: {
      // PROVISIONAL pending legal review; see APIFY_PROVISIONAL_LICENSE above.
      license: { export: true, customer_display: true, outreach_allowed: true },
      rate_limits: { requests_per_minute: 30, concurrent: 2 },
      max_batch: APIFY_MAX_BATCH,
    },
    // pay-per-result: only usable candidates are charged, a no_result is free
    cost_model: { unit: 'result', quoted_credits_per_unit: creditsPerResult(env), pay_on_found: true },
    ambiguity_contract: { timeout_is_ambiguous: true, receipt_fields: [...APIFY_RECEIPT_FIELDS] },
    // Apify actor runs are marketplace scrapes with no per-subject deletion
    // endpoint. Deletion is handled NOLI-SIDE: the candidate retention sweep
    // (lib/retention/sweep.ts) plus the suppression list, which is what a DSR
    // actually acts on for this layer.
    dsr: { deletion_supported: false },
  }
}

export type ApifyRunActorFn = (
  actorId: string,
  input: Record<string, unknown>,
  options: { token: string; timeoutMs: number; maxItems: number; now: () => Date },
) => Promise<ApifyRunOutcome>

export type ApifySourceDeps = {
  // injected in every test; production falls through to the real client
  runActor?: ApifyRunActorFn
  fetchImpl?: ApifyFetchLike
  env?: ApifyEnv
  now?: () => Date
}

type ReceiptExtras = Record<string, unknown>

function receipt(
  actorId: string | null,
  runId: string | null,
  itemCount: number,
  extras: ReceiptExtras = {},
): Record<string, unknown> {
  // Always carries the declared ambiguity_contract.receipt_fields, on every
  // path including refusals.
  return { actor_id: actorId, run_id: runId, item_count: itemCount, ...extras }
}

function refusal(
  actorId: string | null,
  error: string,
  extras: ReceiptExtras = {},
): AdapterResult<Candidate[]> {
  return {
    status: 'error',
    data: null,
    receipt: receipt(actorId, null, 0, extras),
    cost_units: 0,
    error,
  }
}

export function createApifySourceAdapter(deps: ApifySourceDeps = {}): SourceAdapter {
  const env = deps.env ?? processEnv()
  const now = deps.now ?? (() => new Date())
  const descriptor = apifySourceDescriptor(env)
  const runActor: ApifyRunActorFn =
    deps.runActor ??
    ((actorId, input, options) =>
      runActorSync(actorId, input, {
        token: options.token,
        timeoutMs: options.timeoutMs,
        maxItems: options.maxItems,
        now: options.now,
        fetchImpl: deps.fetchImpl,
      }))

  return {
    descriptor,
    async search(plan: SourceSearchPlan): Promise<AdapterResult<Candidate[]>> {
      const attemptedAt = now().toISOString()

      // 1. Capability check FIRST, before the gate, before any actor
      //    resolution, and before any client call (SPEC-066 11.1: a
      //    contract-disabled capability cannot run even by direct call).
      const coverage = capabilityCovers(descriptor, plan)
      if (!coverage.covered) {
        return refusal(null, `unsupported_capability: ${coverage.reason ?? 'not covered'}`, {
          provider_status: 'unsupported',
          attempted_at: attemptedAt,
        })
      }
      const signalKind = plan.signal_kind.trim().toLowerCase()
      if (!isApifyCapabilityKind(signalKind)) {
        // Defense in depth: the descriptor and the actor registry are two
        // lists; a mismatch must fail closed, not fall through to a run.
        return refusal(null, `unsupported_capability: no Apify actor for ${signalKind}`, {
          provider_status: 'unsupported',
          attempted_at: attemptedAt,
        })
      }
      const actorId = resolveActorId(signalKind, env)

      // 2. HARD GATE. Default OFF, deliberately: this source is legally gated
      //    pending the review in the data-sources map. Returned as an error
      //    result, never thrown.
      if (!apifyEnabled(env)) {
        return refusal(
          actorId,
          `provider_disabled: ${APIFY_ENABLED_ENV} is not 'true'; the Apify source ships dark pending legal review`,
          { provider_status: 'disabled', attempted_at: attemptedAt },
        )
      }
      const token = apifyToken(env)
      if (!token) {
        return refusal(
          actorId,
          `provider_unconfigured: no Apify token configured (${APIFY_TOKEN_ENVS.join(' or ')})`,
          { provider_status: 'unconfigured', attempted_at: attemptedAt },
        )
      }

      // 3. Source post URL, host-checked against the capability.
      const postUrl = extractPostUrl(signalKind, plan.query)
      if (!postUrl.ok) {
        return refusal(actorId, postUrl.reason, {
          provider_status: 'bad_request',
          attempted_at: attemptedAt,
        })
      }

      const cap = Math.max(
        0,
        Math.min(
          Number.isFinite(plan.max_candidates) ? Math.floor(plan.max_candidates) : 0,
          descriptor.constraints.max_batch,
        ),
      )
      if (cap === 0) {
        return refusal(actorId, 'bad_request: max_candidates must be at least 1', {
          provider_status: 'bad_request',
          attempted_at: attemptedAt,
        })
      }

      // 4. The single provider call. maxItems is passed through so we do not
      //    pay for results we would discard at the cap.
      const outcome = await runActor(actorId, buildActorInput(signalKind, { postUrl: postUrl.url, maxItems: cap }), {
        token,
        timeoutMs: timeoutMs(env),
        maxItems: cap,
        now,
      })

      const providerReceipt = (extras: ReceiptExtras = {}) =>
        receipt(outcome.actorId ?? actorId, outcome.runId, outcome.itemCount, {
          provider_status: outcome.kind,
          http_status: outcome.httpStatus,
          request_url: outcome.requestUrl,
          attempted_at: outcome.attemptedAt,
          ...(outcome.retryAfterSeconds != null
            ? { retry_after_seconds: outcome.retryAfterSeconds }
            : {}),
          ...(outcome.bodySnippet != null ? { body_snippet: outcome.bodySnippet } : {}),
          ...extras,
        })

      // 5. Classify. The client already mapped HTTP/transport conditions to
      //    AdapterResult statuses; we only attach data and cost.
      if (outcome.status === 'ambiguous') {
        // Unknown spend: cost_units null so the wrapper parks the operation
        // for reconciliation instead of inferring a charge. Never retried.
        return {
          status: 'ambiguous',
          data: null,
          receipt: providerReceipt(),
          cost_units: null,
          error: outcome.error ?? 'ambiguous provider outcome',
        }
      }
      if (outcome.status === 'error') {
        return {
          status: 'error',
          data: null,
          receipt: providerReceipt(),
          cost_units: 0,
          error: outcome.error ?? 'provider error',
        }
      }
      if (outcome.status === 'no_result') {
        // pay_on_found: a definitive empty answer costs zero units.
        return {
          status: 'no_result',
          data: null,
          receipt: providerReceipt(),
          cost_units: 0,
        }
      }

      const normalized = normalizeItems(signalKind, outcome.items, {
        postUrl: postUrl.url,
        observedAt: attemptedAt,
      })
      const capped = normalized.candidates.slice(0, cap)
      if (capped.length === 0) {
        // The actor returned rows but none carried a usable identity. That is
        // a definitive empty answer for us; we do not invent names to bill.
        return {
          status: 'no_result',
          data: null,
          receipt: providerReceipt({
            returned_count: 0,
            dropped_items: normalized.dropped,
          }),
          cost_units: 0,
        }
      }
      return {
        status: 'ok',
        data: capped,
        receipt: providerReceipt({
          returned_count: capped.length,
          dropped_items: normalized.dropped,
          truncated: normalized.candidates.length > capped.length,
        }),
        // Charged on usable candidates delivered, not on raw items fetched.
        // item_count stays on the receipt so provider spend can be reconciled
        // against what we billed.
        cost_units: capped.length,
      }
    },
  }
}
