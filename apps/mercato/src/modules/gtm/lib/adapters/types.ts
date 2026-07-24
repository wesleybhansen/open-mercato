/*
 * Provider adapter capability contracts (SPEC-066 section 11.1, frozen shape).
 *
 * Every adapter (source, enrichment, verification, sending) declares a static
 * AdapterDescriptor consumed by planning/pricing and enforced at run time. A
 * requested dimension with no covering capability fails closed at PLAN time
 * (capabilityCovers, below) before any invoke, and the same check runs again
 * inside every adapter invoke path so a contract-disabled capability cannot
 * run even by direct call.
 *
 * Pure types + one pure function; no ORM or framework imports.
 */

export type AdapterLayer = 'source' | 'enrich' | 'verify' | 'send'

export type AdapterChannel = 'email' | 'linkedin' | 'x'

/*
 * One capability row: the adapter can service `signal_kind` for the listed
 * entity units / geographies / channels. Entries compare case-insensitively;
 * '*' is an explicit wildcard entry. A geography entry covers itself and its
 * hyphenated subdivisions ('US' covers 'US-CA'; 'US-CA' does not cover 'US').
 * `channels: []` means the capability has no channel dimension at all (e.g. a
 * pure source search); any channel-bearing request against it is unsupported.
 */
export type AdapterCapability = {
  signal_kind: string
  entity_units: string[]
  geographies: string[]
  channels: string[]
}

export type AdapterLicenseConstraints = {
  export: boolean
  customer_display: boolean
  outreach_allowed: boolean
}

export type AdapterRateLimits = {
  requests_per_minute?: number
  concurrent?: number
}

export type AdapterConstraints = {
  license: AdapterLicenseConstraints
  rate_limits?: AdapterRateLimits
  max_batch: number
}

export type AdapterCostModel = {
  // what one billed unit is, e.g. 'candidate' | 'contact_point' | 'verification'
  unit: string
  quoted_credits_per_unit: number
  // true = only found/returned units are charged (no_result costs 0)
  pay_on_found: boolean
}

export type AdapterAmbiguityContract = {
  // true = a timeout maps to status 'ambiguous', never to a silent retry
  timeout_is_ambiguous: boolean
  // field names every receipt this adapter returns must carry
  receipt_fields: string[]
}

export type AdapterDsr = {
  deletion_supported: boolean
}

export type AdapterDescriptor = {
  adapter_id: string
  layer: AdapterLayer
  capabilities: AdapterCapability[]
  constraints: AdapterConstraints
  cost_model: AdapterCostModel
  ambiguity_contract: AdapterAmbiguityContract
  dsr: AdapterDsr
}

/*
 * Uniform adapter result envelope.
 * - 'ok'        full result
 * - 'no_result' the provider answered definitively with nothing found
 * - 'partial'   some units returned, the rest definitively unavailable
 * - 'error'     definitive failure, safe to retry via a NEW operation
 * - 'ambiguous' unknown outcome (timeout / accepted-unconfirmed / pending):
 *               never auto-retried, parked for reconciliation (section 6/11)
 * `receipt` always carries the descriptor's ambiguity_contract.receipt_fields.
 * `cost_units` is null when spend is unknown (ambiguous), 0 when nothing was
 * charged, otherwise the charged unit count.
 */
export type AdapterResultStatus = 'ok' | 'no_result' | 'partial' | 'error' | 'ambiguous'

export type AdapterResult<T> = {
  status: AdapterResultStatus
  data: T | null
  receipt: Record<string, unknown> | null
  cost_units: number | null
  error?: string
}

// ---------------------------------------------------------------------------
// Domain payloads (narrow, matching the gtm_candidates / gtm_evidence /
// gtm_contact_points column vocabulary)
// ---------------------------------------------------------------------------

export type CandidateIdentity = {
  name: string
  company?: string | null
  title?: string | null
  domain?: string | null
  urls?: string[]
}

export type CandidateEvidence = {
  claim: string
  source_url: string | null
  observed_at: string
  confidence: number
  /*
   * Optional inert provider payload for this observation (engagement kind,
   * reaction types, the comment body, the actor's echo of the source post).
   * DATA ONLY: it is stored on the evidence row's provider_ref jsonb and is
   * never interpolated into a claim, a template, or any instruction path.
   * Omitted entirely when the adapter has nothing verified to put in it.
   */
  detail?: Record<string, unknown>
}

export type Candidate = {
  entity_kind: 'person' | 'company'
  identity: CandidateIdentity
  evidence: CandidateEvidence[]
}

export type ContactPoint = {
  channel: AdapterChannel
  value: string
  provenance?: Record<string, unknown>
}

// mirrors gtm_contact_points.verification_state
export type VerificationState =
  | 'found'
  | 'verified'
  | 'risky'
  | 'catch_all'
  | 'not_found'
  | 'provider_ambiguous'

export type VerificationOutcome = {
  channel: AdapterChannel
  value: string
  verification_state: VerificationState
}

// ---------------------------------------------------------------------------
// Invocation parameter types
// ---------------------------------------------------------------------------

/*
 * `call_sequence` makes multi-call provider behavior (delayed completion,
 * webhook replay) explicitly deterministic: the caller states which attempt
 * this is (1-based) instead of the adapter keeping hidden state. It is
 * excluded from input identity/idempotency hashing.
 */
export type SourceSearchPlan = {
  signal_kind: string
  entity_unit: string
  geography: string
  query: string
  max_candidates: number
  call_sequence?: number
  /*
   * Optional per-batch provider budget in USD, i.e. what the caller reserved
   * for this one call. Adapters whose provider accepts a hard per-run spend
   * cap (Apify's mandatory maxTotalChargeUsd) pass it straight through, so the
   * provider enforces our budget server side as well as our ledger enforcing
   * it locally. Omitted when the caller has no USD-denominated budget; the
   * adapter then falls back to its own configured cap.
   */
  max_charge_usd?: number
}

export type EnrichRequest = {
  signal_kind: string
  entity_unit: string
  geography: string
  channel: AdapterChannel
  candidate: Pick<Candidate, 'entity_kind' | 'identity'>
  call_sequence?: number
}

export type VerifyRequest = {
  signal_kind: string
  entity_unit: string
  geography: string
  channel: AdapterChannel
  value: string
  call_sequence?: number
}

export interface SourceAdapter {
  descriptor: AdapterDescriptor
  search(plan: SourceSearchPlan): Promise<AdapterResult<Candidate[]>>
}

export interface EnrichAdapter {
  descriptor: AdapterDescriptor
  enrich(request: EnrichRequest): Promise<AdapterResult<ContactPoint[]>>
}

export interface VerifyAdapter {
  descriptor: AdapterDescriptor
  verify(request: VerifyRequest): Promise<AdapterResult<VerificationOutcome>>
}

// ---------------------------------------------------------------------------
// Plan-time capability check (fail-closed)
// ---------------------------------------------------------------------------

export type CapabilityRequest = {
  signal_kind?: string | null
  entity_unit?: string | null
  geography?: string | null
  channel?: string | null
}

export type CapabilityCoverage = {
  covered: boolean
  reason?: string
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function entryMatches(entry: string, requested: string): boolean {
  const e = norm(entry)
  return e === '*' || e === requested
}

function geographyMatches(entry: string, requested: string): boolean {
  const e = norm(entry)
  if (e === '*' || e === requested) return true
  // hierarchical: 'us' covers 'us-ca'; never the reverse
  return requested.startsWith(`${e}-`)
}

/*
 * Returns { covered: true } only when one single capability row covers EVERY
 * requested dimension. Anything missing, unknown, or uncovered returns
 * { covered: false, reason } so planning can surface "unsupported dimension"
 * BEFORE any spend and before any adapter invoke (SPEC-066 section 11.1).
 *
 * Fail-closed rules:
 * - signal_kind, entity_unit, and geography are always required
 * - channel is required for 'verify' and 'send' layer adapters, and is
 *   checked whenever provided for any layer
 */
export function capabilityCovers(
  descriptor: AdapterDescriptor,
  request: CapabilityRequest,
): CapabilityCoverage {
  const signalKind = norm(request.signal_kind)
  const entityUnit = norm(request.entity_unit)
  const geography = norm(request.geography)
  const channel = norm(request.channel)
  const channelRequired = descriptor.layer === 'verify' || descriptor.layer === 'send'

  if (!signalKind) return { covered: false, reason: 'missing required dimension: signal_kind' }
  if (!entityUnit) return { covered: false, reason: 'missing required dimension: entity_unit' }
  if (!geography) return { covered: false, reason: 'missing required dimension: geography' }
  if (channelRequired && !channel) {
    return { covered: false, reason: 'missing required dimension: channel' }
  }

  const bySignal = descriptor.capabilities.filter((cap) => norm(cap.signal_kind) === signalKind)
  if (bySignal.length === 0) {
    return { covered: false, reason: `unsupported signal_kind: ${signalKind}` }
  }

  const byUnit = bySignal.filter((cap) =>
    cap.entity_units.some((unit) => entryMatches(unit, entityUnit)),
  )
  if (byUnit.length === 0) {
    return { covered: false, reason: `unsupported entity_unit: ${entityUnit} for signal_kind ${signalKind}` }
  }

  const byGeo = byUnit.filter((cap) =>
    cap.geographies.some((geo) => geographyMatches(geo, geography)),
  )
  if (byGeo.length === 0) {
    return { covered: false, reason: `unsupported geography: ${geography} for signal_kind ${signalKind}` }
  }

  if (channel) {
    const byChannel = byGeo.filter((cap) =>
      cap.channels.some((entry) => entryMatches(entry, channel)),
    )
    if (byChannel.length === 0) {
      return { covered: false, reason: `unsupported channel: ${channel} for signal_kind ${signalKind}` }
    }
  }

  return { covered: true }
}
