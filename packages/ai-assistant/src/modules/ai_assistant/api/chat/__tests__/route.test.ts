jest.mock('server-only', () => ({}))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))
jest.mock('../../../lib/opencode-handlers', () => ({
  handleOpenCodeAnswer: jest.fn(),
  handleOpenCodeMessageStreaming: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  generateSessionToken: jest.fn(() => 'session-token'),
  createSessionApiKey: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/api_keys/services/openCodeSessionBinding', () => ({
  bindOpenCodeSession: jest.fn(),
  findOwnedOpenCodeSession: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class Organization {},
}))
jest.mock('@open-mercato/shared/lib/ai/opencode-provider', () => ({
  resolveFirstConfiguredOpenCodeProvider: jest.fn(() => 'openai'),
  resolveOpenCodeModel: jest.fn(() => ({ modelId: 'gpt-test' })),
}))
jest.mock('@open-mercato/shared/lib/noli/allowance', () => ({
  checkOrgAiAllowance: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/noli/ai-usage', () => ({
  logCrmAiUsage: jest.fn(),
}))
jest.mock('../../../lib/chat-config', () => ({
  isProviderConfigured: jest.fn(() => true),
  resolveChatConfig: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  UserRole: class UserRole {},
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(() => []),
}))
jest.mock('../../../lib/gdpr-processor-lease', () => ({
  AI_ASSISTANT_GDPR_BLOCK_MESSAGE: 'AI operations are unavailable while this account is being deleted.',
  beginAiAssistantProcessorLease: jest.fn(),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createSessionApiKey } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import {
  bindOpenCodeSession,
  findOwnedOpenCodeSession,
} from '@open-mercato/core/modules/api_keys/services/openCodeSessionBinding'
import { checkOrgAiAllowance } from '@open-mercato/shared/lib/noli/allowance'
import { resolveChatConfig } from '../../../lib/chat-config'
import {
  handleOpenCodeAnswer,
  handleOpenCodeMessageStreaming,
} from '../../../lib/opencode-handlers'
import { beginAiAssistantProcessorLease } from '../../../lib/gdpr-processor-lease'
import { POST } from '../route'

const getAuthFromRequestMock = jest.mocked(getAuthFromRequest)
const createRequestContainerMock = jest.mocked(createRequestContainer)
const createSessionApiKeyMock = jest.mocked(createSessionApiKey)
const bindSessionMock = jest.mocked(bindOpenCodeSession)
const findOwnedSessionMock = jest.mocked(findOwnedOpenCodeSession)
const checkOrgAiAllowanceMock = jest.mocked(checkOrgAiAllowance)
const resolveChatConfigMock = jest.mocked(resolveChatConfig)
const handleAnswerMock = jest.mocked(handleOpenCodeAnswer)
const handleStreamingMock = jest.mocked(handleOpenCodeMessageStreaming)
const beginProcessorLeaseMock = jest.mocked(beginAiAssistantProcessorLease)
const release = jest.fn()
const findOne = jest.fn()
const em = { getKnex: () => ({}), fork: () => ({ findOne }) }

describe('AI assistant streaming endpoint', () => {
  beforeEach(() => {
    release.mockReset().mockResolvedValue(undefined)
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
    createSessionApiKeyMock.mockReset().mockResolvedValue({
      keyId: '40000000-0000-4000-8000-000000000001',
    } as never)
    bindSessionMock.mockReset().mockResolvedValue({} as never)
    findOwnedSessionMock.mockReset().mockResolvedValue({
      keyId: '40000000-0000-4000-8000-000000000001',
      sessionId: 'session-1',
      localUserId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-1',
      expiresAt: new Date(Date.now() + 60_000),
    })
    resolveChatConfigMock.mockReset().mockResolvedValue({
      providerId: 'openai',
      model: 'gpt-test',
      updatedAt: '',
    })
    findOne.mockReset().mockResolvedValue({ noliOrgId: 'noli-org-1' })
    checkOrgAiAllowanceMock.mockReset().mockResolvedValue({ allowed: true })
    handleAnswerMock.mockReset().mockResolvedValue({
      sessionId: 'session-1',
      terminalConfirmed: true,
    })
    handleStreamingMock.mockReset().mockImplementation(async (_request, onEvent) => {
      expect(release).not.toHaveBeenCalled()
      await onEvent({ type: 'done', sessionId: 'session-1' } as never)
      return { sessionId: 'session-1', terminalConfirmed: true }
    })
  })

  const request = (body: Record<string, unknown> = {
    sessionId: 'session-1',
    messages: [{ role: 'user', content: 'hello' }],
  }) => new Request('http://localhost/api/ai_assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('fails closed before session or provider work when the deletion fence rejects admission', async () => {
    beginProcessorLeaseMock.mockResolvedValueOnce(null)

    const response = await POST(request() as never)

    expect(response.status).toBe(503)
    expect(createSessionApiKeyMock).not.toHaveBeenCalled()
    expect(handleStreamingMock).not.toHaveBeenCalled()
  })

  it('holds the lease until the streamed OpenCode operation closes', async () => {
    const response = await POST(request() as never)

    expect(response.status).toBe(200)
    expect(release).not.toHaveBeenCalled()
    const body = await response.text()

    expect(body).toContain('"type":"done"')
    expect(handleStreamingMock).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('rejects a foreign session before provider work', async () => {
    findOwnedSessionMock.mockResolvedValueOnce(null)

    const response = await POST(request() as never)

    expect(response.status).toBe(404)
    expect(handleStreamingMock).not.toHaveBeenCalled()
    expect(checkOrgAiAllowanceMock).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not spend through OpenCode when the organization has no pooled allowance', async () => {
    checkOrgAiAllowanceMock.mockResolvedValueOnce({ allowed: true, byoApiKey: true } as never)

    const response = await POST(request() as never)

    expect(response.status).toBe(402)
    expect(handleStreamingMock).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('retains the deletion-blocking lease when external terminal state is ambiguous', async () => {
    handleStreamingMock.mockResolvedValueOnce({
      sessionId: 'session-1',
      terminalConfirmed: false,
    })

    const response = await POST(request() as never)
    const body = await response.text()

    expect(body).toContain('AI session state is ambiguous')
    expect(release).not.toHaveBeenCalled()
  })

  it('durably binds a new OpenCode session before the provider message proceeds', async () => {
    handleStreamingMock.mockImplementationOnce(async (input, onEvent) => {
      expect(input.onSessionReady).toBeDefined()
      await input.onSessionReady?.('new-session')
      expect(bindSessionMock).toHaveBeenCalledWith(em, expect.objectContaining({
        keyId: '40000000-0000-4000-8000-000000000001',
        sessionToken: 'session-token',
        sessionId: 'new-session',
        localUserId: '10000000-0000-4000-8000-000000000001',
        organizationId: '20000000-0000-4000-8000-000000000001',
        tenantId: 'tenant-1',
      }))
      await onEvent({ type: 'done', sessionId: 'new-session' } as never)
      return { sessionId: 'new-session', terminalConfirmed: true }
    })

    const response = await POST(request({
      messages: [{ role: 'user', content: 'start a new session' }],
    }) as never)
    await response.text()

    expect(createSessionApiKeyMock).toHaveBeenCalledTimes(1)
    expect(bindSessionMock).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('re-admits an exact-owner question answer under a fresh processor lease', async () => {
    handleAnswerMock.mockImplementationOnce(async () => {
      expect(release).not.toHaveBeenCalled()
      return { sessionId: 'session-1', terminalConfirmed: true }
    })

    const response = await POST(request({
      answerQuestion: {
        questionId: 'question-1',
        answer: 0,
        sessionId: 'session-1',
      },
    }) as never)

    expect(response.status).toBe(200)
    expect(findOwnedSessionMock).toHaveBeenCalledTimes(1)
    expect(handleAnswerMock).toHaveBeenCalledWith(
      'question-1',
      0,
      'session-1',
      expect.any(Function),
    )
    expect(release).toHaveBeenCalledTimes(1)
  })
})
