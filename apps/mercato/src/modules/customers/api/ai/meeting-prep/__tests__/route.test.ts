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
jest.mock('@/modules/customers/lib/commitments', () => ({
  listOpenCommitments: jest.fn(async () => []),
  extractCommitmentsForContact: jest.fn(),
  formatCommitmentsForBrief: jest.fn(() => ''),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { requireProcessAuth } from '@/lib/cron-auth'
import { checkCustomersAiAllowance } from '@/lib/usage/allowance'
import { sendEmailByPurpose } from '@/modules/email/lib/email-router'
import { POST } from '../route'

const ORG_ID = '10000000-0000-4000-8000-000000000001'
const TENANT_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '30000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '40000000-0000-4000-8000-000000000001'

function createKnexFixture() {
  const mutation = jest.fn()
  const knex = (table: string) => {
    const rows = table === 'google_calendar_connections'
      ? [{
          id: CONNECTION_ID,
          user_id: USER_ID,
          organization_id: ORG_ID,
          access_token: 'calendar-token',
          refresh_token: 'refresh-token',
          token_expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          calendar_id: 'primary',
        }]
      : []
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    Object.assign(builder, {
      where: jest.fn(chain),
      select: jest.fn(chain),
      first: jest.fn(async () => table === 'business_profiles'
        ? { tenant_id: TENANT_ID, meeting_prep_enabled: true }
        : null),
      update: jest.fn(async (value: unknown) => {
        mutation(table, 'update', value)
        return 1
      }),
      insert: jest.fn(async (value: unknown) => {
        mutation(table, 'insert', value)
        return 1
      }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
        Promise.resolve(rows).then(resolve, reject)
      ),
    })
    return builder
  }
  return { knex, mutation }
}

describe('POST /api/ai/meeting-prep user-scoped admission', () => {
  const createRequestContainerMock = jest.mocked(createRequestContainer)
  const requireProcessAuthMock = jest.mocked(requireProcessAuth)
  const checkCustomersAiAllowanceMock = jest.mocked(checkCustomersAiAllowance)
  const sendEmailByPurposeMock = jest.mocked(sendEmailByPurpose)

  beforeEach(() => {
    jest.clearAllMocks()
    requireProcessAuthMock.mockReturnValue(null)
    checkCustomersAiAllowanceMock.mockResolvedValue({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })
  })

  it('blocks calendar provider access and cache writes for a fenced calendar owner', async () => {
    const { knex, mutation } = createKnexFixture()
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => knex }),
    } as never)
    const fetchMock = jest.spyOn(global, 'fetch')

    const response = await POST(new Request('http://localhost/api/ai/meeting-prep', { method: 'POST' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({ generated: 0, emailed: 0, skipped: 1, failed: 0 })
    expect(checkCustomersAiAllowanceMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: USER_ID,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendEmailByPurposeMock).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
