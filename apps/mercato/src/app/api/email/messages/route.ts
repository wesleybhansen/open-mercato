import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sendEmailForOrg } from '../email-router'
import { EmailSenderService } from '../../../../modules/email/services/email-sender'

// GET: List email messages for the org (optionally filtered by contactId, dealId, direction)
export async function GET(req: Request) {
  await bootstrap()
  const auth = await getAuthFromCookies()
  if (!auth?.sub || !auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const url = new URL(req.url)

    const contactId = url.searchParams.get('contactId')
    const dealId = url.searchParams.get('dealId')
    const direction = url.searchParams.get('direction')
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '20'), 100)

    let query = knex('email_messages')
      .where('tenant_id', auth.tenantId)
      .where('organization_id', auth.orgId)
    if (contactId) query = query.where('contact_id', contactId)
    if (dealId) query = query.where('deal_id', dealId)
    if (direction) query = query.where('direction', direction)

    const [{ count: total }] = await query.clone().count()
    const messages = await query
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({
      ok: true,
      data: messages,
      pagination: {
        page,
        pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / pageSize),
      },
    })
  } catch (error) {
    console.error('[email.messages.list]', error)
    return NextResponse.json({ ok: false, error: 'Failed to list messages' }, { status: 500 })
  }
}

// POST: Send an email and store it in email_messages
export async function POST(req: Request) {
  await bootstrap()
  const auth = await getAuthFromCookies()
  if (!auth?.sub || !auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const body = await req.json()

    const { to, cc, bcc, subject, bodyHtml, bodyText, contactId, dealId, replyTo } = body
    if (!to || !subject || !bodyHtml) {
      return NextResponse.json(
        { ok: false, error: 'to, subject, and bodyHtml are required' },
        { status: 400 },
      )
    }

    const ccValue = typeof cc === 'string' && cc.trim() ? cc.trim() : undefined
    const bccValue = typeof bcc === 'string' && bcc.trim() ? bcc.trim() : undefined

    const baseUrl = process.env.APP_URL || 'http://localhost:3000'
    const sender = new EmailSenderService()
    const id = require('crypto').randomUUID()
    const trackingId = require('crypto').randomUUID()

    // Inject open/click tracking and unsubscribe link
    let trackedHtml = sender.injectTrackingPixel(bodyHtml, trackingId, baseUrl)
    trackedHtml = sender.wrapLinksForTracking(trackedHtml, trackingId, baseUrl)
    if (contactId) {
      trackedHtml = sender.injectUnsubscribeLink(trackedHtml, contactId, baseUrl)
    }

    // Try sending via user's connected email provider (Gmail, Outlook, SMTP)
    const routerResult = await sendEmailForOrg(knex, auth.orgId, auth.tenantId, auth.sub, {
      to,
      cc: ccValue,
      bcc: bccValue,
      subject,
      htmlBody: trackedHtml,
      textBody: bodyText,
      contactId,
    })

    let status: string
    let sentAt: Date | null = null
    let fromAddress: string
    let messageMetadata: Record<string, unknown> = {}

    let primaryProviderError: string | null = null
    if (routerResult.ok) {
      status = 'sent'
      sentAt = new Date()
      fromAddress = routerResult.fromAddress || ''
      messageMetadata = {
        providerId: routerResult.messageId,
        provider: routerResult.sentVia,
      }
    } else {
      // Primary provider failed — fall back to Resend / system sender
      primaryProviderError = routerResult.error || null
      console.warn('[email.messages] Primary provider failed:', primaryProviderError, '— trying fallback')
      fromAddress = process.env.EMAIL_FROM || 'noreply@localhost'
      try {
        const result = await sender.send({
          to,
          subject,
          html: trackedHtml,
          text: bodyText,
          replyTo,
        })
        status = 'sent'
        sentAt = new Date()
        messageMetadata = {
          providerId: result.id,
          provider: result.provider,
          fallback: true,
        }
      } catch (err) {
        status = 'failed'
        messageMetadata = {
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }

    // Persist the email record
    await knex('email_messages').insert({
      id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId,
      direction: 'outbound',
      from_address: fromAddress,
      to_address: to,
      cc: ccValue || null,
      bcc: bccValue || null,
      subject,
      body_html: bodyHtml,
      body_text: bodyText || null,
      contact_id: contactId || null,
      deal_id: dealId || null,
      status,
      tracking_id: trackingId,
      metadata: JSON.stringify(messageMetadata),
      created_at: new Date(),
      sent_at: sentAt,
    })

    // Log to contact timeline
    if (contactId && status === 'sent') {
      try {
        const { logTimelineEvent } = await import('@/lib/timeline')
        await logTimelineEvent(knex, {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          contactId,
          eventType: 'email_sent',
          title: `Email sent: ${subject}`,
          metadata: { to, sentVia: routerResult.sentVia || messageMetadata.provider },
        })
      } catch {}
    }

    // Update unified inbox — always create/update even without contactId
    {
      const { upsertInboxConversation } = await import('@/lib/inbox-conversation')
      let resolvedContactId = contactId || null
      let displayName = to
      let avatarEmail = to
      let avatarPhone: string | null = null
      // Try to find contact by email if no contactId
      if (!resolvedContactId) {
        const contact = await knex('customer_entities').where('primary_email', to).where('organization_id', auth.orgId).whereNull('deleted_at').first()
        if (contact) { resolvedContactId = contact.id; displayName = contact.display_name; avatarPhone = contact.primary_phone }
      } else {
        const contact = await knex('customer_entities').where('id', contactId).first()
        if (contact) { displayName = contact.display_name; avatarEmail = contact.primary_email; avatarPhone = contact.primary_phone }
      }
      upsertInboxConversation(knex, auth.orgId, auth.tenantId, {
        contactId: resolvedContactId,
        channel: 'email',
        preview: subject || bodyText || '',
        direction: 'outbound',
        displayName,
        avatarEmail,
        avatarPhone,
      }).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      data: {
        id,
        status,
        sentVia: routerResult.sentVia || (messageMetadata as any).provider,
        ...(primaryProviderError ? { primaryProviderError, fallback: true } : {}),
      },
    })
  } catch (error) {
    console.error('[email.messages.send]', error)
    return NextResponse.json({ ok: false, error: 'Failed to send email' }, { status: 500 })
  }
}
