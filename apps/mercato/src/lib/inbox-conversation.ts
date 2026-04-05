import type { Knex } from 'knex'
import crypto from 'crypto'

/**
 * Upsert an inbox_conversations record whenever a message is sent or received.
 * This keeps the unified inbox list current without expensive UNION queries.
 */
export async function upsertInboxConversation(
  knex: Knex,
  orgId: string,
  tenantId: string,
  params: {
    contactId?: string | null
    chatConversationId?: string | null
    channel: 'email' | 'sms' | 'chat'
    preview: string
    direction: 'inbound' | 'outbound'
    displayName?: string
    avatarEmail?: string | null
    avatarPhone?: string | null
  },
) {
  const { contactId, chatConversationId, channel, preview, direction, displayName, avatarEmail, avatarPhone } = params
  const now = new Date()

  try {
    // Find existing conversation by contact_id, chat_conversation_id, or email/phone
    let existing = null
    if (contactId) {
      existing = await knex('inbox_conversations')
        .where('contact_id', contactId)
        .where('organization_id', orgId)
        .first()
    }
    if (!existing && chatConversationId) {
      existing = await knex('inbox_conversations')
        .where('chat_conversation_id', chatConversationId)
        .where('organization_id', orgId)
        .first()
    }
    // Fallback: match by email or phone if no contact_id
    if (!existing && !contactId && avatarEmail) {
      existing = await knex('inbox_conversations')
        .where('avatar_email', avatarEmail)
        .where('organization_id', orgId)
        .first()
    }
    if (!existing && !contactId && avatarPhone) {
      existing = await knex('inbox_conversations')
        .where('avatar_phone', avatarPhone)
        .where('organization_id', orgId)
        .first()
    }

    if (existing) {
      const updates: Record<string, unknown> = {
        last_message_at: now,
        last_message_channel: channel,
        last_message_preview: (preview || '').substring(0, 120),
        last_message_direction: direction,
        updated_at: now,
      }

      // Increment unread on inbound messages
      if (direction === 'inbound') {
        updates.unread_count = knex.raw('unread_count + 1')
        updates.status = 'open' // re-open on new inbound
      }

      // Link chat conversation if not already linked
      if (chatConversationId && !existing.chat_conversation_id) {
        updates.chat_conversation_id = chatConversationId
      }

      // Update display name if we have a better one
      if (displayName && (!existing.display_name || existing.display_name === 'Unknown' || existing.display_name === 'Anonymous Visitor')) {
        updates.display_name = displayName
      }
      if (avatarEmail && !existing.avatar_email) updates.avatar_email = avatarEmail
      if (avatarPhone && !existing.avatar_phone) updates.avatar_phone = avatarPhone

      await knex('inbox_conversations').where('id', existing.id).update(updates)
    } else {
      // Create new conversation
      await knex('inbox_conversations').insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        organization_id: orgId,
        contact_id: contactId || null,
        chat_conversation_id: chatConversationId || null,
        status: 'open',
        last_message_at: now,
        last_message_channel: channel,
        last_message_preview: (preview || '').substring(0, 120),
        last_message_direction: direction,
        unread_count: direction === 'inbound' ? 1 : 0,
        display_name: displayName || 'Unknown',
        avatar_email: avatarEmail || null,
        avatar_phone: avatarPhone || null,
        created_at: now,
        updated_at: now,
      })
    }
  } catch (err) {
    console.error('[upsertInboxConversation] failed:', err)
    // Non-blocking — don't fail the parent operation
  }
}
