jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@/lib/cron-auth', () => ({
  requireProcessAuth: jest.fn(),
}))
jest.mock('@/lib/usage/allowance', () => ({
  checkCustomersAiAllowance: jest.fn(),
}))
jest.mock('@/lib/usage/meter', () => ({
  meterCustomersAi: jest.fn(),
}))
jest.mock('@/modules/customers/api/ai/persona', () => ({
  buildPersonaPrompt: jest.fn(),
  getPersonaForOrg: jest.fn(),
}))
jest.mock('@/modules/email/lib/email-router', () => ({
  sendEmailByPurpose: jest.fn(),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { requireProcessAuth } from '@/lib/cron-auth'
import { checkCustomersAiAllowance } from '@/lib/usage/allowance'
import { sendEmailByPurpose } from '@/modules/email/lib/email-router'
import { POST } from '../route'

const ORG_ID = '10000000-0000-4000-8000-000000000001'
const TENANT_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '30000000-0000-4000-8000-000000000001'

function createKnexFixture() {
  const knex = (table: string) => {
    const rows = table === 'business_profiles'
      ? [{
          organization_id: ORG_ID,
          tenant_id: TENANT_ID,
          business_name: 'Noli Test',
          digest_frequency: 'daily',
          digest_day: 1,
        }]
      : []
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    Object.assign(builder, {
      where: jest.fn(chain),
      orderBy: jest.fn(chain),
      select: jest.fn(chain),
      first: jest.fn(async () => table === 'email_connections'
        ? { email_address: 'owner@example.test', user_id: USER_ID }
        : null),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
        Promise.resolve(rows).then(resolve, reject)
      ),
    })
    return builder
  }
  return knex
}

describe('POST /api/ai/digest user-scoped admission', () => {
  const createRequestContainerMock = jest.mocked(createRequestContainer)
  const requireProcessAuthMock = jest.mocked(requireProcessAuth)
  const checkCustomersAiAllowanceMock = jest.mocked(checkCustomersAiAllowance)
  const sendEmailByPurposeMock = jest.mocked(sendEmailByPurpose)

  beforeEach(() => {
    jest.clearAllMocks()
    requireProcessAuthMock.mockReturnValue(null)
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => createKnexFixture() }),
    } as never)
    checkCustomersAiAllowanceMock.mockResolvedValue({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })
  })

  it('does not generate or send a digest when its mailbox owner is fenced', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const response = await POST(new Request('http://localhost/api/ai/digest', { method: 'POST' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({ sent: 0, skipped: 1, failed: 0 })
    expect(checkCustomersAiAllowanceMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: USER_ID,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendEmailByPurposeMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
