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

describe('POST /api/internal/learn-voice user-scoped admission', () => {
  const findNoliUserByIdMock = jest.mocked(findNoliUserById)
  const resolveClerkUserToAuthContextMock = jest.mocked(resolveClerkUserToAuthContext)
  const createRequestContainerMock = jest.mocked(createRequestContainer)
  const checkCustomersAiAllowanceMock = jest.mocked(checkCustomersAiAllowance)
  const databaseCall = jest.fn()
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
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => databaseCall }),
    } as never)
    checkCustomersAiAllowanceMock.mockResolvedValue({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.NOLI_INTERNAL_SERVICE_SECRET
    else process.env.NOLI_INTERNAL_SERVICE_SECRET = originalSecret
  })

  it('does not call the provider or persist a profile when the resolved user is fenced', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const response = await POST(new Request('http://localhost/api/internal/learn-voice', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-internal-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        op: 'learn',
        noliUserId: 'noli-user',
        documentContent: 'A sufficiently long writing sample. '.repeat(20),
      }),
    }))

    expect(response.status).toBe(402)
    expect(checkCustomersAiAllowanceMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: USER_ID,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(databaseCall).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
