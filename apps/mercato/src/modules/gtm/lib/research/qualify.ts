import type { Candidate, CandidateEvidence } from '../adapters/types'
import { isUsGeography } from '../eligibility'

/*
 * Deterministic rule-based fit scoring v1 (SPEC-066 Tranche 3 qualification).
 *
 * An LLM scorer is a LATER tranche; it will implement the same FitScorer
 * interface so execution code never changes. Rules here are pure, ordered,
 * and reproducible: the same candidate + play + evidence always yields the
 * same score and verdict. Every rejected candidate carries an explicit
 * reject reason; a blank reason is impossible by construction.
 */

export type FitVerdict = 'accepted' | 'rejected'

export type FitResult = {
  // integer 0-100
  fitScore: number
  verdict: FitVerdict
  reason: string
}

export type FitPlayInput = {
  entityUnit?: string | null
  geography?: string | null
}

export type FitCandidateInput = Pick<Candidate, 'entity_kind' | 'identity'>

export interface FitScorer {
  score(candidate: FitCandidateInput, play: FitPlayInput, evidence: CandidateEvidence[]): FitResult
}

export const FIT_ACCEPT_THRESHOLD = 60

export const FIT_REASONS = {
  accepted: 'meets_fit_rules',
  entityKindMismatch: 'entity_kind_mismatch',
  missingName: 'missing_identity_name',
  outsideGeography: 'outside_play_geography',
  noEvidence: 'no_supporting_evidence',
  weakEvidence: 'weak_evidence_confidence',
  noDomain: 'no_domain',
  belowThreshold: 'below_fit_threshold',
} as const

function unitWantsCompany(entityUnit: string): boolean {
  return entityUnit.trim().toLowerCase().startsWith('compan')
}

function unitWantsPerson(entityUnit: string): boolean {
  const unit = entityUnit.trim().toLowerCase()
  return unit.startsWith('people') || unit.startsWith('person') || unit.startsWith('contact')
}

// Candidate location, when the source provided one, rides in the identity
// jsonb under one of these keys; absence is scored as unknown, not as a
// failure.
function candidateLocation(identity: Record<string, unknown>): string | null {
  for (const key of ['location', 'city', 'geography', 'region']) {
    const value = identity[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function averageConfidence(evidence: CandidateEvidence[]): number {
  if (evidence.length === 0) return 0
  const sum = evidence.reduce((total, row) => {
    const value = Number(row.confidence)
    return total + (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0)
  }, 0)
  return sum / evidence.length
}

export const ruleBasedFitScorer: FitScorer = {
  score(candidate, play, evidence): FitResult {
    const identity = (candidate.identity ?? {}) as Record<string, unknown>
    const name = typeof identity.name === 'string' ? identity.name.trim() : ''

    // Hard rules first: each yields an explicit reject reason.
    if (!name) {
      return { fitScore: 0, verdict: 'rejected', reason: FIT_REASONS.missingName }
    }

    const entityUnit = (play.entityUnit ?? '').trim()
    if (entityUnit) {
      const mismatch =
        (unitWantsCompany(entityUnit) && candidate.entity_kind !== 'company') ||
        (unitWantsPerson(entityUnit) && candidate.entity_kind !== 'person')
      if (mismatch) {
        return { fitScore: 0, verdict: 'rejected', reason: FIT_REASONS.entityKindMismatch }
      }
    }

    const playGeography = (play.geography ?? '').trim()
    const location = candidateLocation(identity)
    if (playGeography && location && isUsGeography(playGeography) && !isUsGeography(location)) {
      return { fitScore: 0, verdict: 'rejected', reason: FIT_REASONS.outsideGeography }
    }

    // Weighted score: name 20, domain 25, geography 15 (5 when unknown),
    // evidence confidence up to 40. Confidence below 0.25 cannot clear the
    // threshold even with a domain, so weak evidence is always explicit.
    const hasDomain = typeof identity.domain === 'string' && identity.domain.trim().length > 0
    const avgConfidence = averageConfidence(evidence)
    const score =
      20 +
      (hasDomain ? 25 : 0) +
      (location ? 15 : 5) +
      avgConfidence * 40

    const fitScore = Math.max(0, Math.min(100, Math.round(score)))
    if (fitScore >= FIT_ACCEPT_THRESHOLD) {
      return { fitScore, verdict: 'accepted', reason: FIT_REASONS.accepted }
    }

    // Explicit dominant deficiency for the reject reason.
    let reason: string = FIT_REASONS.belowThreshold
    if (evidence.length === 0) reason = FIT_REASONS.noEvidence
    else if (avgConfidence < 0.5) reason = FIT_REASONS.weakEvidence
    else if (!hasDomain) reason = FIT_REASONS.noDomain
    return { fitScore, verdict: 'rejected', reason }
  },
}

export type FitDistribution = {
  accepted: number
  rejected: number
  byReason: Record<string, number>
}

export function summarizeFitResults(results: FitResult[]): FitDistribution {
  const summary: FitDistribution = { accepted: 0, rejected: 0, byReason: {} }
  for (const result of results) {
    if (result.verdict === 'accepted') summary.accepted += 1
    else summary.rejected += 1
    summary.byReason[result.reason] = (summary.byReason[result.reason] ?? 0) + 1
  }
  return summary
}
