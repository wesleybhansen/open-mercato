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
jest.mock('@/modules/customers/lib/draft-reply', () => ({
  generateReplyDraft: jest.fn(),
}))
jest.mock('@/modules/customers/lib/audiences', () => ({
  loadAudiences: jest.fn(async () => []),
  resolveSenderAudiences: jest.fn(),
  scenarioAudienceMatches: jest.fn(),
}))
jest.mock('@/modules/customers/lib/send-reply', () => ({
  sendReply: jest.fn(),
}))
jest.mock('@/modules/customers/lib/send-sms-reply', () => ({
  sendSmsReply: jest.fn(),
}))
jest.mock('@/modules/email/lib/email-router', () => ({
  sendEmailByPurpose: jest.fn(),
}))
jest.mock('@/lib/automated-mail', () => ({
  isAutomatedMail: jest.fn(),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { requireProcessAuth } from '@/lib/cron-auth'
import { checkCustomersAiAllowance } from '@/lib/usage/allowance'
import { generateReplyDraft } from '@/modules/customers/lib/draft-reply'
import { POST } from '../route'

const ORG_ID = '10000000-0000-4000-8000-000000000001'
const TENANT_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '30000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '40000000-0000-4000-8000-000000000001'
const CONVERSATION_ID = '50000000-0000-4000-8000-000000000001'
const CONTACT_ID = '60000000-0000-4000-8000-000000000001'

type QueryFixture = {
  personalConnections: Array<Record<string, unknown>>
  conversations: Array<Record<string, unknown>>
  ownerMessage: Record<string, unknown> | null
}

function createKnexFixture(fixture: QueryFixture) {
  const mutation = jest.fn()
  const knex = (table: string) => {
    const rows = table === 'inbox_ai_settings'
      ? [{
          organization_id: ORG_ID,
          tenant_id: TENANT_ID,
          enabled: true,
          reply_mode: 'draft',
          signature: null,
          flag_scenarios: [],
        }]
      : table === 'email_connections'
        ? fixture.personalConnections
        : table === 'inbox_conversations'
          ? fixture.conversations
          : []

    const builder: Record<string, unknown> = {}
    const chain = () => builder
    Object.assign(builder, {
      where: jest.fn(chain),
      whereNull: jest.fn(chain),
      whereRaw: jest.fn(chain),
      orderBy: jest.fn(chain),
      limit: jest.fn(chain),
      select: jest.fn(chain),
      first: jest.fn(async () => table === 'email_messages' ? fixture.ownerMessage : null),
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

describe('POST /api/inbox/process user-scoped admission', () => {
  const createRequestContainerMock = jest.mocked(createRequestContainer)
  const requireProcessAuthMock = jest.mocked(requireProcessAuth)
  const checkCustomersAiAllowanceMock = jest.mocked(checkCustomersAiAllowance)
  const generateReplyDraftMock = jest.mocked(generateReplyDraft)
  const originalGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    requireProcessAuthMock.mockReturnValue(null)
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key'
  })

  afterEach(() => {
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleKey
  })

  it('does not claim, generate, or persist when the mailbox owner is fenced', async () => {
    const { knex, mutation } = createKnexFixture({
      personalConnections: [{
        id: CONNECTION_ID,
        email_address: 'owner@example.test',
        user_id: USER_ID,
      }],
      conversations: [{
        id: CONVERSATION_ID,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        last_message_channel: 'email',
        avatar_email: 'customer@example.test',
      }],
      ownerMessage: {
        account_id: CONNECTION_ID,
        to_address: 'owner@example.test',
      },
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => knex }),
    } as never)
    checkCustomersAiAllowanceMock.mockResolvedValue({
      allowed: false,
      message: 'AI operations are unavailable while this account is being deleted.',
    })

    const response = await POST(new Request('http://localhost/api/inbox/process', { method: 'POST' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.skipped).toBe(1)
    expect(checkCustomersAiAllowanceMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: USER_ID,
    })
    expect(generateReplyDraftMock).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })

  it('skips closed without admission or writes when no personal owner resolves', async () => {
    const { knex, mutation } = createKnexFixture({
      personalConnections: [],
      conversations: [{
        id: CONVERSATION_ID,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        last_message_channel: 'email',
        avatar_email: 'customer@example.test',
      }],
      ownerMessage: {
        account_id: CONNECTION_ID,
        to_address: 'missing@example.test',
      },
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => knex }),
    } as never)

    const response = await POST(new Request('http://localhost/api/inbox/process', { method: 'POST' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.skipped).toBe(1)
    expect(checkCustomersAiAllowanceMock).not.toHaveBeenCalled()
    expect(generateReplyDraftMock).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })
})
