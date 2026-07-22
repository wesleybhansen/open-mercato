// ORM-SKIP: complex multi-table logic or public/webhook endpoint

import { after, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import crypto from 'crypto'
import type { Knex } from 'knex'
import {
  withCustomersAiAllowance,
  type AllowanceResult,
} from '@/lib/usage/allowance'
import { meterCustomersAi } from '@/lib/usage/meter'

export const metadata = { path: '/chat/public',
  // Anonymous widget endpoint: per-IP rate limits keep one visitor (or bot)
  // from burning a customer org's AI allowance. POST triggers the LLM call,
  // so it gets the tight limit.
  GET: { requireAuth: false, rateLimit: { points: 60, duration: 60, keyPrefix: 'chat-public-get' } },
  POST: { requireAuth: false, rateLimit: { points: 10, duration: 60, blockDuration: 300, keyPrefix: 'chat-public-post' } },
  OPTIONS: { requireAuth: false },
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const BOT_REPLY_CLAIM_SENDER = '__noli_bot_reply_claim__'
const BOT_REPLY_CLAIM_TTL_MS = 20 * 60 * 1000
const BOT_QUEUE_DRAIN_LIMIT = 5

type BotReplyClaim = {
  id: string
  conversationId: string
  inboundMessageId: string
}

type BotReplyClaimResult =
  | { status: 'acquired'; claim: BotReplyClaim }
  | { status: 'busy' | 'completed' | 'invalid'; latestInboundMessageId: string | null }
  | { status: 'superseded'; latestInboundMessageId: string }

type RawRows<T> = { rows?: T[] }

// A stable UUID makes the successful bot message itself the durable completion
// marker for one inbound visitor message. Retries therefore conflict with the
// already-published reply instead of creating a second assistant response.
function botReplyIdForInbound(inboundMessageId: string): string {
  const bytes = crypto
    .createHash('sha256')
    .update(`noli:public-chat:bot-reply:${inboundMessageId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function resolveGoogleChatApiKey(gate: AllowanceResult): string | undefined {
  return gate.byoApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY
}

async function meterPublicChatUsage(
  organizationId: string,
  gate: AllowanceResult,
  result: { usage?: unknown },
): Promise<void> {
  const usage = (result.usage || {}) as {
    promptTokens?: number
    completionTokens?: number
    inputTokens?: number
    outputTokens?: number
  }
  await meterCustomersAi({ orgId: organizationId }, {
    model: 'gemini-3.5-flash',
    tokensIn: usage.promptTokens ?? usage.inputTokens ?? 0,
    tokensOut: usage.completionTokens ?? usage.outputTokens ?? 0,
    feature: 'public-chatbot',
    byoKey: !!gate.byoApiKey,
  })
}

function corsJson(data: any, init?: ResponseInit) {
  const headers = { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  return new NextResponse(JSON.stringify(data), { ...init, headers: { ...init?.headers, ...headers } })
}

// Per-conversation possession secret. A conversation id is a high-entropy UUID
// but it is NOT a secret: it travels in query strings, referrers, browser
// history, and proxies. Binding read/append to a separate token issued only to
// the visitor who started the thread closes the IDOR (read or post to any
// conversation by id). Stored in chat_conversations.visitor_token; the column is
// created idempotently below so no separate migration is needed.
let visitorTokenColumnReady = false
async function ensureVisitorTokenColumn(knex: Knex): Promise<void> {
  if (visitorTokenColumnReady) return
  await knex.raw('ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS visitor_token TEXT')
  visitorTokenColumnReady = true
}

// Constant-time compare that never throws on length/encoding mismatch.
function tokensMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// Authorize a visitor against a conversation row.
// - If the conversation has a token, the caller MUST present the matching one.
// - Legacy conversations created before this change have no token; we allow them
//   so already-open chats degrade safely (they predate the protection and hold
//   no token to send). New conversations always carry a token, so this is a
//   bounded, shrinking legacy window, not an open door for new threads.
function visitorAuthorized(conversation: { visitor_token?: string | null }, token: unknown): boolean {
  if (!conversation.visitor_token) return true
  return tokensMatch(conversation.visitor_token, token)
}

async function acquireBotReplyClaim(
  knex: Knex,
  conversationId: string,
  widgetId: string,
  organizationId: string,
  inboundMessageId: string,
): Promise<BotReplyClaimResult> {
  const claimId = botReplyIdForInbound(inboundMessageId)

  return knex.transaction(async (trx) => {
    // Serialize only the admission decision. The row lock is released before
    // allowance checks or provider I/O, while the inserted claim remains as the
    // durable in-progress marker seen by later workers.
    const locked = await trx.raw(
      `/* public-chat:lock-conversation */
       SELECT id::text AS id
       FROM chat_conversations
       WHERE id = ?::uuid
         AND widget_id = ?::uuid
         AND organization_id = ?::uuid
       FOR UPDATE`,
      [conversationId, widgetId, organizationId],
    ) as unknown as RawRows<{ id: string }>
    if (!locked.rows?.[0]) {
      return { status: 'invalid', latestInboundMessageId: null }
    }

    // A terminated worker must not block a conversation forever. Twenty
    // minutes is comfortably above the registered background task budget while
    // still allowing a later inbound message to recover an abandoned claim.
    await trx.raw(
      `/* public-chat:delete-stale-claims */
       DELETE FROM chat_messages
       WHERE conversation_id = ?::uuid
         AND sender_type = ?
         AND created_at < ?::timestamptz`,
      [
        conversationId,
        BOT_REPLY_CLAIM_SENDER,
        new Date(Date.now() - BOT_REPLY_CLAIM_TTL_MS).toISOString(),
      ],
    )

    const stateResult = await trx.raw(
      `/* public-chat:claim-state */
       SELECT
         (
           SELECT id::text
           FROM chat_messages
           WHERE id = ?::uuid
             AND conversation_id = ?::uuid
             AND sender_type = 'visitor'
         ) AS target_id,
         (
           SELECT id::text
           FROM chat_messages
           WHERE conversation_id = ?::uuid
             AND sender_type = 'visitor'
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ) AS latest_id,
         EXISTS (
           SELECT 1
           FROM chat_messages
           WHERE conversation_id = ?::uuid
             AND sender_type = ?
         ) AS pending_claim,
         EXISTS (
           SELECT 1
           FROM chat_messages
           WHERE id = ?::uuid
             AND conversation_id = ?::uuid
             AND sender_type <> ?
         ) AS reply_exists`,
      [
        inboundMessageId,
        conversationId,
        conversationId,
        conversationId,
        BOT_REPLY_CLAIM_SENDER,
        claimId,
        conversationId,
        BOT_REPLY_CLAIM_SENDER,
      ],
    ) as unknown as RawRows<{
      target_id: string | null
      latest_id: string | null
      pending_claim: boolean
      reply_exists: boolean
    }>
    const state = stateResult.rows?.[0]
    const latestInboundMessageId = state?.latest_id ?? null
    if (!state?.target_id) return { status: 'invalid', latestInboundMessageId }
    if (state.reply_exists) return { status: 'completed', latestInboundMessageId }
    if (state.pending_claim) return { status: 'busy', latestInboundMessageId }
    if (state.target_id !== state.latest_id) {
      return state.latest_id
        ? { status: 'superseded', latestInboundMessageId: state.latest_id }
        : { status: 'invalid', latestInboundMessageId: null }
    }

    const inserted = await trx.raw(
      `/* public-chat:insert-claim */
       INSERT INTO chat_messages (
         id, conversation_id, sender_type, message, is_bot, created_at
       ) VALUES (?::uuid, ?::uuid, ?, ?, false, ?::timestamptz)
       ON CONFLICT (id) DO NOTHING
       RETURNING id::text AS id`,
      [
        claimId,
        conversationId,
        BOT_REPLY_CLAIM_SENDER,
        inboundMessageId,
        new Date().toISOString(),
      ],
    ) as unknown as RawRows<{ id: string }>
    if (!inserted.rows?.[0]) {
      return { status: 'completed', latestInboundMessageId }
    }

    return {
      status: 'acquired',
      claim: { id: claimId, conversationId, inboundMessageId },
    }
  })
}

async function abandonBotReplyClaim(knex: Knex, claim: BotReplyClaim): Promise<void> {
  await knex('chat_messages')
    .where('id', claim.id)
    .where('conversation_id', claim.conversationId)
    .where('sender_type', BOT_REPLY_CLAIM_SENDER)
    .delete()
    .catch(() => {})
}

async function finalizeBotReplyClaim(
  knex: Knex,
  claim: BotReplyClaim,
  message: string,
): Promise<boolean> {
  const now = new Date()
  const updated = await knex('chat_messages')
    .where('id', claim.id)
    .where('conversation_id', claim.conversationId)
    .where('sender_type', BOT_REPLY_CLAIM_SENDER)
    .update({
      sender_type: 'business',
      message,
      is_bot: true,
      created_at: now,
    })
  if (!updated) return false
  await knex('chat_conversations')
    .where('id', claim.conversationId)
    .update({ updated_at: now, agent_typing: false, agent_typing_at: null })
    .catch(() => {})
  return true
}

async function promoteExistingBotReplyToClaim(
  knex: Knex,
  claim: BotReplyClaim,
  sourceMessageId: string,
): Promise<boolean> {
  return knex.transaction(async (trx) => {
    await trx('chat_conversations')
      .select('id')
      .where('id', claim.conversationId)
      .forUpdate()
      .first()

    const source = await trx('chat_messages')
      .where('id', sourceMessageId)
      .where('conversation_id', claim.conversationId)
      .where('sender_type', 'business')
      .where('is_bot', true)
      .first()
    if (!source) return false

    const updated = await trx('chat_messages')
      .where('id', claim.id)
      .where('conversation_id', claim.conversationId)
      .where('sender_type', BOT_REPLY_CLAIM_SENDER)
      .update({
        sender_type: 'business',
        message: source.message,
        is_bot: true,
        created_at: source.created_at,
      })
    if (!updated) return false
    await trx('chat_messages').where('id', sourceMessageId).delete()
    return true
  })
}

async function findLatestBotMessageId(knex: Knex, conversationId: string): Promise<string | null> {
  const message = await knex('chat_messages')
    .where('conversation_id', conversationId)
    .where('sender_type', 'business')
    .where('is_bot', true)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .select('id')
    .first()
  return typeof message?.id === 'string' ? message.id : null
}

async function findLatestPendingInboundMessageId(
  knex: Knex,
  conversationId: string,
): Promise<string | null> {
  const inbound = await knex('chat_messages')
    .where('conversation_id', conversationId)
    .where('sender_type', 'visitor')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .select('id')
    .first()
  if (typeof inbound?.id !== 'string') return null

  const reply = await knex('chat_messages')
    .where('id', botReplyIdForInbound(inbound.id))
    .where('conversation_id', conversationId)
    .select('sender_type')
    .first()
  return reply && reply.sender_type !== BOT_REPLY_CLAIM_SENDER ? null : inbound.id
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const body = await req.json()

    if (body.conversationId && body.message) {
      await ensureVisitorTokenColumn(knex)
      const conversation = await knex('chat_conversations').where('id', body.conversationId).first()
      if (!conversation) return corsJson({ ok: false, error: 'Conversation not found' }, { status: 404 })
      // Possession check: the conversation id alone is not enough to post to it.
      if (!visitorAuthorized(conversation, body.visitorToken)) {
        return corsJson({ ok: false, error: 'Not found' }, { status: 404 })
      }

      const msgId = crypto.randomUUID()
      await knex('chat_messages').insert({
        id: msgId,
        conversation_id: body.conversationId,
        sender_type: 'visitor',
        message: body.message.trim(),
        created_at: new Date(),
      })
      await knex('chat_conversations')
        .where('id', body.conversationId)
        .update({ updated_at: new Date(), visitor_typing: false, visitor_typing_at: null })

      // Update unified inbox
      try {
        const { upsertInboxConversation } = await import('@/lib/inbox-conversation')
        upsertInboxConversation(knex, conversation.organization_id, conversation.tenant_id, {
          contactId: conversation.contact_id || null,
          chatConversationId: body.conversationId,
          channel: 'chat',
          preview: body.message.trim(),
          direction: 'inbound',
          displayName: conversation.visitor_name || conversation.visitor_email || 'Visitor',
          avatarEmail: conversation.visitor_email,
        }).catch(() => {})
      } catch { /* non-blocking */ }

      // Keep the response asynchronous, but register it with the request
      // lifecycle so the runtime cannot silently terminate an in-flight model
      // call after returning the visitor's message.
      scheduleBotResponse(
        body.conversationId,
        conversation.widget_id,
        conversation.organization_id,
        msgId,
      )

      return corsJson({ ok: true, data: { id: msgId } }, { status: 201 })
    }

    const { widgetId, visitorName, visitorEmail, message } = body
    if (!widgetId || !message?.trim()) {
      return corsJson({ ok: false, error: 'widgetId and message are required' }, { status: 400 })
    }

    const widget = await knex('chat_widgets').where('id', widgetId).andWhere('is_active', true).first()
    if (!widget) return corsJson({ ok: false, error: 'Widget not found or inactive' }, { status: 404 })

    let contactId: string | null = null
    if (visitorEmail) {
      const existingContact = await knex('customer_entities')
        .where('organization_id', widget.organization_id)
        .andWhere('primary_email', visitorEmail.trim().toLowerCase())
        .whereNull('deleted_at')
        .first()

      if (existingContact) {
        contactId = existingContact.id
      } else {
        contactId = crypto.randomUUID()
        const chatDisplayName = visitorName?.trim() || visitorEmail.trim()
        await knex('customer_entities').insert({
          id: contactId,
          tenant_id: widget.tenant_id,
          organization_id: widget.organization_id,
          kind: 'person',
          display_name: chatDisplayName,
          primary_email: visitorEmail.trim().toLowerCase(),
          source: 'chat_widget',
          status: 'active',
          email_status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
        const chatNameParts = chatDisplayName.split(' ')
        await knex('customer_people').insert({
          id: crypto.randomUUID(), tenant_id: widget.tenant_id, organization_id: widget.organization_id,
          entity_id: contactId, first_name: chatNameParts[0] || '', last_name: chatNameParts.slice(1).join(' ') || '',
          created_at: new Date(), updated_at: new Date(),
        }).catch(() => {})
      }
    }

    // Log chat start to timeline
    if (contactId) {
      const { logTimelineEvent } = await import('@/lib/timeline')
      await logTimelineEvent(knex, {
        tenantId: widget.tenant_id, organizationId: widget.organization_id, contactId,
        eventType: 'chat', title: 'Chat conversation started',
        description: visitorName ? `Started by ${visitorName}` : undefined,
      })
    }

    await ensureVisitorTokenColumn(knex)
    const conversationId = crypto.randomUUID()
    // High-entropy possession token, returned once to the widget and required on
    // every later poll/append for this conversation.
    const visitorToken = crypto.randomBytes(32).toString('base64url')
    await knex('chat_conversations').insert({
      id: conversationId,
      tenant_id: widget.tenant_id,
      organization_id: widget.organization_id,
      widget_id: widgetId,
      contact_id: contactId,
      visitor_name: visitorName?.trim() || null,
      visitor_email: visitorEmail?.trim()?.toLowerCase() || null,
      visitor_token: visitorToken,
      status: 'open',
      created_at: new Date(),
      updated_at: new Date(),
    })

    const msgId = crypto.randomUUID()
    await knex('chat_messages').insert({
      id: msgId,
      conversation_id: conversationId,
      sender_type: 'visitor',
      message: message.trim(),
      created_at: new Date(),
    })

    // Update unified inbox
    try {
      const { upsertInboxConversation } = await import('@/lib/inbox-conversation')
      upsertInboxConversation(knex, widget.organization_id, widget.tenant_id, {
        contactId: contactId || null,
        chatConversationId: conversationId,
        channel: 'chat',
        preview: message.trim(),
        direction: 'inbound',
        displayName: visitorName?.trim() || visitorEmail?.trim() || 'Visitor',
        avatarEmail: visitorEmail?.trim() || null,
      }).catch(() => {})
    } catch { /* non-blocking */ }

    // Background bot response for new conversations.
    scheduleBotResponse(conversationId, widgetId, widget.organization_id, msgId)

    return corsJson({
      ok: true,
      data: {
        conversationId,
        visitorToken,
        greeting: widget.greeting_message || 'Hi there! How can we help you today?',
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[chat.public.post]', error)
    return corsJson({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const url = new URL(req.url)
    const conversationId = url.searchParams.get('conversationId')
    if (!conversationId) return corsJson({ ok: false, error: 'conversationId required' }, { status: 400 })
    const visitorToken = url.searchParams.get('visitorToken')

    await ensureVisitorTokenColumn(knex)
    const conversation = await knex('chat_conversations').where('id', conversationId).first()
    if (!conversation) return corsJson({ ok: false, error: 'Not found' }, { status: 404 })
    // Possession check: reading a transcript by id alone is no longer allowed.
    if (!visitorAuthorized(conversation, visitorToken)) {
      return corsJson({ ok: false, error: 'Not found' }, { status: 404 })
    }

    const messages = await knex('chat_messages')
      .where('conversation_id', conversationId)
      .whereNot('sender_type', BOT_REPLY_CLAIM_SENDER)
      .orderBy('created_at', 'asc')
      .select('id', 'sender_type', 'message', 'created_at', 'is_bot')

    return corsJson({
      ok: true,
      data: {
        messages,
        agent_typing: conversation.agent_typing,
        agent_typing_at: conversation.agent_typing_at,
      },
    })
  } catch (error) {
    console.error('[chat.public.get]', error)
    return corsJson({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

function scheduleBotResponse(
  conversationId: string,
  widgetId: string,
  organizationId: string,
  inboundMessageId: string,
): void {
  try {
    after(() => tryBotResponse(conversationId, widgetId, organizationId, inboundMessageId))
  } catch (error) {
    console.error('[chat.bot.schedule]', error)
  }
}

async function tryBotResponse(
  conversationId: string,
  widgetId: string,
  organizationId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    let targetInboundMessageId = inboundMessageId

    // A reply can finish while newer visitor messages arrive. Drain the newest
    // unhandled inbound next so rapid POSTs produce ordered assistant replies,
    // even when their independently-scheduled workers overlap.
    for (let attempt = 0; attempt < BOT_QUEUE_DRAIN_LIMIT; attempt += 1) {
      const claimResult = await acquireBotReplyClaim(
        knex,
        conversationId,
        widgetId,
        organizationId,
        targetInboundMessageId,
      )

      if (claimResult.status === 'superseded') {
        targetInboundMessageId = claimResult.latestInboundMessageId
        continue
      }
      if (claimResult.status === 'busy' || claimResult.status === 'invalid') return
      if (claimResult.status === 'completed') {
        const nextInboundMessageId = await findLatestPendingInboundMessageId(knex, conversationId)
        if (!nextInboundMessageId || nextInboundMessageId === targetInboundMessageId) return
        targetInboundMessageId = nextInboundMessageId
        continue
      }

      const claim = claimResult.claim
      let completed = false
      try {
        const execution = await withCustomersAiAllowance(
          em,
          { orgId: organizationId },
          'google',
          (gate) => tryBotResponseWithinLease(
            knex,
            conversationId,
            widgetId,
            organizationId,
            targetInboundMessageId,
            claim,
            gate,
          ),
        )
        completed = execution.executed && execution.value
      } finally {
        if (!completed) {
          await abandonBotReplyClaim(knex, claim)
          await knex('chat_conversations').where('id', conversationId).update({
            agent_typing: false,
            agent_typing_at: null,
          }).catch(() => {})
        }
      }
      if (!completed) return

      const nextInboundMessageId = await findLatestPendingInboundMessageId(knex, conversationId)
      if (!nextInboundMessageId || nextInboundMessageId === targetInboundMessageId) return
      targetInboundMessageId = nextInboundMessageId
    }
  } catch (error) {
    console.error('[chat.bot.background]', error)
  }
}

async function tryBotResponseWithinLease(
  knex: Knex,
  conversationId: string,
  widgetId: string,
  organizationId: string,
  inboundMessageId: string,
  claim: BotReplyClaim,
  gate: AllowanceResult,
): Promise<boolean> {
  try {
    const widget = await knex('chat_widgets').where('id', widgetId).first()
    if (!widget || widget.organization_id !== organizationId) return false
    // Customer Service is the single owner of website chat. When the org has
    // cs_chat_enabled, the CS drafter (grounded answers + flag-escalate) is the
    // sole brain (handled in the CS branch below). The legacy widget bot only
    // runs as a fallback: when CS is off and the widget's own bot toggle is on.
    // If neither CS chat nor the legacy widget bot is on, do nothing.
    const csRow = await knex('customer_service_settings')
      .where('organization_id', widget.organization_id)
      .select('cs_chat_enabled')
      .first()
    const csChatEnabled = !!csRow?.cs_chat_enabled
    if (!csChatEnabled && !widget.bot_enabled) return false

    const allMessages = await knex('chat_messages')
      .where('conversation_id', conversationId)
      .whereNot('sender_type', BOT_REPLY_CLAIM_SENDER)
      .orderBy('created_at', 'desc')
      .limit(50)

    // Check if a handoff already occurred
    const lastHandoffMessage = allMessages.find(
      (m: { sender_type: string; message: string }) => m.sender_type === 'business' && m.message.includes('[HANDOFF]'),
    )
    if (lastHandoffMessage) return false

    // Count existing bot messages in this conversation
    const botMessageCount = allMessages.filter(
      (m: { sender_type: string; is_bot?: boolean }) => m.sender_type === 'business' && m.is_bot,
    ).length

    const maxResponses = widget.bot_max_responses ?? 25
    const handoffMessage = widget.bot_handoff_message || 'Let me connect you with a team member who can help with that!'

    // If bot has reached max responses, auto-handoff instead of generating a new response
    if (botMessageCount >= maxResponses) {
      return finalizeBotReplyClaim(knex, claim, handoffMessage)
    }

    const recentMessages = allMessages.slice(0, 10)
    const messagesForContext = [...recentMessages].reverse()

    let guardrailsBlock = ''
    if (widget.bot_guardrails?.trim()) {
      guardrailsBlock = `\n\nOFF-LIMITS TOPICS — NEVER discuss these topics. If the visitor asks about any of them, politely decline and offer to connect them with a human agent:
${widget.bot_guardrails}`
    }

    const systemPrompt = `You are a helpful AI assistant for a business. You answer customer questions based on the knowledge base provided.

KNOWLEDGE BASE:
${widget.bot_knowledge_base || 'No specific knowledge base provided.'}

PERSONALITY: ${widget.bot_personality || 'friendly and helpful'}

ADDITIONAL INSTRUCTIONS: ${widget.bot_instructions || 'None'}${guardrailsBlock}

RULES:
- Have a natural, flowing conversation. Engage like a real person would.
- Give thorough, helpful responses. Use enough detail to fully answer the question.
- Use the knowledge base to provide accurate, specific information when relevant.
- If you don't have the exact answer, try to be helpful with what you know. Only say "I don't know" if you truly can't help.
- Never invent specific facts, prices, or details that aren't in the knowledge base.
- Match the personality described above in tone and style.
- Ask follow-up questions to better understand what the visitor needs.
- Format responses naturally. Short paragraphs are fine. Use bullet points only for actual lists.
- ONLY use [HANDOFF] in these specific situations:
  1. The visitor explicitly asks to speak to a human/agent/person
  2. The conversation has gone back and forth and you genuinely cannot help further
  3. The topic requires a human decision (e.g., custom pricing, contract negotiation)
- Do NOT hand off just because a question is slightly outside the knowledge base. Try to help first.
- When you do hand off, respond with [HANDOFF] followed by: "${handoffMessage}"
- If asked about an off-limits topic, politely redirect the conversation without handing off unless the visitor insists.`

    // Resolve allowance before requiring a platform key: an over-pool org with
    // a valid Google BYOK key remains allowed even when this deployment has no
    // platform Google credential.
    if (!gate.allowed) {
      return finalizeBotReplyClaim(knex, claim, handoffMessage)
    }
    const apiKey = resolveGoogleChatApiKey(gate)
    if (!apiKey) return false

    // Show typing indicator while AI generates response
    await knex('chat_conversations').where('id', conversationId).update({
      agent_typing: true,
      agent_typing_at: new Date(),
    }).catch(() => {})

    // Customer Service handling of website chat. When the widget's org has
    // cs_chat_enabled, route the inbound visitor message through the CS drafter
    // (flag scenarios + grounding) instead of the standalone widget bot. The
    // allowance gate, max-bot-responses, and handoff guards above still apply.
    // A non-flagged message auto-answers instantly; a flagged scenario whose
    // action is auto_send sends the scenario-instructed reply; any pause scenario
    // escalates (queues a flagged proposal + alerts the org + posts a holding
    // message). On a drafting failure we fall through to the widget bot below so
    // chat is never left silent.
    let csPublishedReplyId: string | null = null
    try {
      const csSettings = await knex('customer_service_settings')
        .where('organization_id', widget.organization_id)
        .first()
      if (csSettings?.cs_chat_enabled) {
        const conversation = await knex('chat_conversations').where('id', conversationId).first()
        if (conversation) {
          // Build the chat transcript oldest-to-newest from the recent messages.
          const recentMessages = messagesForContext.map((m: { sender_type: string; message: string }) => ({
            direction: m.sender_type === 'visitor' ? 'inbound' : 'outbound',
            bodyText: m.message,
            body: m.message,
          }))
          const lastInbound = messagesForContext.find(
            (m: { id?: string; sender_type: string }) =>
              m.id === inboundMessageId && m.sender_type === 'visitor',
          )
          const previousBotMessageId = await findLatestBotMessageId(knex, conversationId)
          const { handleCsChatMessage } = await import('@/modules/customers/lib/cs-chat')
          const handled = await handleCsChatMessage(knex, {
            aiKey: apiKey,
            byoKey: !!gate.byoApiKey,
            orgId: conversation.organization_id,
            tenantId: conversation.tenant_id,
            conversation,
            settings: { flag_scenarios: csSettings.flag_scenarios, signature: csSettings.signature },
            recentMessages,
            lastInboundText: lastInbound?.message || '',
          })
          if (handled) {
            csPublishedReplyId = await findLatestBotMessageId(knex, conversationId)
            if (!csPublishedReplyId || csPublishedReplyId === previousBotMessageId) {
              throw new Error('Customer-service chat handled without publishing a new bot message')
            }
            const promoted = await promoteExistingBotReplyToClaim(knex, claim, csPublishedReplyId)
            if (!promoted) throw new Error('Customer-service bot reply claim promotion failed')
            await knex('chat_conversations')
              .where('id', conversationId)
              .update({ updated_at: new Date(), agent_typing: false, agent_typing_at: null })
              .catch(() => {})
            return true
          }
        }
      }
    } catch (csErr) {
      console.error('[chat.bot.cs]', csErr)
      // Once CS has published, never fall through and add a second standalone
      // widget reply. A failed claim promotion is recovered on the next inbound.
      if (csPublishedReplyId) return false
      // Fall through to the widget bot below so the visitor still gets a reply.
    }

    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const { generateText } = await import('ai')

    // Over-allowance orgs that gated through on a BYO key run on that key, not
    // the platform key (otherwise Noli eats the over-pool cost).
    const google = createGoogleGenerativeAI({ apiKey })
    const model = google('gemini-3.5-flash')

    const aiMessages = messagesForContext.map((m: { sender_type: string; message: string }) => ({
      role: m.sender_type === 'visitor' ? 'user' as const : 'assistant' as const,
      content: m.message,
    }))

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: aiMessages,
    })

    // Await metering before this callback returns so the GDPR processor lease
    // covers the full external usage write.
    await meterPublicChatUsage(widget.organization_id, gate, result)

    const botReply = result.text?.trim()
    if (!botReply) return false

    const isHandoff = botReply.includes('[HANDOFF]')
    const cleanedReply = isHandoff ? botReply.replace('[HANDOFF]', '').trim() || handoffMessage : botReply

    return finalizeBotReplyClaim(knex, claim, cleanedReply)
  } catch (err) {
    console.error('[chat.bot.response]', err)
    // Clear typing indicator on error
    await knex('chat_conversations').where('id', conversationId).update({
      agent_typing: false, agent_typing_at: null,
    }).catch(() => {})
    return false
  }
}

export const publicChatTestHelpers = {
  acquireBotReplyClaim,
  botReplyIdForInbound,
  meterPublicChatUsage,
  resolveGoogleChatApiKey,
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Chat',
  summary: 'Public chat API for website visitors',
  methods: {
    POST: { summary: 'Start a conversation or send a visitor message', tags: ['Chat'] },
    GET: { summary: 'Poll messages for a conversation', tags: ['Chat'] },
  },
}
