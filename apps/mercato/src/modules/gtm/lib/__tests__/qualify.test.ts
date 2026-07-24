import type { CandidateEvidence } from '../adapters/types'
import {
  FIT_ACCEPT_THRESHOLD,
  FIT_REASONS,
  ruleBasedFitScorer,
  summarizeFitResults,
  type FitResult,
} from '../research/qualify'

const play = { entityUnit: 'companies', geography: 'California, US' }

const strongEvidence: CandidateEvidence[] = [
  {
    claim: 'Posted a job opening for a revenue operations lead',
    source_url: 'https://jobs.example-dynamics.example/rev-ops-lead',
    observed_at: '2026-07-20T09:00:00.000Z',
    confidence: 0.9,
  },
]

const company = {
  entity_kind: 'company' as const,
  identity: { name: 'Example Dynamics LLC', domain: 'example-dynamics.example' },
}

describe('ruleBasedFitScorer', () => {
  it('is deterministic: identical input always yields identical output', () => {
    const a = ruleBasedFitScorer.score(company, play, strongEvidence)
    const b = ruleBasedFitScorer.score(company, play, strongEvidence)
    expect(a).toEqual(b)
  })

  it('accepts a well-evidenced in-scope company', () => {
    const result = ruleBasedFitScorer.score(company, play, strongEvidence)
    expect(result.verdict).toBe('accepted')
    expect(result.fitScore).toBeGreaterThanOrEqual(FIT_ACCEPT_THRESHOLD)
    expect(result.reason).toBe(FIT_REASONS.accepted)
  })

  it('rejects an entity kind that does not match the play entity unit', () => {
    const person = {
      entity_kind: 'person' as const,
      identity: { name: 'Alex Example', domain: 'example-dynamics.example' },
    }
    const result = ruleBasedFitScorer.score(person, play, strongEvidence)
    expect(result.verdict).toBe('rejected')
    expect(result.reason).toBe(FIT_REASONS.entityKindMismatch)
  })

  it('rejects a candidate located outside the play geography', () => {
    const abroad = {
      entity_kind: 'company' as const,
      identity: { name: 'Example GmbH', domain: 'example.example', location: 'Berlin, Germany' },
    }
    const result = ruleBasedFitScorer.score(abroad, play, strongEvidence)
    expect(result.verdict).toBe('rejected')
    expect(result.reason).toBe(FIT_REASONS.outsideGeography)
  })

  it('rejects a nameless identity outright', () => {
    const result = ruleBasedFitScorer.score(
      { entity_kind: 'company', identity: { name: '  ' } },
      play,
      strongEvidence,
    )
    expect(result.verdict).toBe('rejected')
    expect(result.reason).toBe(FIT_REASONS.missingName)
    expect(result.fitScore).toBe(0)
  })

  it('rejects with an explicit reason when evidence is missing', () => {
    const result = ruleBasedFitScorer.score(company, play, [])
    expect(result.verdict).toBe('rejected')
    expect(result.reason).toBe(FIT_REASONS.noEvidence)
  })

  it('rejects with an explicit reason for weak evidence confidence', () => {
    const weak = strongEvidence.map((row) => ({ ...row, confidence: 0.2 }))
    const result = ruleBasedFitScorer.score(company, play, weak)
    expect(result.verdict).toBe('rejected')
    expect(result.reason).toBe(FIT_REASONS.weakEvidence)
  })

  it('never leaves a rejected candidate without a reason', () => {
    const inputs = [
      { candidate: company, evidence: [] as CandidateEvidence[] },
      { candidate: { entity_kind: 'company' as const, identity: { name: 'No Domain Co' } }, evidence: [] as CandidateEvidence[] },
      {
        candidate: { entity_kind: 'person' as const, identity: { name: 'Wrong Kind' } },
        evidence: strongEvidence,
      },
    ]
    for (const { candidate, evidence } of inputs) {
      const result = ruleBasedFitScorer.score(candidate, play, evidence)
      if (result.verdict === 'rejected') {
        expect(result.reason.length).toBeGreaterThan(0)
      }
    }
  })

  it('clamps the score into 0-100 as an integer', () => {
    const result = ruleBasedFitScorer.score(
      {
        entity_kind: 'company',
        identity: { name: 'Example Dynamics LLC', domain: 'example-dynamics.example', location: 'San Diego, CA' },
      },
      play,
      strongEvidence.map((row) => ({ ...row, confidence: 1 })),
    )
    expect(Number.isInteger(result.fitScore)).toBe(true)
    expect(result.fitScore).toBeLessThanOrEqual(100)
    expect(result.fitScore).toBeGreaterThanOrEqual(0)
  })
})

describe('summarizeFitResults', () => {
  it('produces the accepted/rejected distribution with per-reason counts', () => {
    const results: FitResult[] = [
      { fitScore: 80, verdict: 'accepted', reason: FIT_REASONS.accepted },
      { fitScore: 70, verdict: 'accepted', reason: FIT_REASONS.accepted },
      { fitScore: 30, verdict: 'rejected', reason: FIT_REASONS.noEvidence },
      { fitScore: 0, verdict: 'rejected', reason: FIT_REASONS.entityKindMismatch },
      { fitScore: 40, verdict: 'rejected', reason: FIT_REASONS.noEvidence },
    ]
    expect(summarizeFitResults(results)).toEqual({
      accepted: 2,
      rejected: 3,
      byReason: {
        [FIT_REASONS.accepted]: 2,
        [FIT_REASONS.noEvidence]: 2,
        [FIT_REASONS.entityKindMismatch]: 1,
      },
    })
  })

  it('handles an empty result set', () => {
    expect(summarizeFitResults([])).toEqual({ accepted: 0, rejected: 0, byReason: {} })
  })
})
