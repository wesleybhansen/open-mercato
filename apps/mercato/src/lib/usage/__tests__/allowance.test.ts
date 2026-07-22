jest.mock('server-only', () => ({}))
const afterTasks: Array<() => unknown | Promise<unknown>> = []
jest.mock('next/server', () => ({
  after: jest.fn((task: () => unknown | Promise<unknown>) => afterTasks.push(task)),
}))
jest.mock('@open-mercato/core/modules/auth/lib/gdprLocalWriteLease', () => ({
  beginGdprLocalWriteLease: jest.fn(),
  beginGdprUserWriteLease: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class Organization {},
}))
jest.mock('@open-mercato/shared/lib/noli/core-client', () => ({
  getNoliCoreClient: jest.fn(),
  resolveOrgByoKeys: jest.fn(),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getNoliCoreClient, resolveOrgByoKeys } from '@open-mercato/shared/lib/noli/core-client'
import {
  beginGdprLocalWriteLease,
  beginGdprUserWriteLease,
} from '@open-mercato/core/modules/auth/lib/gdprLocalWriteLease'
import {
  createAllowanceTestClient,
  successfulAllowanceQuery,
  type AllowanceQueryName,
} from '@open-mercato/shared/lib/noli/__tests__/allowance-test-client'
import {
  beginCustomersAiAllowance,
  checkCustomersAiAllowance,
  withCustomersAiAllowance,
} from '../allowance'

const createRequestContainerMock = jest.mocked(createRequestContainer)
const getNoliCoreClientMock = jest.mocked(getNoliCoreClient)
const resolveOrgByoKeysMock = jest.mocked(resolveOrgByoKeys)
const beginGdprLocalWriteLeaseMock = jest.mocked(beginGdprLocalWriteLease)
const beginGdprUserWriteLeaseMock = jest.mocked(beginGdprUserWriteLease)
const findOneMock = jest.fn()
const organizationReleaseMock = jest.fn()
const userReleaseMock = jest.fn()

describe('checkCustomersAiAllowance', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-21T18:00:00.000Z'))
    findOneMock.mockReset().mockResolvedValue({ noliOrgId: 'noli-org-1' })
    afterTasks.length = 0
    organizationReleaseMock.mockReset().mockResolvedValue(undefined)
    userReleaseMock.mockReset().mockResolvedValue(undefined)
    beginGdprLocalWriteLeaseMock.mockReset().mockResolvedValue({
      leaseId: '70000000-0000-4000-8000-000000000001',
      release: organizationReleaseMock,
    })
    beginGdprUserWriteLeaseMock.mockReset().mockResolvedValue({
      leaseId: '70000000-0000-4000-8000-000000000002',
      release: userReleaseMock,
    })
    createRequestContainerMock.mockReset().mockResolvedValue({
      resolve: () => ({ findOne: findOneMock, getKnex: () => ({}) }),
    } as never)
    getNoliCoreClientMock.mockReset()
    resolveOrgByoKeysMock.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('holds organization and user processor leases through request completion', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)

    await expect(
      checkCustomersAiAllowance({
        orgId: 'crm-org-1',
        sub: '10000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual({ allowed: true })

    expect(beginGdprLocalWriteLeaseMock).toHaveBeenCalledWith({}, 'crm-org-1', 'processor')
    expect(beginGdprUserWriteLeaseMock).toHaveBeenCalledWith(
      {},
      '10000000-0000-4000-8000-000000000001',
      'processor',
    )
    expect(afterTasks).toHaveLength(1)
    expect(organizationReleaseMock).not.toHaveBeenCalled()
    expect(userReleaseMock).not.toHaveBeenCalled()

    await afterTasks[0]()
    expect(userReleaseMock).toHaveBeenCalledTimes(1)
    expect(organizationReleaseMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed before provider admission when the organization is fenced', async () => {
    beginGdprLocalWriteLeaseMock.mockResolvedValueOnce(null)

    await expect(checkCustomersAiAllowance({ orgId: 'crm-org-1' })).resolves.toEqual({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })
    expect(getNoliCoreClientMock).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
  })

  it('releases the organization lease when the user fence rejects admission', async () => {
    beginGdprUserWriteLeaseMock.mockResolvedValueOnce(null)

    await expect(
      checkCustomersAiAllowance({
        orgId: 'crm-org-1',
        sub: '10000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })

    expect(organizationReleaseMock).toHaveBeenCalledTimes(1)
    expect(getNoliCoreClientMock).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
  })

  it('uses the resolved local actor instead of the synthetic API-key subject', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)

    await expect(checkCustomersAiAllowance({
      orgId: 'crm-org-1',
      sub: 'api_key:90000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({ allowed: true })

    expect(beginGdprUserWriteLeaseMock).toHaveBeenCalledWith(
      {},
      '10000000-0000-4000-8000-000000000001',
      'processor',
    )
    expect(beginGdprUserWriteLeaseMock).not.toHaveBeenCalledWith(
      {},
      'api_key:90000000-0000-4000-8000-000000000001',
      'processor',
    )
  })

  it('keeps an unowned API key organization-fenced without casting its synthetic subject', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)

    await expect(checkCustomersAiAllowance({
      orgId: 'crm-org-1',
      sub: 'api_key:90000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({ allowed: true })

    expect(beginGdprLocalWriteLeaseMock).toHaveBeenCalledTimes(1)
    expect(beginGdprUserWriteLeaseMock).not.toHaveBeenCalled()
  })

  it('fails closed when the request-scoped database is unavailable', async () => {
    createRequestContainerMock.mockResolvedValueOnce({
      resolve: () => {
        throw new Error('database unavailable')
      },
    } as never)

    await expect(checkCustomersAiAllowance({ orgId: 'crm-org-1' })).resolves.toEqual({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })

    expect(beginGdprLocalWriteLeaseMock).not.toHaveBeenCalled()
    expect(getNoliCoreClientMock).not.toHaveBeenCalled()
  })

  it('holds background processor leases until the operation settles without scheduling request cleanup', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)
    const operation = jest.fn(async (gate) => {
      expect(gate).toEqual({ allowed: true })
      expect(organizationReleaseMock).not.toHaveBeenCalled()
      expect(userReleaseMock).not.toHaveBeenCalled()
      return 'complete'
    })
    const em = { findOne: findOneMock, getKnex: () => ({}) }

    await expect(withCustomersAiAllowance(
      em as never,
      { orgId: 'crm-org-1', userId: '10000000-0000-4000-8000-000000000001' },
      'google',
      operation,
    )).resolves.toEqual({ executed: true, value: 'complete' })

    expect(operation).toHaveBeenCalledTimes(1)
    expect(afterTasks).toHaveLength(0)
    expect(userReleaseMock).toHaveBeenCalledTimes(1)
    expect(organizationReleaseMock).toHaveBeenCalledTimes(1)
  })

  it('holds an explicit processor lease until its idempotent release', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)
    const em = { findOne: findOneMock, getKnex: () => ({}) }

    const lease = await beginCustomersAiAllowance(
      em as never,
      { orgId: 'crm-org-1', userId: '10000000-0000-4000-8000-000000000001' },
      'google',
    )

    expect(lease?.gate).toEqual({ allowed: true })
    expect(afterTasks).toHaveLength(0)
    expect(userReleaseMock).not.toHaveBeenCalled()
    expect(organizationReleaseMock).not.toHaveBeenCalled()

    await Promise.all([lease?.release(), lease?.release()])
    expect(userReleaseMock).toHaveBeenCalledTimes(1)
    expect(organizationReleaseMock).toHaveBeenCalledTimes(1)
  })

  it('does not create an explicit lease when a deletion fence rejects admission', async () => {
    beginGdprLocalWriteLeaseMock.mockResolvedValueOnce(null)
    const em = { findOne: findOneMock, getKnex: () => ({}) }

    await expect(beginCustomersAiAllowance(
      em as never,
      { orgId: 'crm-org-1', userId: '10000000-0000-4000-8000-000000000001' },
      'google',
    )).resolves.toBeNull()

    expect(beginGdprUserWriteLeaseMock).not.toHaveBeenCalled()
    expect(getNoliCoreClientMock).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
  })

  it('does not start background work after an organization fence rejects admission', async () => {
    beginGdprLocalWriteLeaseMock.mockResolvedValueOnce(null)
    const operation = jest.fn()
    const em = { findOne: findOneMock, getKnex: () => ({}) }

    await expect(withCustomersAiAllowance(
      em as never,
      { orgId: 'crm-org-1' },
      'google',
      operation,
    )).resolves.toEqual({ executed: false })

    expect(operation).not.toHaveBeenCalled()
    expect(getNoliCoreClientMock).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
  })

  it('registers and exactly revokes a database-timed external grant inside its leases', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)
    const raw = jest.fn(async (sql: string, bindings: readonly unknown[]) => {
      if (sql.includes('crm_gdpr_create_external_processor_grant')) {
        return {
          rows: [{
            receipt: {
              grantId: bindings[4],
              organizationId: 'crm-org-1',
              localUserId: '10000000-0000-4000-8000-000000000001',
              noliOrgId: 'noli-org-1',
              provider: 'openai',
              purpose: 'realtime-voice',
              expiresAt: '2026-07-21T19:05:00.000Z',
            },
          }],
        }
      }
      return { rows: [{ grantId: bindings[0] }] }
    })
    const em = { findOne: findOneMock, getKnex: () => ({ raw }) }
    const operation = jest.fn(async (gate, scope) => {
      expect(gate).toEqual({ allowed: true })
      const grant = await scope.createExternalGrant({
        provider: 'openai',
        purpose: 'realtime-voice',
        lifetimeSeconds: 3900,
      })
      expect(grant.noliOrgId).toBe('noli-org-1')
      expect(raw).toHaveBeenCalledTimes(1)
      expect(organizationReleaseMock).not.toHaveBeenCalled()
      expect(userReleaseMock).not.toHaveBeenCalled()
      await scope.revokeExternalGrant(grant)
      expect(raw).toHaveBeenCalledTimes(2)
      expect(organizationReleaseMock).not.toHaveBeenCalled()
      expect(userReleaseMock).not.toHaveBeenCalled()
      return grant.grantId
    })

    const result = await withCustomersAiAllowance(
      em as never,
      { orgId: 'crm-org-1', sub: '10000000-0000-4000-8000-000000000001' },
      'openai',
      operation,
    )

    expect(result.executed).toBe(true)
    expect(raw.mock.calls[0]?.[1]).toEqual([
      'crm-org-1',
      '10000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002',
      expect.any(String),
      'openai',
      'realtime-voice',
      expect.any(String),
      3900,
    ])
    expect(raw.mock.calls[0]?.[1][4]).toBe(raw.mock.calls[0]?.[1][7])
    expect(raw.mock.calls[1]?.[0]).toContain('delete from public.gdpr_external_processor_grants')
    expect(raw.mock.calls[1]?.[1]).toEqual([
      raw.mock.calls[0]?.[1][4],
      'crm-org-1',
      '10000000-0000-4000-8000-000000000001',
      'noli-org-1',
      'openai',
      'realtime-voice',
      raw.mock.calls[0]?.[1][4],
      '2026-07-21T19:05:00.000Z',
    ])
    expect(raw.mock.invocationCallOrder[1])
      .toBeLessThan(userReleaseMock.mock.invocationCallOrder[0]!)
    expect(userReleaseMock).toHaveBeenCalledTimes(1)
    expect(organizationReleaseMock).toHaveBeenCalledTimes(1)
  })

  it('queries annual-plan usage from the latest monthly UTC anniversary', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.subscriptions = successfulAllowanceQuery([{
      id: 'annual-subscription',
      seats: 1,
      token_boosts: 0,
      status: 'active',
      billing_interval: 'year',
      current_period_start: '2026-01-31T10:00:00.000Z',
      updated_at: '2026-01-31T10:00:00.000Z',
    }])
    fixture.results.usage = successfulAllowanceQuery([])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)

    await expect(checkCustomersAiAllowance({ orgId: 'crm-org-1' })).resolves.toEqual({ allowed: true })

    expect(fixture.mocks.usageGte).toHaveBeenCalledWith('ts', '2026-06-30T10:00:00.000Z')
  })

  it('rejects a future period while retaining the paid seat count', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.subscriptions = successfulAllowanceQuery([{
      id: 'future-subscription',
      seats: 2,
      token_boosts: 0,
      status: 'active',
      billing_interval: 'month',
      current_period_start: '2026-07-22T10:00:00.000Z',
      updated_at: '2026-07-21T10:00:00.000Z',
    }])
    fixture.results.usage = successfulAllowanceQuery([{ credits_consumed: 15_000_000 }])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)

    await expect(checkCustomersAiAllowance({ orgId: 'crm-org-1' })).resolves.toEqual({ allowed: true })

    expect(fixture.mocks.usageGte).toHaveBeenCalledWith('ts', '2026-07-01T00:00:00.000Z')
    expect(resolveOrgByoKeysMock).not.toHaveBeenCalled()
  })

  it('uses paid seats and boosts with the UTC-month fallback for an invalid period', async () => {
    const fixture = createAllowanceTestClient()
    fixture.results.subscriptions = successfulAllowanceQuery([{
      id: 'invalid-period-subscription',
      seats: 2,
      token_boosts: 1,
      status: 'past_due',
      billing_interval: 'month',
      current_period_start: '2026-07-15T12:00:00.000',
      updated_at: '2026-07-20T12:00:00.000Z',
    }])
    fixture.results.usage = successfulAllowanceQuery([{ credits_consumed: 25_000_000 }])
    getNoliCoreClientMock.mockReturnValue(fixture.client as never)

    await expect(checkCustomersAiAllowance({ orgId: 'crm-org-1' })).resolves.toEqual({ allowed: true })

    expect(fixture.mocks.usageGte).toHaveBeenCalledWith('ts', '2026-07-01T00:00:00.000Z')
    expect(resolveOrgByoKeysMock).not.toHaveBeenCalled()
  })

  it.each<AllowanceQueryName>(['members', 'subscriptions', 'usage', 'overrides'])(
    'fails open immediately when the %s read resolves with an error',
    async (queryName) => {
      const fixture = createAllowanceTestClient()
      fixture.results[queryName] = { data: null, error: { message: `${queryName} unavailable` } }
      getNoliCoreClientMock.mockReturnValue(fixture.client as never)

      await expect(checkCustomersAiAllowance({ orgId: 'crm-org-1' })).resolves.toEqual({ allowed: true })

      expect(resolveOrgByoKeysMock).not.toHaveBeenCalled()
      if (queryName === 'members' || queryName === 'subscriptions') {
        expect(fixture.mocks.usageGte).not.toHaveBeenCalled()
        expect(fixture.mocks.overridesIn).not.toHaveBeenCalled()
      } else if (queryName === 'usage') {
        expect(fixture.mocks.overridesIn).not.toHaveBeenCalled()
      }
    },
  )
})
