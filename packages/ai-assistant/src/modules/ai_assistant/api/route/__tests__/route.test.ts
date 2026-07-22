jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))
jest.mock('../../../lib/ai-sdk', () => ({
  createOpenAI: jest.fn(() => jest.fn(() => ({ model: 'openai-model' }))),
  createAnthropic: jest.fn(() => jest.fn(() => ({ model: 'anthropic-model' }))),
  createGoogleGenerativeAI: jest.fn(() => jest.fn(() => ({ model: 'google-model' }))),
  generateObject: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/ai/opencode-provider', () => ({
  resolveFirstConfiguredOpenCodeProvider: jest.fn(() => 'openai'),
  resolveOpenCodeModel: jest.fn(() => ({ modelId: 'gpt-test', modelWithProvider: 'openai/gpt-test' })),
  resolveOpenCodeProviderApiKey: jest.fn(() => 'platform-key'),
}))
jest.mock('../../../lib/chat-config', () => ({
  resolveChatConfig: jest.fn(),
  isProviderConfigured: jest.fn(() => true),
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class Organization {},
}))
jest.mock('@open-mercato/shared/lib/noli/ai-usage', () => ({
  logCrmAiUsage: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/noli/allowance', () => ({
  checkOrgAiAllowance: jest.fn(),
}))
jest.mock('../../../lib/gdpr-processor-lease', () => ({
  AI_ASSISTANT_GDPR_BLOCK_MESSAGE: 'AI operations are unavailable while this account is being deleted.',
  beginAiAssistantProcessorLease: jest.fn(),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { checkOrgAiAllowance } from '@open-mercato/shared/lib/noli/allowance'
import { logCrmAiUsage } from '@open-mercato/shared/lib/noli/ai-usage'
import { generateObject } from '../../../lib/ai-sdk'
import { resolveChatConfig } from '../../../lib/chat-config'
import { beginAiAssistantProcessorLease } from '../../../lib/gdpr-processor-lease'
import { POST } from '../route'

const getAuthFromRequestMock = jest.mocked(getAuthFromRequest)
const createRequestContainerMock = jest.mocked(createRequestContainer)
const checkOrgAiAllowanceMock = jest.mocked(checkOrgAiAllowance)
const logCrmAiUsageMock = jest.mocked(logCrmAiUsage)
const generateObjectMock = jest.mocked(generateObject)
const resolveChatConfigMock = jest.mocked(resolveChatConfig)
const beginProcessorLeaseMock = jest.mocked(beginAiAssistantProcessorLease)
const release = jest.fn()
const findOne = jest.fn()
const em = { getKnex: () => ({}), fork: () => ({ findOne }) }

describe('AI assistant routing endpoint', () => {
  beforeEach(() => {
    release.mockReset().mockResolvedValue(undefined)
    findOne.mockReset().mockResolvedValue({ noliOrgId: 'noli-org-1' })
    getAuthFromRequestMock.mockReset().mockResolvedValue({
      orgId: '20000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-1',
      sub: '10000000-0000-4000-8000-000000000001',
    } as never)
    createRequestContainerMock.mockReset().mockResolvedValue({ resolve: () => em } as never)
    beginProcessorLeaseMock.mockReset().mockResolvedValue({
      organizationId: '20000000-0000-4000-8000-000000000001',
      localUserId: '10000000-0000-4000-8000-000000000001',
      release,
    })
    resolveChatConfigMock.mockReset().mockResolvedValue({
      providerId: 'openai',
      model: 'gpt-test',
      updatedAt: '',
    })
    checkOrgAiAllowanceMock.mockReset().mockResolvedValue({ allowed: true })
    generateObjectMock.mockReset().mockResolvedValue({
      object: { intent: 'general_chat', confidence: 1, reasoning: 'test' },
      usage: { inputTokens: 3, outputTokens: 4 },
    } as never)
    logCrmAiUsageMock.mockReset().mockResolvedValue(undefined)
  })

  const request = () => new Request('http://localhost/api/ai_assistant/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'hello', availableTools: [] }),
  })

  it('fails closed before provider routing when the deletion fence rejects admission', async () => {
    beginProcessorLeaseMock.mockResolvedValueOnce(null)

    const response = await POST(request() as never)

    expect(response.status).toBe(503)
    expect(resolveChatConfigMock).not.toHaveBeenCalled()
    expect(checkOrgAiAllowanceMock).not.toHaveBeenCalled()
    expect(generateObjectMock).not.toHaveBeenCalled()
    expect(logCrmAiUsageMock).not.toHaveBeenCalled()
  })

  it('holds the lease through provider routing and awaited metering', async () => {
    logCrmAiUsageMock.mockImplementationOnce(async () => {
      expect(release).not.toHaveBeenCalled()
    })

    const response = await POST(request() as never)

    expect(response.status).toBe(200)
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    expect(logCrmAiUsageMock).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
