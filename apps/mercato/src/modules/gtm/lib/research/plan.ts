import { capabilityCovers, type SourceAdapter } from '../adapters/types'
import { computeExecutionEligibility } from '../eligibility'
import { creditsForUnits, defaultMarkupMultiplier } from '../credits/markup'

/*
 * Pure research-run planning (SPEC-066 sections 7 and 11.1). No ORM, no
 * framework imports, no side effects: the route persists what this returns.
 *
 * Fail-closed rules implemented here:
 * - Boundary 1 of the section 7 ladder: a non-executable play can never be
 *   priced or planned. Eligibility is RECOMPUTED from the play's own market
 *   and geography fields; the stored value and the caller's claims are never
 *   trusted.
 * - A requested dimension with no covering adapter capability surfaces as an
 *   unsupportedDimensions entry BEFORE any spend (section 11.1).
 * - An empty adapter plan is a typed plan error, never a silent empty run.
 */

// Build-plan default: the first batch targets 25 prospects.
export const DEFAULT_MAX_CANDIDATES = 25
export const MAX_CANDIDATES_HARD_CAP = 100

export type PlanPlayInput = {
  id?: string
  marketType?: string | null
  geography?: string | null
  signal?: string | null
  entityUnit?: string | null
  audience?: string | null
}

export type ResearchLimitsInput = {
  maxCandidates?: number | null
  maxCredits?: number | null
}

export type ResearchLimits = {
  maxCandidates: number
  maxCredits: number
}

export type SourcePlanBatch = {
  adapter_id: string
  capability: {
    signal_kind: string
    entity_unit: string
    geography: string
  }
  estimatedUnits: number
  quotedCreditsPerUnit: number
  estimatedCredits: number
}

export type UnsupportedDimension = {
  adapter_id: string
  dimension: string
  reason: string
}

export type SourcePlanErrorCode =
  | 'play_not_executable'
  | 'missing_play_dimensions'
  | 'empty_adapter_plan'

export type SourcePlanFailure = {
  ok: false
  code: SourcePlanErrorCode
  reason: string
  unsupportedDimensions: UnsupportedDimension[]
}

export type SourcePlanSuccess = {
  ok: true
  adapterPlan: SourcePlanBatch[]
  estimatedCredits: number
  unsupportedDimensions: UnsupportedDimension[]
  limits: ResearchLimits
  // deterministic provider query derived from the play at plan time; frozen
  // into the run's input snapshot so execution replays the exact plan
  query: string
}

export type SourcePlanResult = SourcePlanSuccess | SourcePlanFailure

function clampMaxCandidates(requested: number | null | undefined): number {
  if (requested == null || !Number.isFinite(requested)) return DEFAULT_MAX_CANDIDATES
  const rounded = Math.floor(requested)
  if (rounded < 1) return 1
  return Math.min(rounded, MAX_CANDIDATES_HARD_CAP)
}

// Maps a capabilityCovers reason string onto the dimension it names, so the
// caller can show which requested dimension is unsupported.
function dimensionFromReason(reason: string): string {
  const missing = reason.match(/^missing required dimension: (\w+)/)
  if (missing) return missing[1]
  const unsupported = reason.match(/^unsupported (\w+)/)
  if (unsupported) return unsupported[1]
  return 'unknown'
}

export function buildSourcePlan(
  play: PlanPlayInput,
  adapters: SourceAdapter[],
  limits?: ResearchLimitsInput | null,
  markupMultiplier: number = defaultMarkupMultiplier(),
): SourcePlanResult {
  // Boundary 1 (section 7): recompute eligibility server-side; anything other
  // than 'executable' fails closed before any pricing.
  const eligibility = computeExecutionEligibility({
    market_type: play.marketType ?? null,
    geography: play.geography ?? null,
  })
  if (eligibility.execution_eligibility !== 'executable') {
    return {
      ok: false,
      code: 'play_not_executable',
      reason: eligibility.eligibility_reason,
      unsupportedDimensions: [],
    }
  }

  const signalKind = (play.signal ?? '').trim()
  const entityUnit = (play.entityUnit ?? '').trim()
  if (!signalKind || !entityUnit) {
    return {
      ok: false,
      code: 'missing_play_dimensions',
      reason: `play is missing required dimensions for sourcing: ${[
        !signalKind ? 'signal' : null,
        !entityUnit ? 'entity_unit' : null,
      ]
        .filter(Boolean)
        .join(', ')}`,
      unsupportedDimensions: [],
    }
  }

  // V1 is US-only and eligibility above has already proven a US geography, so
  // the capability request uses the country code; the play's raw geography
  // text stays in the query for the provider.
  const geographyCode = 'US'

  const maxCandidates = clampMaxCandidates(limits?.maxCandidates)

  const adapterPlan: SourcePlanBatch[] = []
  const unsupportedDimensions: UnsupportedDimension[] = []
  let remaining = maxCandidates

  for (const adapter of adapters) {
    const descriptor = adapter.descriptor
    if (descriptor.layer !== 'source') continue
    const coverage = capabilityCovers(descriptor, {
      signal_kind: signalKind,
      entity_unit: entityUnit,
      geography: geographyCode,
    })
    if (!coverage.covered) {
      const reason = coverage.reason ?? 'not covered'
      unsupportedDimensions.push({
        adapter_id: descriptor.adapter_id,
        dimension: dimensionFromReason(reason),
        reason,
      })
      continue
    }
    if (remaining <= 0) continue
    const estimatedUnits = Math.min(remaining, descriptor.constraints.max_batch)
    if (estimatedUnits <= 0) continue
    adapterPlan.push({
      adapter_id: descriptor.adapter_id,
      capability: {
        signal_kind: signalKind,
        entity_unit: entityUnit,
        geography: geographyCode,
      },
      estimatedUnits,
      quotedCreditsPerUnit: descriptor.cost_model.quoted_credits_per_unit,
      estimatedCredits: creditsForUnits(
        estimatedUnits,
        descriptor.cost_model.quoted_credits_per_unit,
        markupMultiplier,
      ),
    })
    remaining -= estimatedUnits
  }

  // An empty adapter plan fails closed: never a silent empty run.
  if (adapterPlan.length === 0) {
    return {
      ok: false,
      code: 'empty_adapter_plan',
      reason: 'no adapter capability covers the requested play dimensions',
      unsupportedDimensions,
    }
  }

  const estimatedCredits = adapterPlan.reduce((sum, batch) => sum + batch.estimatedCredits, 0)
  const requestedMaxCredits = limits?.maxCredits
  const maxCredits =
    requestedMaxCredits != null && Number.isFinite(requestedMaxCredits) && requestedMaxCredits >= 1
      ? Math.floor(requestedMaxCredits)
      : estimatedCredits

  const query = [play.audience, play.signal]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')

  return {
    ok: true,
    adapterPlan,
    estimatedCredits,
    unsupportedDimensions,
    limits: { maxCandidates, maxCredits },
    query,
  }
}
