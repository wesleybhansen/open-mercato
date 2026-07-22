jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))
jest.mock('@/lib/usage/allowance', () => ({
  withCustomersAiAllowance: jest.fn(),
}))
jest.mock('@/lib/usage/meter', () => ({
  meterCustomersAi: jest.fn(),
}))
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: jest.fn(() => false),
}))
jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: jest.fn(),
}))
jest.mock('@/modules/customers/lib/crm-tool-catalog', () => ({
  CRM_TOOLS: [],
}))

import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { withCustomersAiAllowance } from '@/lib/usage/allowance'
import { meterCustomersAi } from '@/lib/usage/meter'
import { query, queryOne } from '@/lib/db'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { POST } from '../route'

const getAuthFromCookiesMock = jest.mocked(getAuthFromCookies)
const withCustomersAiAllowanceMock = jest.mocked(withCustomersAiAllowance)
const meterCustomersAiMock = jest.mocked(meterCustomersAi)
const queryMock = jest.mocked(query)
const queryOneMock = jest.mocked(queryOne)
const createRequestContainerMock = jest.mocked(createRequestContainer)
const createExternalGrantMock = jest.fn()
const revokeExternalGrantMock = jest.fn()
const externalGrantReceipt = {
  grantId: '71000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000001',
  localUserId: '40000000-0000-4000-8000-000000000001',
  noliOrgId: '20000000-0000-4000-8000-000000000001',
  provider: 'openai',
  purpose: 'realtime-voice',
  expiresAt: '2026-07-22T20:05:00.000Z',
}

describe('POST /api/ai/realtime/session', () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-openai-key'
    getAuthFromCookiesMock.mockResolvedValue({
      sub: '40000000-0000-4000-8000-000000000001',
      tenantId: '30000000-0000-4000-8000-000000000001',
      orgId: '10000000-0000-4000-8000-000000000001',
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: () => ({ getKnex: () => ({}) }),
    } as never)
    queryMock.mockResolvedValue([])
    queryOneMock.mockResolvedValue(null)
    createExternalGrantMock.mockResolvedValue({ ...externalGrantReceipt })
    revokeExternalGrantMock.mockResolvedValue(undefined)
    withCustomersAiAllowanceMock.mockImplementation(async (_em, _auth, _provider, operation) => ({
      executed: true,
      value: await operation(
        { allowed: true },
        {
          createExternalGrant: createExternalGrantMock,
          revokeExternalGrant: revokeExternalGrantMock,
        },
      ),
    }))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: 'ek_ephemeral_secret', expires_at: 1_785_000_000 }),
    } as Response)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiApiKey
  })

  it('records the full browser session grant before asking OpenAI for a short-lived secret', async () => {
    const response = await POST(new Request('http://localhost/api/ai/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: 'coral' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.clientSecret).toBe('ek_ephemeral_secret')
    expect(withCustomersAiAllowanceMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: '10000000-0000-4000-8000-000000000001',
        sub: '40000000-0000-4000-8000-000000000001',
      },
      'openai',
      expect.any(Function),
    )
    expect(createExternalGrantMock).toHaveBeenCalledWith({
      provider: 'openai',
      purpose: 'realtime-voice',
      lifetimeSeconds: 3900,
    })
    expect(createExternalGrantMock.mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(global.fetch).mock.invocationCallOrder[0]!)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/client_secrets',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Client-Request-Id': '71000000-0000-4000-8000-000000000001',
        }),
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 60 },
        }),
      }),
    )
    expect(meterCustomersAiMock).toHaveBeenCalledTimes(1)
    expect(revokeExternalGrantMock).not.toHaveBeenCalled()
  })

  it('revokes the exact grant when OpenAI authoritatively rejects the mint', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid_api_key',
    } as Response)

    const response = await POST(new Request('http://localhost/api/ai/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(response.status).toBe(500)
    expect(revokeExternalGrantMock).toHaveBeenCalledWith(externalGrantReceipt)
    expect(jest.mocked(global.fetch).mock.invocationCallOrder[0])
      .toBeLessThan(revokeExternalGrantMock.mock.invocationCallOrder[0]!)
    expect(meterCustomersAiMock).not.toHaveBeenCalled()
  })

  it('retains the grant when the provider outcome is ambiguous after a network failure', async () => {
    jest.mocked(global.fetch).mockRejectedValueOnce(new TypeError('connection reset'))

    const response = await POST(new Request('http://localhost/api/ai/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(response.status).toBe(500)
    expect(createExternalGrantMock).toHaveBeenCalledTimes(1)
    expect(revokeExternalGrantMock).not.toHaveBeenCalled()
    expect(meterCustomersAiMock).not.toHaveBeenCalled()
  })

  it('retains the grant when a successful response cannot be parsed', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid JSON')
      },
    } as Response)

    const response = await POST(new Request('http://localhost/api/ai/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(response.status).toBe(500)
    expect(createExternalGrantMock).toHaveBeenCalledTimes(1)
    expect(revokeExternalGrantMock).not.toHaveBeenCalled()
    expect(meterCustomersAiMock).not.toHaveBeenCalled()
  })

  it('does not mint a provider credential when deletion fencing rejects admission', async () => {
    withCustomersAiAllowanceMock.mockResolvedValueOnce({ executed: false })

    const response = await POST(new Request('http://localhost/api/ai/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(response.status).toBe(409)
    expect(createExternalGrantMock).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
