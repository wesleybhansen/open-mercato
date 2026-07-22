jest.mock('@open-mercato/shared/lib/noli/core-client', () => ({
  findNoliUserById: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/clerk', () => ({
  resolveClerkUserToAuthContext: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@/lib/usage/allowance', () => ({
  checkCustomersAiAllowance: jest.fn(),
}))
jest.mock('@/lib/usage/meter', () => ({
  meterCustomersAi: jest.fn(),
}))

import { findNoliUserById } from '@open-mercato/shared/lib/noli/core-client'
import { resolveClerkUserToAuthContext } from '@open-mercato/shared/lib/auth/clerk'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkCustomersAiAllowance } from '@/lib/usage/allowance'
import { POST } from '../route'

const ORG_ID = '10000000-0000-4000-8000-000000000001'
const TENANT_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '30000000-0000-4000-8000-000000000001'

function createKnexFixture() {
  const mutation = jest.fn()
  const knex = (table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    Object.assign(builder, {
      where: jest.fn(chain),
      count: jest.fn(chain),
      first: jest.fn(async () => table === 'inbox_proposals' ? { n: 0 } : null),
      insert: jest.fn(async (value: unknown) => {
        mutation(table, 'insert', value)
        return 1
      }),
      update: jest.fn(async (value: unknown) => {
        mutation(table, 'update', value)
        return 1
      }),
    })
    return builder
  }
  return { knex, mutation }
}

describe('POST /api/internal/proactive-followups user-scoped admission', () => {
  const findNoliUserByIdMock = jest.mocked(findNoliUserById)
  const resolveClerkUserToAuthContextMock = jest.mocked(resolveClerkUserToAuthContext)
  const createRequestContainerMock = jest.mocked(createRequestContainer)
  const checkCustomersAiAllowanceMock = jest.mocked(checkCustomersAiAllowance)
  const originalSecret = process.env.NOLI_INTERNAL_SERVICE_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NOLI_INTERNAL_SERVICE_SECRET = 'test-internal-secret'
    findNoliUserByIdMock.mockResolvedValue({ clerk_user_id: 'clerk-user' } as never)
    resolveClerkUserToAuthContextMock.mockResolvedValue({
      userId: USER_ID,
      sub: USER_ID,
      orgId: ORG_ID,
      tenantId: TENANT_ID,
    })
    checkCustomersAiAllowanceMock.mockResolvedValue({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.NOLI_INTERNAL_SERVICE_SECRET
    else process.env.NOLI_INTERNAL_SERVICE_SECRET = originalSecret
  })

  it('does not generate or persist follow-ups when the requesting user is fenced', async () => {
    const { knex, mutation } = createKnexFixture()
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => knex }),
    } as never)
    const fetchMock = jest.spyOn(global, 'fetch')

    const response = await POST(new Request('http://localhost/api/internal/proactive-followups', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-internal-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ noliUserId: 'noli-user' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, drafted: 0, reason: 'allowance' })
    expect(checkCustomersAiAllowanceMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: USER_ID,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
