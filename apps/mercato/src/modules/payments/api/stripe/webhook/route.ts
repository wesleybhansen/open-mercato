
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sendEmailByPurpose } from '@/modules/email/lib/email-router'
import {
  isStripeAccountId,
  isStripeCheckoutSessionId,
  isStripePaymentIntentId,
  isStripeSubscriptionId,
  resolveStripeWebhookScope,
} from '@/modules/payments/lib/stripe-integrity'

export const metadata = { POST: { requireAuth: false } }

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeKey || !webhookSecret) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  try {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 10_000 })
    const body = await req.text()
    const sig = req.headers.get('stripe-signature') || ''
    const event: any = stripe.webhooks.constructEvent(body, sig, webhookSecret)

    if (event.type !== 'checkout.session.completed') {
      return NextResponse.json({ received: true })
    }
    const session = event.data?.object
    const meta = session?.metadata
    if (
      !session
      || !isStripeCheckoutSessionId(session.id)
      || !isStripeAccountId(event.account)
      || !meta
      || typeof meta !== 'object'
      || Array.isArray(meta)
      || !Number.isSafeInteger(session.amount_total)
      || session.amount_total < 0
      || typeof session.currency !== 'string'
      || !/^[a-z]{3}$/.test(session.currency)
      || (session.payment_intent !== null && !isStripePaymentIntentId(session.payment_intent))
      || (session.subscription !== null && !isStripeSubscriptionId(session.subscription))
    ) {
      return NextResponse.json({ error: 'Webhook payload refused' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()

    const connections = await knex('stripe_connections')
      .where('stripe_account_id', event.account)
      .where('is_active', true)
      .limit(2)
    if (connections.length !== 1) return NextResponse.json({ error: 'Webhook scope refused' }, { status: 409 })
    const webhookScope = resolveStripeWebhookScope({
      eventAccount: event.account,
      metadata: meta,
      connection: connections[0],
    })
    if (!webhookScope) return NextResponse.json({ error: 'Webhook scope refused' }, { status: 409 })
    const orgId = webhookScope.organizationId
    const tenantId = webhookScope.tenantId
    const connectedAccountId = webhookScope.stripeAccountId
    if (session.payment_status !== 'paid') return NextResponse.json({ received: true })

    if (event.type === 'checkout.session.completed') {
      // Resolve customer email — Stripe puts it in different places
      const customerEmail = session.customer_email || session.customer_details?.email || null

      let invoiceId: string | null = null
      if (meta.invoiceId !== undefined) {
        if (typeof meta.invoiceId !== 'string' || meta.invoiceId.length === 0 || meta.invoiceId.length > 255) {
          return NextResponse.json({ error: 'Webhook resource refused' }, { status: 409 })
        }
        const invoice = await knex('invoices')
          .where('id', meta.invoiceId)
          .where('organization_id', orgId)
          .where('tenant_id', tenantId)
          .whereNull('deleted_at')
          .first()
        if (!invoice) return NextResponse.json({ error: 'Webhook resource refused' }, { status: 409 })
        invoiceId = invoice.id
      }

      // Idempotency: if we already recorded this checkout session, this is a
      // replay/redelivery — skip the whole handler (avoids double payments,
      // double affiliate commission, duplicate enrollments).
      const alreadyProcessed = await knex('payment_records')
        .where('stripe_checkout_session_id', session.id)
        .where('organization_id', orgId)
        .where('tenant_id', tenantId)
        .first()
      if (alreadyProcessed) {
        return NextResponse.json({ received: true, duplicate: true })
      }

      // Record the payment
      const paymentRecordId = randomUUID()
      const inserted = await knex('payment_records').insert({
        id: paymentRecordId,
        tenant_id: tenantId,
        organization_id: orgId,
        invoice_id: invoiceId,
        amount: session.amount_total / 100,
        currency: session.currency,
        status: session.payment_status === 'paid' ? 'succeeded' : 'pending',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent,
        stripe_subscription_id: session.subscription || null,
        metadata: JSON.stringify({
          customerEmail,
          customerName: session.customer_details?.name || null,
          customerPhone: session.customer_details?.phone || null,
          shippingName: session.shipping_details?.name || null,
          shippingAddress: session.shipping_details?.address || null,
          shippingPhone: session.customer_details?.phone || null,
          type: meta.type,
          connectedAccount: connectedAccountId,
        }),
        created_at: new Date(),
      }).onConflict().ignore().returning('id')
      if (inserted.length !== 1) return NextResponse.json({ received: true, duplicate: true })

      // Update invoice status if applicable
      if (invoiceId) {
        const updated = await knex('invoices')
          .where('id', invoiceId)
          .where('organization_id', orgId)
          .where('tenant_id', tenantId)
          .whereNull('deleted_at')
          .update({
          status: 'paid',
          paid_at: new Date(),
          updated_at: new Date(),
          })
        if (updated !== 1) throw new Error('invoice_update_refused')
      }

      // Auto-create contact from customer email and link to payment record
      let resolvedContactId: string | null = null
      if (customerEmail && orgId) {
        let contactEntity = await knex('customer_entities')
          .where('primary_email', customerEmail)
          .where('organization_id', orgId)
          .where('tenant_id', tenantId)
          .whereNull('deleted_at').first()

        if (!contactEntity) {
          const newId = randomUUID()
          const stripeName = session.customer_details?.name || customerEmail
          await knex('customer_entities').insert({
            id: newId,
            tenant_id: tenantId,
            organization_id: orgId,
            kind: 'person',
            display_name: stripeName,
            primary_email: customerEmail,
            source: 'stripe',
            status: 'active',
            lifecycle_stage: 'customer',
            created_at: new Date(),
            updated_at: new Date(),
          }).catch(() => {})
          const stripeNameParts = stripeName.split(' ')
          await knex('customer_people').insert({
            id: randomUUID(), tenant_id: tenantId, organization_id: orgId,
            entity_id: newId, first_name: stripeNameParts[0] || '', last_name: stripeNameParts.slice(1).join(' ') || '',
            created_at: new Date(), updated_at: new Date(),
          }).catch(() => {})
          contactEntity = { id: newId }
        }

        // Link the payment record to the contact
        if (contactEntity?.id) {
          resolvedContactId = contactEntity.id
          await knex('payment_records')
            .where('stripe_checkout_session_id', session.id)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .whereNull('contact_id')
            .update({ contact_id: contactEntity.id })
            .catch(() => {})

          // Log payment to timeline
          const { logTimelineEvent } = await import('@/lib/timeline')
          await logTimelineEvent(knex, {
            tenantId, organizationId: orgId, contactId: contactEntity.id,
            eventType: 'payment', title: `Payment received`,
            description: `$${((session.amount_total || 0) / 100).toFixed(2)} ${session.currency?.toUpperCase() || 'USD'}`,
            metadata: { amount: (session.amount_total || 0) / 100, currency: session.currency, type: meta.type },
          })

          // Auto-add to email lists with source_type 'product_purchased'
          try {
            const autoLists = await knex('email_lists')
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .where('source_type', 'product_purchased')
            for (const list of autoLists) {
              const desc = list.description || ''
              const triggerMatch = desc.match(/\[auto_trigger:(.+?)\]/)
              if (triggerMatch) {
                try {
                  const targetIds = JSON.parse(triggerMatch[1])
                  if (Array.isArray(targetIds) && targetIds.length > 0 && !targetIds.includes(meta.productId)) continue
                } catch {}
              }
              await knex.raw('INSERT INTO email_list_members (id, tenant_id, organization_id, list_id, contact_id, added_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (list_id, contact_id) DO NOTHING',
                [randomUUID(), tenantId, orgId, list.id, contactEntity.id, new Date(), new Date(), new Date()])
              const [{ count }] = await knex('email_list_members')
                .where('list_id', list.id)
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .count()
              await knex('email_lists')
                .where('id', list.id)
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .update({ member_count: Number(count), updated_at: new Date() })
            }
          } catch {}
        }
      }

      // SPEC-064 money wire: emit the payment-captured event from the LIVE
      // Stripe path. The pipeline-automation trigger ("Payment received" →
      // e.g. move deal to Won) and the payment notification both subscribe to
      // this event but historically only the idle legacy payment_gateways
      // module emitted it — so real payments never fired them. Payload is
      // payload-first (amount/contactId inline) with the legacy transactionId
      // key kept for consumer compatibility. Non-fatal: a bus failure must
      // never make Stripe retry a recorded payment.
      try {
        const bus = container.resolve('eventBus') as { emitEvent?: (name: string, payload: unknown) => Promise<void> }
        if (bus?.emitEvent) {
          await bus.emitEvent('payment_gateways.payment.captured', {
            transactionId: paymentRecordId,
            paymentRecordId,
            providerKey: 'stripe',
            invoiceId: meta.invoiceId || null,
            contactId: resolvedContactId,
            amount: (session.amount_total || 0) / 100,
            currency: session.currency || 'usd',
            organizationId: orgId,
            tenantId,
          })
        }
      } catch {
        console.error('[stripe.webhook] payment_event_projection_failed')
      }

      // Auto-send payment receipt email
      if (session.customer_email && meta.invoiceId) {
        try {
          const invoice = await knex('invoices')
            .where('id', meta.invoiceId)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .whereNull('deleted_at')
            .first()
          if (invoice) {
            const amount = ((session.amount_total || 0) / 100).toFixed(2)
            const currency = (session.currency || 'USD').toUpperCase()
            const receiptHtml = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">
              <div style="text-align:center;margin-bottom:24px">
                <div style="display:inline-block;background:#10B981;color:white;padding:8px 16px;border-radius:9999px;font-size:14px;font-weight:600">Payment Received</div>
              </div>
              <h2 style="margin-bottom:4px">Receipt for ${invoice.invoice_number}</h2>
              <p style="color:#666;margin-bottom:24px">We received your payment of <strong>$${amount} ${currency}</strong> on ${new Date().toLocaleDateString()}.</p>
              <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px">
                <p style="margin:0;font-size:14px"><strong>Invoice:</strong> ${invoice.invoice_number}</p>
                <p style="margin:8px 0 0;font-size:14px"><strong>Amount Paid:</strong> $${amount} ${currency}</p>
                <p style="margin:8px 0 0;font-size:14px"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                <p style="margin:8px 0 0;font-size:14px"><strong>Status:</strong> Paid</p>
              </div>
              <p style="color:#888;font-size:13px">Thank you for your payment. Please keep this email as your receipt.</p>
            </body></html>`

            // Send receipt email via email router
            try {
              const emailResult = await sendEmailByPurpose(knex, orgId!, tenantId!, 'invoices', {
                to: session.customer_email,
                subject: `Payment Receipt — ${invoice.invoice_number} ($${amount})`,
                htmlBody: receiptHtml,
                contactId: invoice.contact_id || undefined,
              })
              if (!emailResult.ok) {
                console.warn('[stripe.webhook] receipt_delivery_failed')
              }
            } catch {
              console.warn('[stripe.webhook] receipt_delivery_failed')
            }
          }
        } catch {
          console.warn('[stripe.webhook] receipt_projection_failed')
        }
      }

      // ── Affiliate attribution ──
      // Check session metadata for affiliate_id, or check if a promo code was used
      const affiliateId = meta.affiliate_id || null
      let attributedAffiliateId: string | null = affiliateId

      // If no explicit affiliate_id in metadata, check if a promotion code was used
      if (!attributedAffiliateId && session.total_details?.breakdown?.discounts?.length) {
        for (const disc of session.total_details.breakdown.discounts) {
          const promoCodeId = disc.discount?.promotion_code
          if (promoCodeId) {
            // Look up the promo code in our affiliates table
            const affByPromo = await knex('affiliates')
              .where('stripe_promo_code_id', promoCodeId)
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .where('status', 'active')
              .first()
            if (affByPromo) {
              attributedAffiliateId = affByPromo.id
              break
            }
          }
        }
      }

      if (attributedAffiliateId && orgId) {
        try {
          // Idempotency: skip if this Stripe session was already attributed (a
          // replayed/redelivered event) so commission isn't double-credited.
          const existingReferral = await knex('affiliate_referrals')
            .where('stripe_session_id', session.id)
            .first()
          const affiliate = existingReferral
            ? null
            : await knex('affiliates')
              .where('id', attributedAffiliateId)
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .first()
          if (affiliate) {
            const saleAmount = (session.amount_total || 0) / 100
            // Tier-aware commission: if the affiliate's campaign defines tiers,
            // the highest tier whose minConversions <= total_conversions BEFORE
            // this conversion wins; otherwise the affiliate's own rate applies.
            const { computeCommission } = await import('@/modules/customers/api/affiliates/commission')
            const affCampaign = affiliate.campaign_id
              ? await knex('affiliate_campaigns')
                .where('id', affiliate.campaign_id)
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .first()
                .catch(() => null)
              : null
            const commission = computeCommission(saleAmount, affiliate, affCampaign).amount

            // Create referral record
            await knex('affiliate_referrals').insert({
              id: randomUUID(),
              tenant_id: tenantId,
              organization_id: orgId,
              affiliate_id: attributedAffiliateId,
              referred_contact_id: null,
              referred_email: customerEmail,
              referral_source: affiliateId ? 'link' : 'promo_code',
              converted: true,
              conversion_value: saleAmount,
              commission_amount: commission,
              campaign_id: affiliate.campaign_id || null,
              stripe_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent || null,
              referred_at: new Date(),
              converted_at: new Date(),
            }).catch(() => console.error('[stripe.webhook] affiliate_referral_insert_failed'))

            // Update affiliate stats
            await knex('affiliates')
              .where('id', attributedAffiliateId)
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .update({
              total_conversions: knex.raw('total_conversions + 1'),
              total_earned: knex.raw('total_earned + ?', [commission]),
              updated_at: new Date(),
            }).catch(() => console.error('[stripe.webhook] affiliate_stats_update_failed'))

            console.info('[stripe.webhook] affiliate_attribution_completed')
          }
        } catch (affErr) {
          console.error('[stripe.webhook] affiliate_attribution_failed')
        }
      }
      // Clawback note: an event-driven path would handle `charge.refunded` here
      // by resolving charge.payment_intent -> affiliate_referrals.stripe_payment_intent_id
      // and un-converting the matched referral. This endpoint currently only
      // receives checkout.session.completed, and refund events are not routed
      // to it, so clawbacks are handled manually via the per-referral "Reverse"
      // action (PATCH /api/affiliates/[id] with { referralId, action: 'reverse' }).

      // ── Course enrollment on payment ──
      if (meta.type === 'course' && meta.courseId && meta.studentEmail) {
        try {
          const courseId = meta.courseId
          const studentName = meta.studentName || meta.studentEmail
          const studentEmail = meta.studentEmail.toLowerCase()
          const course = await knex('courses')
            .where('id', courseId)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .whereNull('deleted_at')
            .first()
          if (!course) throw new Error('course_scope_refused')

          // Check not already enrolled
          const existingEnrollment = await knex('course_enrollments')
            .where('course_id', courseId)
            .where('student_email', studentEmail)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .where('status', 'active')
            .first()

          if (!existingEnrollment) {
            const enrollmentId = randomUUID()
            await knex('course_enrollments').insert({
              id: enrollmentId,
              tenant_id: tenantId,
              organization_id: orgId,
              course_id: courseId,
              student_name: studentName,
              student_email: studentEmail,
              contact_id: null,
              payment_id: session.payment_intent || null,
              status: 'active',
              enrolled_at: new Date(),
            })

            // Create/link CRM contact with Student tag
            let contactId: string | null = null
            const existingContact = await knex('customer_entities')
              .where('primary_email', studentEmail)
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .whereNull('deleted_at')
              .first()

            if (existingContact) {
              contactId = existingContact.id
            } else {
              contactId = randomUUID()
              const nameParts = studentName.split(' ')
              await knex('customer_entities').insert({
                id: contactId,
                tenant_id: tenantId,
                organization_id: orgId,
                kind: 'person',
                display_name: studentName,
                primary_email: studentEmail,
                source: 'course',
                status: 'active',
                lifecycle_stage: 'customer',
                created_at: new Date(),
                updated_at: new Date(),
              }).catch(() => { contactId = null })

              if (contactId) {
                await knex('customer_people').insert({
                  id: randomUUID(),
                  tenant_id: tenantId,
                  organization_id: orgId,
                  entity_id: contactId,
                  first_name: nameParts[0] || '',
                  last_name: nameParts.slice(1).join(' ') || '',
                  created_at: new Date(),
                  updated_at: new Date(),
                }).catch(() => {})
              }
            }

            if (contactId) {
              await knex('course_enrollments')
                .where('id', enrollmentId)
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .update({ contact_id: contactId })
                .catch(() => {})

              // Add Student tag
              try {
                let tag = await knex('customer_tags')
                  .where('label', 'Student')
                  .where('organization_id', orgId)
                  .where('tenant_id', tenantId)
                  .first()
                if (!tag) {
                  const tagId = randomUUID()
                  await knex('customer_tags').insert({ id: tagId, tenant_id: tenantId, organization_id: orgId, label: 'Student', slug: 'student', created_at: new Date(), updated_at: new Date() })
                  tag = { id: tagId }
                }
                const tagLink = await knex('customer_entity_tags').where('entity_id', contactId).where('tag_id', tag.id).first()
                if (!tagLink) await knex('customer_entity_tags').insert({ id: randomUUID(), entity_id: contactId, tag_id: tag.id, created_at: new Date() })
              } catch { /* non-critical */ }
            }

            console.info('[stripe.webhook] course_enrollment_completed')
          }
        } catch (courseErr) {
          console.error('[stripe.webhook] course_enrollment_failed')
        }
      }

      // ── Event registration on payment ──
      if (meta.type === 'event' && meta.eventId && meta.attendeeEmail) {
        try {
          const eventId = meta.eventId
          const attendeeName = meta.attendeeName || meta.attendeeEmail
          const attendeeEmail = meta.attendeeEmail.toLowerCase()
          const ticketQty = parseInt(meta.ticketQuantity) || 1
          const eventResource = await knex('events')
            .where('id', eventId)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .first()
          if (!eventResource) throw new Error('event_scope_refused')

          const existingAtt = await knex('event_attendees')
            .where('event_id', eventId)
            .where('attendee_email', attendeeEmail)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .where('status', 'registered')
            .first()
          if (!existingAtt) {
            const attendeeId = randomUUID()
            await knex('event_attendees').insert({
              id: attendeeId, tenant_id: tenantId, organization_id: orgId,
              event_id: eventId, attendee_name: attendeeName, attendee_email: attendeeEmail,
              status: 'registered', ticket_quantity: ticketQty,
              guest_details: meta.guestDetails || null,
              registration_data: meta.registrationData || '{}',
              accepted_terms: meta.acceptedTerms === 'true',
              payment_id: session.payment_intent?.toString() || session.id,
              registered_at: new Date(), created_at: new Date(),
            })
            await knex('events')
              .where('id', eventId)
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .increment('attendee_count', ticketQty)

            // Create CRM contact
            let contactId: string | null = null
            const existingContact = await knex('customer_entities')
              .where('primary_email', attendeeEmail)
              .where('organization_id', orgId)
              .where('tenant_id', tenantId)
              .whereNull('deleted_at')
              .first()
            if (existingContact) { contactId = existingContact.id }
            else {
              contactId = randomUUID()
              await knex('customer_entities').insert({
                id: contactId, tenant_id: tenantId, organization_id: orgId,
                kind: 'person', display_name: attendeeName, primary_email: attendeeEmail,
                source: 'event', status: 'active', lifecycle_stage: 'customer', is_active: true,
                created_at: new Date(), updated_at: new Date(),
              }).catch(() => { contactId = null })
              if (contactId) {
                const parts = attendeeName.split(' ')
                await knex('customer_people').insert({
                  id: randomUUID(), tenant_id: tenantId, organization_id: orgId,
                  entity_id: contactId, first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '',
                  created_at: new Date(), updated_at: new Date(),
                }).catch(() => {})
              }
            }
            // Look up the event BEFORE its first use below (event?.title) — it was
            // declared later, a TDZ ReferenceError masked by ignoreBuildErrors.
            const event = eventResource
            if (contactId) {
              await knex('event_attendees')
                .where('id', attendeeId)
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .update({ contact_id: contactId })
                .catch(() => {})
              await knex('contact_notes').insert({
                id: randomUUID(), tenant_id: tenantId, organization_id: orgId,
                contact_id: contactId, content: `Registered for event: ${event?.title || 'Unknown'} (paid)`,
                created_at: new Date(), updated_at: new Date(),
              }).catch(() => {})
            }

            // Send confirmation email
            if (event) {
              const eventDate = new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
              const eventTime = new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              const location = event.event_type === 'virtual' ? (event.virtual_link || 'Virtual') : (event.location_name || 'TBD')
              const emailHtml = `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:32px"><h2 style="font-size:20px;margin:0 0 8px">You're in, ${attendeeName.split(' ')[0]}!</h2><p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:20px">Your payment is confirmed. You're registered for <strong>${event.title}</strong>.</p><div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px"><p style="margin:0 0 6px;font-size:14px"><strong>Date:</strong> ${eventDate}</p><p style="margin:0 0 6px;font-size:14px"><strong>Time:</strong> ${eventTime}</p><p style="margin:0;font-size:14px"><strong>Location:</strong> ${location}</p></div><p style="color:#94a3b8;font-size:12px">See you there!</p></div>`
              await knex('email_messages').insert({
                id: randomUUID(), tenant_id: tenantId, organization_id: orgId,
                direction: 'outbound', from_address: process.env.EMAIL_FROM || 'noreply@localhost',
                to_address: attendeeEmail, subject: `You're registered: ${event.title}`, body_html: emailHtml,
                contact_id: contactId, status: 'queued', tracking_id: randomUUID(), created_at: new Date(),
              }).catch(() => {})
            }
            console.info('[stripe.webhook] event_registration_completed')
          }
        } catch {
          console.error('[stripe.webhook] event_registration_failed')
        }
      }

      // ── Funnel checkout completion ──
      if (meta.type === 'funnel' && meta.sessionId) {
        try {
          const funnelSession = await knex('funnel_sessions as fs')
            .join('funnels as f', 'f.id', 'fs.funnel_id')
            .where('fs.id', meta.sessionId)
            .where('fs.organization_id', orgId)
            .where('f.organization_id', orgId)
            .where('f.tenant_id', tenantId)
            .select('fs.*')
            .first()
          if (funnelSession) {
            // Get payment intent to extract saved payment method
            let stripeCustomerId = session.customer?.toString() || null
            let paymentMethodId = null
            if (session.payment_intent) {
              try {
                const stripeKey = process.env.STRIPE_SECRET_KEY
                if (stripeKey) {
                  const Stripe = (await import('stripe')).default
                  const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any })
                  const pi = connectedAccountId
                    ? await stripe.paymentIntents.retrieve(session.payment_intent.toString(), { stripeAccount: connectedAccountId })
                    : await stripe.paymentIntents.retrieve(session.payment_intent.toString())
                  paymentMethodId = pi.payment_method?.toString() || null
                  if (!stripeCustomerId) stripeCustomerId = pi.customer?.toString() || null
                }
              } catch {}
            }

            // Update funnel session with Stripe info for one-click upsells
            const sessionUpdates: Record<string, any> = { updated_at: new Date() }
            if (stripeCustomerId) sessionUpdates.stripe_customer_id = stripeCustomerId
            if (paymentMethodId) sessionUpdates.stripe_payment_method_id = paymentMethodId
            if (meta.customerEmail) sessionUpdates.email = meta.customerEmail
            const checkoutAmount = (session.amount_total || 0) / 100
            sessionUpdates.total_revenue = knex.raw('total_revenue + ?', [checkoutAmount])
            await knex('funnel_sessions')
              .where('id', meta.sessionId)
              .where('organization_id', orgId)
              .update(sessionUpdates)

            // Update funnel_orders status
            if (session.id) {
              await knex('funnel_orders')
                .where('stripe_checkout_session_id', session.id)
                .where('status', 'pending')
                .update({ status: 'succeeded' })
            }

            // Create contact if not exists. `contactId` is declared OUTSIDE the
            // funnelEmail block — it's used later (confirmation email, automation
            // rules, course enrollment), which was a runtime ReferenceError when
            // declared inside the block (masked by ignoreBuildErrors).
            let contactId: string | null = funnelSession.contact_id ?? null
            const funnelEmail = meta.customerEmail || session.customer_email
            if (funnelEmail) {
              if (!contactId) {
                const existing = await knex('customer_entities')
                  .where('primary_email', funnelEmail.toLowerCase())
                  .where('organization_id', orgId)
                  .where('tenant_id', tenantId)
                  .whereNull('deleted_at').first()
                if (existing) {
                  contactId = existing.id
                } else {
                  contactId = randomUUID()
                  const contactName = meta.customerName || funnelEmail.split('@')[0]
                  await knex('customer_entities').insert({
                    id: contactId, tenant_id: tenantId, organization_id: orgId,
                    kind: 'person', display_name: contactName, primary_email: funnelEmail.toLowerCase(),
                    source: 'funnel', status: 'active', lifecycle_stage: 'customer', is_active: true,
                    created_at: new Date(), updated_at: new Date(),
                  }).catch(() => { contactId = null })
                  if (contactId) {
                    const parts = (meta.customerName || '').split(' ')
                    await knex('customer_people').insert({
                      id: randomUUID(), tenant_id: tenantId, organization_id: orgId,
                      entity_id: contactId, first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '',
                      created_at: new Date(), updated_at: new Date(),
                    }).catch(() => {})
                  }
                }
                if (contactId) {
                  await knex('funnel_sessions')
                    .where('id', meta.sessionId)
                    .where('organization_id', orgId)
                    .update({ contact_id: contactId })
                }
              }
            }

            // Send purchase confirmation email
            const funnelContactEmail = meta.customerEmail || session.customer_email
            if (funnelContactEmail) {
              try {
                const orders = await knex('funnel_orders')
                  .where('session_id', meta.sessionId)
                  .where('status', 'succeeded')
                  .leftJoin('products', 'funnel_orders.product_id', 'products.id')
                  .select('funnel_orders.*', 'products.name as product_name')
                const total = orders.reduce((s: number, o: any) => s + Number(o.amount), 0)
                const itemRows = orders.map((o: any) => `<tr><td style="padding:8px 16px;border-bottom:1px solid #e5e7eb">${o.product_name || o.order_type}</td><td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:right">$${Number(o.amount).toFixed(2)}</td></tr>`).join('')

                await sendEmailByPurpose(knex, orgId, tenantId, 'transactional', {
                  to: funnelContactEmail,
                  subject: `Order Confirmation — $${total.toFixed(2)}`,
                  htmlBody: `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
                    <h2 style="font-size:22px;margin:0 0 16px">Thank you for your purchase!</h2>
                    <table style="width:100%;border-collapse:collapse">${itemRows}
                      <tr><td style="padding:12px 16px;font-weight:700">Total</td><td style="padding:12px 16px;font-weight:700;text-align:right">$${total.toFixed(2)}</td></tr>
                    </table>
                    <p style="color:#888;font-size:13px;margin-top:24px">If you have any questions, simply reply to this email.</p>
                  </div>`,
                  contactId: contactId || undefined,
                })
              } catch {
                console.error('[stripe.webhook] funnel_confirmation_failed')
              }
            }

            // Fire automation rules
            if (contactId) {
              try {
                const { executeAutomationRules } = await import('@/modules/sequences/lib/automation-execute')
                await executeAutomationRules(knex, orgId, tenantId, 'funnel_purchase_completed', {
                  contactId,
                  funnelId: meta.funnelId,
                  funnelSlug: meta.funnelSlug,
                  sessionId: meta.sessionId,
                  amount: checkoutAmount,
                  email: funnelContactEmail,
                })
              } catch {}
            }

            // Auto-enroll in courses linked to funnel products
            if (funnelContactEmail) {
              try {
                const funnelOrders = await knex('funnel_orders')
                  .where('session_id', meta.sessionId)
                  .where('status', 'succeeded')
                  .whereNotNull('product_id')
                for (const order of funnelOrders) {
                  const prod = await knex('products')
                    .where('id', order.product_id)
                    .where('organization_id', orgId)
                    .where('tenant_id', tenantId)
                    .whereNull('deleted_at')
                    .first()
                  if (prod?.course_ids) {
                    const courseIds = typeof prod.course_ids === 'string' ? JSON.parse(prod.course_ids) : (prod.course_ids || [])
                    for (const cid of courseIds) {
                      const course = await knex('courses')
                        .where('id', cid)
                        .where('organization_id', orgId)
                        .where('tenant_id', tenantId)
                        .where('is_published', true)
                        .whereNull('deleted_at')
                        .first()
                      if (!course) continue
                      const existingEnroll = await knex('course_enrollments')
                        .where('course_id', cid)
                        .where('student_email', funnelContactEmail.toLowerCase())
                        .where('organization_id', orgId)
                        .where('tenant_id', tenantId)
                        .where('status', 'active')
                        .first()
                      if (existingEnroll) continue
                      await knex('course_enrollments').insert({
                        id: randomUUID(),
                        tenant_id: tenantId,
                        organization_id: orgId,
                        course_id: cid,
                        student_name: meta.customerName || funnelContactEmail.split('@')[0],
                        student_email: funnelContactEmail.toLowerCase(),
                        contact_id: contactId || null,
                        status: 'active',
                        enrolled_at: new Date(),
                        created_at: new Date(),
                      }).catch(() => {})
                    }
                  }
                }
              } catch {}
            }

            console.info('[stripe.webhook] funnel_checkout_completed')
          }
        } catch {
          console.error('[stripe.webhook] funnel_checkout_failed')
        }
      }

      // ── Auto-enroll in courses linked to products ──
      if (meta.productId && orgId && customerEmail) {
        try {
          const product = await knex('products')
            .where('id', meta.productId)
            .where('organization_id', orgId)
            .where('tenant_id', tenantId)
            .whereNull('deleted_at')
            .first()
          if (product?.course_ids) {
            const courseIds = typeof product.course_ids === 'string' ? JSON.parse(product.course_ids) : (product.course_ids || [])
            for (const cid of courseIds) {
              const course = await knex('courses')
                .where('id', cid)
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .where('is_published', true)
                .whereNull('deleted_at')
                .first()
              if (!course) continue
              const existingEnroll = await knex('course_enrollments')
                .where('course_id', cid)
                .where('student_email', customerEmail.toLowerCase())
                .where('organization_id', orgId)
                .where('tenant_id', tenantId)
                .where('status', 'active')
                .first()
              if (existingEnroll) continue
              await knex('course_enrollments').insert({
                id: randomUUID(),
                tenant_id: tenantId,
                organization_id: orgId,
                course_id: cid,
                student_name: session.customer_details?.name || customerEmail,
                student_email: customerEmail.toLowerCase(),
                payment_id: session.payment_intent || null,
                status: 'active',
                enrolled_at: new Date(),
              }).catch(() => console.error('[stripe.webhook] product_course_enrollment_failed'))
              console.info('[stripe.webhook] product_course_enrollment_completed')
            }
          }
        } catch {
          console.error('[stripe.webhook] product_course_enrollment_failed')
        }
      }

      console.info('[stripe.webhook] payment_completed')
    }

    return NextResponse.json({ received: true })
  } catch {
    console.error('[stripe.webhook] request_refused')
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 })
  }
}
