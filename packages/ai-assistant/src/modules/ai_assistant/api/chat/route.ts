import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  handleOpenCodeAnswer,
  handleOpenCodeMessageStreaming,
  type OpenCodeStreamEvent,
} from '../../lib/opencode-handlers'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  generateSessionToken,
  createSessionApiKey,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  bindOpenCodeSession,
  findOwnedOpenCodeSession,
} from '@open-mercato/core/modules/api_keys/services/openCodeSessionBinding'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { checkOrgAiAllowance } from '@open-mercato/shared/lib/noli/allowance'
import { logCrmAiUsage } from '@open-mercato/shared/lib/noli/ai-usage'
import {
  isProviderConfigured,
  resolveChatConfig,
} from '../../lib/chat-config'
import {
  AI_ASSISTANT_GDPR_BLOCK_MESSAGE,
  beginAiAssistantProcessorLease,
  type AiAssistantProcessorLease,
} from '../../lib/gdpr-processor-lease'

/**
 * System instructions injected at the start of new chat sessions.
 * These ensure the AI follows the correct workflow for data operations.
 */
const CHAT_SYSTEM_INSTRUCTIONS = `
You are a helpful business assistant for Open Mercato.

EFFICIENCY - CRITICAL:
- MINIMIZE tool calls. If you already have the information, DO NOT call tools again.
- When you retrieve entity info or search results, REMEMBER and REUSE that data.
- For simple queries, use ONE search and present results - don't over-fetch.
- For updates: search once to find the record, then call_api once to update.

STATUS UPDATES: Before each tool call, output a brief status line:
- "🔍 Searching..." before search_query
- "📋 Getting details..." before search_get or understand_entity
- "🔗 Calling API..." before call_api

RESPONSE RULES:
- Be proactive - fetch data and present results, don't ask what the user wants to see
- Never show technical terms, IDs, JSON, or internal reasoning
- Present results in clean business language with **bold names** and bullet points
- Only ask for confirmation before create/update/delete operations
`.trim()

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

/**
 * Get user's role IDs from the database.
 */
async function getUserRoleIds(
  em: EntityManager,
  userId: string,
  tenantId: string | null
): Promise<string[]> {
  if (!tenantId) return []

  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId as any, role: { tenantId } } as any,
    { populate: ['role'] },
    { tenantId, organizationId: null },
  )
  const linkList = Array.isArray(links) ? links : []
  return linkList
    .map((l) => (l.role as any)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * Chat endpoint that routes messages to OpenCode agent.
 * OpenCode connects to MCP server for tool access (api_discover, api_execute, api_schema).
 *
 * Emits verbose SSE events for debugging:
 * - thinking: Agent started processing
 * - metadata: Model, tokens, timing info
 * - tool-call: Tool invocation with args
 * - tool-result: Tool response
 * - text: Response text
 * - question: Confirmation question from agent
 * - done: Complete with session ID
 * - error: Error occurred
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let processorLease: AiAssistantProcessorLease | null = null
  let leaseHandedToStream = false
  let retainLeaseForAmbiguousExternalWork = false
  try {
    const body = await req.json()
    const { messages, sessionId, answerQuestion } = body as {
      messages?: Array<{ role: string; content: string }>
      sessionId?: string
      // For answering a question
      answerQuestion?: {
        questionId: string
        answer: number
        sessionId: string
      }
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    processorLease = await beginAiAssistantProcessorLease(em, auth)
    if (!processorLease) {
      return NextResponse.json({ error: AI_ASSISTANT_GDPR_BLOCK_MESSAGE }, { status: 503 })
    }
    if (!auth.tenantId) {
      return NextResponse.json({ error: AI_ASSISTANT_GDPR_BLOCK_MESSAGE }, { status: 503 })
    }
    const sessionOwner = {
      localUserId: processorLease.localUserId,
      organizationId: processorLease.organizationId,
      tenantId: auth.tenantId,
    }

    const requestedSessionId = answerQuestion?.sessionId ?? sessionId
    if (requestedSessionId) {
      const ownedSession = await findOwnedOpenCodeSession(em, requestedSessionId, sessionOwner)
      if (!ownedSession) {
        return NextResponse.json({ error: 'AI session is unavailable.' }, { status: 404 })
      }
    }

    let config = await resolveChatConfig(container)
    if (!config) {
      const configuredProvider = resolveFirstConfiguredOpenCodeProvider()
      if (!configuredProvider) {
        return NextResponse.json({ error: 'AI provider is unavailable.' }, { status: 503 })
      }
      config = { providerId: configuredProvider, model: '', updatedAt: '' }
    }
    if (!isProviderConfigured(config.providerId)) {
      return NextResponse.json({ error: 'AI provider is unavailable.' }, { status: 503 })
    }
    const meterEm = em.fork()
    const meterOrg = await meterEm.findOne(Organization, { id: processorLease.organizationId })
    const gate = await checkOrgAiAllowance(meterOrg?.noliOrgId, config.providerId)
    if (!gate.allowed || gate.byoApiKey) {
      return NextResponse.json(
        { error: "You've used your team's monthly AI allowance. Add your own provider API key or upgrade your plan to keep using AI." },
        { status: 402 },
      )
    }
    const { modelId } = resolveOpenCodeModel(config.providerId, {
      overrideModel: config.model,
    })

    // Handle question answer - simple JSON response, not SSE
    // The original SSE stream continues and will receive the follow-up response
    if (answerQuestion) {
      const result = await handleOpenCodeAnswer(
        answerQuestion.questionId,
        answerQuestion.answer,
        answerQuestion.sessionId,
        async () => {},
      )
      if (!result.terminalConfirmed) {
        retainLeaseForAmbiguousExternalWork = true
        return NextResponse.json({ error: 'AI session state is ambiguous.' }, { status: 503 })
      }
      return NextResponse.json({ success: true })
    }

    // Handle regular message
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
    }

    // Get the latest user message
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content
    if (!lastUserMessage) {
      return NextResponse.json({ error: 'No user message found' }, { status: 400 })
    }

    // For new sessions, create an ephemeral API key that inherits user permissions
    // The API key secret is encrypted and stored; MCP server recovers it via session token
    let sessionToken: string | null = null
    let sessionKeyId: string | null = null
    if (!sessionId) {
      const userRoleIds = await getUserRoleIds(em, processorLease.localUserId, auth.tenantId)
      sessionToken = generateSessionToken()
      const sessionKey = await createSessionApiKey(em, {
        sessionToken,
        userId: processorLease.localUserId,
        userRoles: userRoleIds,
        tenantId: auth.tenantId,
        organizationId: processorLease.organizationId,
        ttlMinutes: 120,
      })
      sessionKeyId = sessionKey.keyId
    }

    // Build the message to send to OpenCode
    // For NEW sessions: inject system instructions + session token
    // For existing sessions: only inject session token if available
    let messageToSend = ''

    // For NEW sessions only, prepend system instructions
    if (!sessionId) {
      messageToSend = `${CHAT_SYSTEM_INSTRUCTIONS}\n\n`
    }

    // If we have a session token, prepend explicit instructions for the AI to include it in tool calls
    if (sessionToken) {
      messageToSend += `[Session Authorization: ${sessionToken}. Include "_sessionToken": "${sessionToken}" in EVERY tool call.]\n\n`
    }

    messageToSend += lastUserMessage
    let usageMetadata: { model?: string; tokensIn: number; tokensOut: number } | null = null

    // Create the stream only after every synchronous validation and the
    // question-answer path have completed. An unconsumed TransformStream
    // writer can otherwise remain blocked on backpressure for JSON responses.
    const encoder = new TextEncoder()
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    let writerClosed = false

    const writeSSE = async (event: OpenCodeStreamEvent | { type: string; [key: string]: unknown }) => {
      if (writerClosed) return
      try {
        const jsonStr = JSON.stringify(event)
        await writer.write(encoder.encode(`data: ${jsonStr}\n\n`))
      } catch {
        // The reader may have disconnected while OpenCode was finishing.
        console.warn('[AI Chat] Failed to write SSE event:', event.type)
      }
    }

    const closeWriter = async () => {
      if (writerClosed) return
      writerClosed = true
      try {
        await writer.close()
      } catch {
        // Already closed
      }
    }

    // Process in background - starts AFTER Response is returned so there's a reader for the stream
    ;(async () => {
      try {
        // Emit session-authorized event first (if we have a token)
        if (sessionToken) {
          console.log('[AI Chat] Emitting session-authorized event')
          await writeSSE({
            type: 'session-authorized',
            sessionToken: sessionToken.slice(0, 12) + '...',
          })
        }

        // Emit thinking event for UX feedback
        await writeSSE({ type: 'thinking' })

        // Use streaming handler that supports questions
        const result = await handleOpenCodeMessageStreaming(
          {
            message: messageToSend,
            sessionId,
            model: { providerID: config.providerId, modelID: modelId },
            onSessionReady: sessionToken && sessionKeyId
              ? async (externalSessionId) => {
                  await bindOpenCodeSession(em, {
                    keyId: sessionKeyId,
                    sessionToken,
                    sessionId: externalSessionId,
                    ...sessionOwner,
                  })
                }
              : undefined,
          },
          async (event) => {
            if (event.type === 'metadata' && event.tokens) {
              usageMetadata = {
                model: event.model,
                tokensIn: event.tokens.input,
                tokensOut: event.tokens.output,
              }
            }
            await writeSSE(event)
          }
        )
        if (usageMetadata && meterOrg?.noliOrgId) {
          await logCrmAiUsage({
            noliOrgId: meterOrg.noliOrgId,
            model: usageMetadata.model || modelId,
            tokensIn: usageMetadata.tokensIn,
            tokensOut: usageMetadata.tokensOut,
            feature: 'assistant-chat',
            byoKey: false,
          }).catch(() => {})
        }
        if (!result.terminalConfirmed) {
          retainLeaseForAmbiguousExternalWork = true
          await writeSSE({ type: 'error', error: 'AI session state is ambiguous.' })
        }
      } catch (error) {
        console.error('[AI Chat] OpenCode error:', error)
        await writeSSE({
          type: 'error',
          error: error instanceof Error ? error.message : 'OpenCode request failed',
        })
      } finally {
        if (!retainLeaseForAmbiguousExternalWork) {
          await processorLease?.release().catch((releaseError) => {
            console.error('[AI Chat] Failed to release processor lease:', releaseError)
          })
        }
        await closeWriter()
      }
    })()
    leaseHandedToStream = true

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[AI Chat] Error:', error)
    return NextResponse.json({ error: 'Chat request failed' }, { status: 500 })
  } finally {
    if (!leaseHandedToStream && !retainLeaseForAmbiguousExternalWork) {
      await processorLease?.release().catch((releaseError) => {
        console.error('[AI Chat] Failed to release processor lease:', releaseError)
      })
    }
  }
}
