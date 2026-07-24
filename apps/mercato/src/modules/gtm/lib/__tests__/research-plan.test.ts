import { fixtureSourceAdapter, fixtureSourceDescriptor } from '../adapters/fixture'
import type { SourceAdapter } from '../adapters/types'
import {
  buildSourcePlan,
  DEFAULT_MAX_CANDIDATES,
  MAX_CANDIDATES_HARD_CAP,
  type PlanPlayInput,
} from '../research/plan'

const executablePlay: PlanPlayInput = {
  marketType: 'b2b',
  geography: 'California, US',
  signal: 'hiring_activity',
  entityUnit: 'companies',
  audience: 'B2B companies hiring revenue operations leads',
}

const adapters: SourceAdapter[] = [fixtureSourceAdapter]

describe('buildSourcePlan fail-closed boundaries', () => {
  it('fails closed on a strategy_only play (section 7 ladder boundary 1)', () => {
    const plan = buildSourcePlan({ ...executablePlay, marketType: 'b2c' }, adapters)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('play_not_executable')
      expect(plan.reason).toContain('strategy guidance only')
    }
  })

  it('recomputes eligibility from the play fields, never trusting a stored value', () => {
    // Non-US geography must fail even if a caller claimed the play executable.
    const plan = buildSourcePlan({ ...executablePlay, geography: 'Berlin, Germany' }, adapters)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('play_not_executable')
  })

  it('fails closed on an unsupported signal with an empty adapter plan', () => {
    const plan = buildSourcePlan({ ...executablePlay, signal: 'website_visits' }, adapters)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('empty_adapter_plan')
      expect(plan.unsupportedDimensions).toEqual([
        expect.objectContaining({
          adapter_id: 'fixture-source',
          dimension: 'signal_kind',
        }),
      ])
    }
  })

  it('fails closed when the play is missing sourcing dimensions', () => {
    const plan = buildSourcePlan({ ...executablePlay, signal: null }, adapters)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('missing_play_dimensions')
  })

  it('never silently plans with zero adapters', () => {
    const plan = buildSourcePlan(executablePlay, [])
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('empty_adapter_plan')
  })
})

describe('buildSourcePlan pricing and limits', () => {
  it('plans the default first batch of 25 prospects with 2x markup pricing', () => {
    const plan = buildSourcePlan(executablePlay, adapters, null, 2)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(DEFAULT_MAX_CANDIDATES).toBe(25)
      expect(plan.limits.maxCandidates).toBe(25)
      expect(plan.adapterPlan).toEqual([
        expect.objectContaining({
          adapter_id: 'fixture-source',
          estimatedUnits: 25,
          quotedCreditsPerUnit: 1,
          estimatedCredits: 50,
        }),
      ])
      expect(plan.estimatedCredits).toBe(50)
      // maxCredits defaults to the plan estimate: the run can never reserve
      // beyond what was priced
      expect(plan.limits.maxCredits).toBe(50)
      expect(plan.query).toContain('revenue operations')
    }
  })

  it('caps maxCandidates at the hard cap of 100', () => {
    const plan = buildSourcePlan(executablePlay, adapters, { maxCandidates: 500 }, 2)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(MAX_CANDIDATES_HARD_CAP).toBe(100)
      expect(plan.limits.maxCandidates).toBe(100)
      // one adapter with max_batch 25 can only take one 25-unit batch
      expect(plan.adapterPlan[0].estimatedUnits).toBe(fixtureSourceDescriptor.constraints.max_batch)
    }
  })

  it('respects an explicit maxCredits limit', () => {
    const plan = buildSourcePlan(executablePlay, adapters, { maxCandidates: 10, maxCredits: 12 }, 2)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.limits).toEqual({ maxCandidates: 10, maxCredits: 12 })
      expect(plan.estimatedCredits).toBe(20)
    }
  })

  it('allocates remaining candidates across additional covering adapters', () => {
    const secondAdapter: SourceAdapter = {
      descriptor: { ...fixtureSourceDescriptor, adapter_id: 'fixture-source-b' },
      search: fixtureSourceAdapter.search,
    }
    const plan = buildSourcePlan(executablePlay, [fixtureSourceAdapter, secondAdapter], {
      maxCandidates: 30,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.adapterPlan.map((batch) => [batch.adapter_id, batch.estimatedUnits])).toEqual([
        ['fixture-source', 25],
        ['fixture-source-b', 5],
      ])
    }
  })
})
