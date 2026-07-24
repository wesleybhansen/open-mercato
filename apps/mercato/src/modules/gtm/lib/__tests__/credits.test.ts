import {
  FixtureLedger,
  GtmCreditLedgerError,
  deterministicOperationId,
  type GtmReserveInput,
} from '../credits/ledger'
import { creditsForUnits, defaultMarkupMultiplier } from '../credits/markup'

const ORG = 'org-11111111'
const USER = 'user-22222222'

function reserveInput(overrides?: Partial<GtmReserveInput>): GtmReserveInput {
  return {
    orgId: ORG,
    userId: USER,
    kind: 'source_search',
    provider: 'fixture-source',
    estimatedCredits: 10,
    idempotencyKey: 'run-1:fixture-source:1',
    unitCostSnapshot: { unit: 'candidate', quoted_credits_per_unit: 1, markup_multiplier: 2 },
    fingerprint: { research_run_id: 'run-1' },
    ...overrides,
  }
}

describe('creditsForUnits markup', () => {
  const originalMarkup = process.env.GTM_CREDIT_MARKUP

  afterEach(() => {
    if (originalMarkup === undefined) delete process.env.GTM_CREDIT_MARKUP
    else process.env.GTM_CREDIT_MARKUP = originalMarkup
  })

  it('applies the default 2x markup with integer ceil', () => {
    delete process.env.GTM_CREDIT_MARKUP
    expect(creditsForUnits(25, 1)).toBe(50)
    expect(creditsForUnits(3, 1.1)).toBe(7) // 3 * 1.1 * 2 = 6.6 -> 7
  })

  it('never returns zero credits for a nonzero unit count', () => {
    expect(creditsForUnits(1, 0.01, 2)).toBe(1)
    expect(creditsForUnits(0, 5, 2)).toBe(0)
  })

  it('reads the markup from GTM_CREDIT_MARKUP with a 2 fallback', () => {
    process.env.GTM_CREDIT_MARKUP = '3'
    expect(defaultMarkupMultiplier()).toBe(3)
    expect(creditsForUnits(2, 1)).toBe(6)
    process.env.GTM_CREDIT_MARKUP = 'not-a-number'
    expect(defaultMarkupMultiplier()).toBe(2)
    delete process.env.GTM_CREDIT_MARKUP
    expect(defaultMarkupMultiplier()).toBe(2)
  })

  it('rejects invalid inputs instead of silently pricing them', () => {
    expect(() => creditsForUnits(-1, 1, 2)).toThrow(TypeError)
    expect(() => creditsForUnits(1, -1, 2)).toThrow(TypeError)
    expect(() => creditsForUnits(1, 1, 0)).toThrow(TypeError)
  })
})

describe('FixtureLedger reserve', () => {
  it('creates deterministic operation ids from org + idempotency key', async () => {
    const a = new FixtureLedger()
    const b = new FixtureLedger()
    const first = await a.reserve(reserveInput())
    const second = await b.reserve(reserveInput())
    expect(first.operationId).toBe(second.operationId)
    expect(first.operationId).toBe(deterministicOperationId(ORG, 'run-1:fixture-source:1'))
    expect(first.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('is idempotent: the same key returns the same operation without a second reservation', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const first = await ledger.reserve(reserveInput())
    const repeat = await ledger.reserve(reserveInput({ estimatedCredits: 99 }))
    expect(repeat.operationId).toBe(first.operationId)
    expect(ledger.listOperations()).toHaveLength(1)
    expect(ledger.availableCredits()).toBe(90)
  })

  it('returns the CURRENT status on a repeat reserve after progress', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    await ledger.start(operationId)
    await ledger.settle(operationId, 'charged', 10, { receipt: true })
    const repeat = await ledger.reserve(reserveInput())
    expect(repeat.status).toBe('charged')
  })

  it('handles concurrent duplicate reserves as one operation', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const [a, b] = await Promise.all([ledger.reserve(reserveInput()), ledger.reserve(reserveInput())])
    expect(a.operationId).toBe(b.operationId)
    expect(ledger.listOperations()).toHaveLength(1)
    expect(ledger.availableCredits()).toBe(90)
  })

  it('fails closed on insufficient credits', async () => {
    const ledger = new FixtureLedger({ poolBalance: 5 })
    await expect(ledger.reserve(reserveInput({ estimatedCredits: 10 }))).rejects.toMatchObject({
      code: 'insufficient_credits',
    })
    expect(ledger.listOperations()).toHaveLength(0)
  })

  it('counts outstanding reservations against headroom', async () => {
    const ledger = new FixtureLedger({ poolBalance: 15 })
    await ledger.reserve(reserveInput({ estimatedCredits: 10 }))
    await expect(
      ledger.reserve(reserveInput({ idempotencyKey: 'run-1:fixture-source:2', estimatedCredits: 10 })),
    ).rejects.toMatchObject({ code: 'insufficient_credits' })
  })

  it('rejects unbounded or zero-value reservations', async () => {
    const ledger = new FixtureLedger()
    await expect(ledger.reserve(reserveInput({ estimatedCredits: 0 }))).rejects.toMatchObject({
      code: 'invalid_reserve',
    })
    await expect(ledger.reserve(reserveInput({ estimatedCredits: 2.5 }))).rejects.toMatchObject({
      code: 'invalid_reserve',
    })
  })
})

describe('FixtureLedger transitions and settlement', () => {
  it('settles exactly once: a double settle returns the settled state unchanged', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    await ledger.start(operationId)
    const first = await ledger.settle(operationId, 'charged', 8, { attempt: 1 })
    expect(first).toBe('charged')
    const second = await ledger.settle(operationId, 'refunded', 0, { attempt: 2 })
    expect(second).toBe('charged')
    const op = ledger.getOperation(operationId)!
    expect(op.chargedCredits).toBe(8)
    expect(op.receipt).toEqual({ attempt: 1 })
    // pool reflects the single charge, not the reservation
    expect(ledger.availableCredits()).toBe(92)
  })

  it('start is legal only from reserved (idempotent from provider_started)', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    expect(await ledger.start(operationId)).toBe('provider_started')
    expect(await ledger.start(operationId)).toBe('provider_started')
    await ledger.settle(operationId, 'charged', 5, null)
    await expect(ledger.start(operationId)).rejects.toMatchObject({ code: 'illegal_transition' })
  })

  it('settle from reserved is legal only as a pre-start refund abort', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    await expect(ledger.settle(operationId, 'charged', 5, null)).rejects.toMatchObject({
      code: 'illegal_transition',
    })
    expect(await ledger.settle(operationId, 'refunded', 0, null)).toBe('refunded')
  })

  it('markAmbiguous is legal only from provider_started and parks the reservation', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    await expect(ledger.markAmbiguous(operationId, null)).rejects.toMatchObject({
      code: 'illegal_transition',
    })
    await ledger.start(operationId)
    expect(await ledger.markAmbiguous(operationId, { reason: 'timeout' })).toBe(
      'reconciliation_required',
    )
    // idempotent repeat keeps the parked state
    expect(await ledger.markAmbiguous(operationId, null)).toBe('reconciliation_required')
    // the reservation stays escrowed while parked
    expect(ledger.availableCredits()).toBe(90)
  })

  it('enforces chargedCredits <= reservedCredits and refund = 0', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    await ledger.start(operationId)
    await expect(ledger.settle(operationId, 'charged', 11, null)).rejects.toMatchObject({
      code: 'invalid_settle',
    })
    await expect(ledger.settle(operationId, 'refunded', 3, null)).rejects.toMatchObject({
      code: 'invalid_settle',
    })
  })

  it('release is legal only before provider contact', async () => {
    const ledger = new FixtureLedger({ poolBalance: 100 })
    const { operationId } = await ledger.reserve(reserveInput())
    expect(await ledger.release(operationId)).toBe('released')
    expect(await ledger.release(operationId)).toBe('released')
    const other = await ledger.reserve(reserveInput({ idempotencyKey: 'run-1:fixture-source:2' }))
    await ledger.start(other.operationId)
    await expect(ledger.release(other.operationId)).rejects.toMatchObject({
      code: 'illegal_transition',
    })
  })

  it('throws unknown_operation for unknown ids', async () => {
    const ledger = new FixtureLedger()
    await expect(ledger.start('nope')).rejects.toMatchObject({ code: 'unknown_operation' })
    await expect(ledger.settle('nope', 'charged', 1, null)).rejects.toBeInstanceOf(
      GtmCreditLedgerError,
    )
  })
})
