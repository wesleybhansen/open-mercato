/** @jest-environment node */

const mockFindNoliUserById = jest.fn()
const mockIsEntitled = jest.fn()
const mockResolveClerkUserToAuthContext = jest.fn()
const mockCreateRequestContainer = jest.fn()

type CountValue = string | number | Error | undefined

const countValues = new Map<string, CountValue>()
const queryScopes: Array<{ table: string; filters: Array<[string, unknown]>; nulls: string[] }> = []

function createKnex() {
  return (table: string) => {
    const scope = { table, filters: [] as Array<[string, unknown]>, nulls: [] as string[] }
    queryScopes.push(scope)
    const query = {
      where: jest.fn((field: string, value: unknown) => {
        scope.filters.push([field, value])
        return query
      }),
      whereNull: jest.fn((field: string) => {
        scope.nulls.push(field)
        return query
      }),
      count: jest.fn(() => query),
      first: jest.fn(async () => {
        const value = countValues.get(table)
        if (value instanceof Error) throw value
        return value === undefined ? undefined : { n: value }
      }),
    }
    return query
  }
}

jest.mock('@open-mercato/shared/lib/noli/core-client', () => ({
  findNoliUserById: (...args: unknown[]) => mockFindNoliUserById(...args),
  isEntitled: (...args: unknown[]) => mockIsEntitled(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/clerk', () => ({
  resolveClerkUserToAuthContext: (...args: unknown[]) =>
    mockResolveClerkUserToAuthContext(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

import { POST } from '../route'

const serviceSecret = 'test-internal-service-secret'
const noliUserId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const tenantId = '33333333-3333-4333-8333-333333333333'

function request(authorization = `Bearer ${serviceSecret}`): Request {
  return new Request('http://localhost/api/internal/setup-status', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ noliUserId }),
  })
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: 'Setup status unavailable',
    code: 'setup_status_unavailable',
  })
}

describe('CRM internal setup-status dependency honesty', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    countValues.clear()
    queryScopes.length = 0
    process.env.NOLI_INTERNAL_SERVICE_SECRET = serviceSecret
    mockFindNoliUserById.mockResolvedValue({
      id: noliUserId,
      clerk_user_id: 'clerk-user-1',
    })
    mockIsEntitled.mockResolvedValue(true)
    mockResolveClerkUserToAuthContext.mockResolvedValue({ orgId, tenantId })
    for (const table of ['customer_entities', 'landing_pages', 'booking_pages', 'email_accounts']) {
      countValues.set(table, '0')
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ getKnex: () => createKnex() }),
    })
  })

  afterAll(() => {
    delete process.env.NOLI_INTERNAL_SERVICE_SECRET
  })

  it('rejects an invalid service credential before any dependency access', async () => {
    const response = await POST(request('Bearer wrong'))

    expect(response.status).toBe(401)
    expect(mockFindNoliUserById).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('preserves a genuine missing Noli identity as an absent CRM account', async () => {
    mockFindNoliUserById.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ exists: false })
    expect(mockIsEntitled).not.toHaveBeenCalled()
    expect(mockResolveClerkUserToAuthContext).not.toHaveBeenCalled()
  })

  it('preserves an inactive CRM entitlement as an absent CRM account', async () => {
    mockIsEntitled.mockResolvedValue(false)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ exists: false })
    expect(mockResolveClerkUserToAuthContext).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it.each([
    ['missing Clerk linkage', () => mockFindNoliUserById.mockResolvedValue({ id: noliUserId })],
    ['null CRM resolver', () => mockResolveClerkUserToAuthContext.mockResolvedValue(null)],
    ['missing organization', () => mockResolveClerkUserToAuthContext.mockResolvedValue({ tenantId })],
    ['missing tenant', () => mockResolveClerkUserToAuthContext.mockResolvedValue({ orgId })],
  ])('fails closed for %s after positive Core authority', async (_condition, arrange) => {
    arrange()
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expectUnavailable(await POST(request()))

    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('returns the exact empty setup projection after four successful zero counts', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      exists: true,
      hasContacts: false,
      hasCapturePage: false,
      emailConnected: false,
    })
    expect(queryScopes).toHaveLength(4)
    expect(queryScopes.every((scope) =>
      scope.filters.some(([field, value]) => field === 'organization_id' && value === orgId)
      && scope.filters.some(([field, value]) => field === 'tenant_id' && value === tenantId),
    )).toBe(true)
    expect(queryScopes.find((scope) => scope.table === 'customer_entities')?.nulls).toEqual([
      'deleted_at',
    ])
  })

  it('returns the exact populated setup projection after successful positive counts', async () => {
    countValues.set('customer_entities', 2)
    countValues.set('booking_pages', '1')
    countValues.set('email_accounts', 1)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      exists: true,
      hasContacts: true,
      hasCapturePage: true,
      emailConnected: true,
    })
  })

  it.each([
    'customer_entities',
    'landing_pages',
    'booking_pages',
    'email_accounts',
  ])('fails closed when the %s count query rejects', async (table) => {
    const rawFailure = new Error(`private ${table} failure detail`)
    countValues.set(table, rawFailure)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expectUnavailable(await POST(request()))

    expect(consoleSpy).toHaveBeenCalledWith(
      '[internal.setup-status] setup_status_unavailable',
    )
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining(rawFailure.message))
    consoleSpy.mockRestore()
  })

  it.each([undefined, '', '01', 'not-a-count', -1, 1.5, Number.POSITIVE_INFINITY])(
    'fails closed for malformed count value %p',
    async (value) => {
      countValues.set('customer_entities', value)
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

      await expectUnavailable(await POST(request()))

      consoleSpy.mockRestore()
    },
  )

  it.each<[string, () => void]>([
    ['Noli Core', () => mockFindNoliUserById.mockRejectedValue(new Error('private core detail'))],
    ['entitlement authority', () => mockIsEntitled.mockRejectedValue(new Error('private entitlement detail'))],
    ['Clerk resolver', () => mockResolveClerkUserToAuthContext.mockRejectedValue(new Error('private auth detail'))],
    ['request container', () => mockCreateRequestContainer.mockRejectedValue(new Error('private database detail'))],
  ])('fails closed when the %s dependency rejects', async (_dependency, arrange) => {
    arrange()
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expectUnavailable(await POST(request()))

    expect(consoleSpy).toHaveBeenCalledWith(
      '[internal.setup-status] setup_status_unavailable',
    )
    consoleSpy.mockRestore()
  })
})
