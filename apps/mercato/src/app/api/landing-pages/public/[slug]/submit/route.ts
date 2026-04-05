import { NextResponse } from 'next/server'
import { query, queryOne } from '@/app/api/funnels/db'
import crypto from 'crypto'

async function triggerAutomation(orgId: string, tenantId: string, contactId: string, formId: string, slug: string) {
  try {
    // Find matching automation rules using raw SQL
    const rules = await query(
      'SELECT * FROM automation_rules WHERE organization_id = $1 AND trigger_type = $2 AND is_active = true',
      [orgId, 'form_submitted']
    )
    for (const rule of rules) {
      const triggerConfig = typeof rule.trigger_config === 'string' ? JSON.parse(rule.trigger_config) : (rule.trigger_config || {})
      // Check if trigger targets a specific form
      if (triggerConfig.formId && triggerConfig.formId !== formId) continue

      // Log the execution
      await query(
        'INSERT INTO automation_rule_logs (id, rule_id, contact_id, trigger_data, action_result, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [crypto.randomUUID(), rule.id, contactId, JSON.stringify({ triggerType: 'form_submitted', contactId, formId, landingPageSlug: slug }), JSON.stringify({ queued: true }), 'executed', new Date()]
      ).catch(() => {})
    }
  } catch (err) {
    console.error('[landing-pages.submit] automation error:', err)
  }
}

async function addToEmailLists(orgId: string, contactId: string, formId: string) {
  try {
    const autoLists = await query(
      "SELECT * FROM email_lists WHERE organization_id = $1 AND source_type = 'form_submitted'",
      [orgId]
    )
    for (const list of autoLists) {
      const desc = list.description || ''
      const triggerMatch = desc.match(/\[auto_trigger:(.+?)\]/)
      if (triggerMatch) {
        try {
          const targetIds = JSON.parse(triggerMatch[1])
          if (Array.isArray(targetIds) && targetIds.length > 0 && !targetIds.includes(formId)) continue
        } catch {}
      }
      await query(
        'INSERT INTO email_list_members (id, list_id, contact_id, added_at) VALUES ($1, $2, $3, $4) ON CONFLICT (list_id, contact_id) DO NOTHING',
        [crypto.randomUUID(), list.id, contactId, new Date()]
      )
      const countResult = await queryOne('SELECT count(*)::int as count FROM email_list_members WHERE list_id = $1', [list.id])
      if (countResult) {
        await query('UPDATE email_lists SET member_count = $1, updated_at = $2 WHERE id = $3', [countResult.count, new Date(), list.id]).catch(() => {})
      }
    }
  } catch (err) {
    console.error('[landing-pages.submit] email list error:', err)
  }
}

async function sendConfirmationEmail(orgId: string, tenantId: string, toEmail: string, name: string, pageTitle: string, pageType?: string) {
  try {
    const typeMessages: Record<string, { subject: string; body: string }> = {
      'promote-event': {
        subject: `You're registered: ${pageTitle}`,
        body: `Thanks for registering, ${name}! We've saved your spot. You'll receive event details and reminders as the date approaches.`,
      },
      'sell-service': {
        subject: `We received your inquiry — ${pageTitle}`,
        body: `Thanks for reaching out, ${name}! We've received your information and will get back to you shortly.`,
      },
      'general': {
        subject: `Thanks for your interest — ${pageTitle}`,
        body: `Hi ${name}, thanks for getting in touch! We've received your submission and will follow up soon.`,
      },
    }

    const msg = typeMessages[pageType || ''] || typeMessages.general!
    const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <h2 style="font-size:22px;margin:0 0 12px">${msg.subject}</h2>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 24px">${msg.body}</p>
    </div>`

    const esp = await queryOne(
      "SELECT provider, api_key, default_sender_email, default_sender_name FROM esp_connections WHERE organization_id = $1 AND is_active = true LIMIT 1",
      [orgId]
    )

    if (esp?.provider === 'resend' && esp.api_key) {
      const fromEmail = esp.default_sender_email || 'noreply@resend.dev'
      const fromName = esp.default_sender_name || pageTitle
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${esp.api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [toEmail], subject: msg.subject, html: htmlBody }),
      })
      if (!res.ok) console.error('[confirmation-email] Resend error:', await res.text())
    }
  } catch (err) {
    console.error('[confirmation-email] error:', err)
  }
}

async function sendLeadMagnetEmail(orgId: string, tenantId: string, contactId: string, toEmail: string, downloadUrl: string, pageTitle: string, customSubject?: string, customBody?: string) {
  try {
    // Validate URL before sending
    let url = downloadUrl
    if (!/^https?:\/\//i.test(url)) {
      if (url.includes('.')) url = 'https://' + url
      else return // Invalid URL, skip email
    }

    const subject = customSubject?.trim() || `Your download is ready: ${pageTitle}`
    const bodyText = customBody?.trim() || 'Thanks for signing up! Click below to get your resource.'
    const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <h2 style="font-size:22px;margin:0 0 12px">${subject}</h2>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 24px">${bodyText.replace(/\n/g, '<br/>')}</p>
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Download Now</a>
      <p style="color:#888;font-size:13px;margin-top:24px">If the button doesn't work, copy this link:<br/><a href="${url}" style="color:#2563eb">${url}</a></p>
    </div>`

    // Send via ESP (Resend/SendGrid)
    const esp = await queryOne(
      "SELECT provider, api_key, default_sender_email, default_sender_name FROM esp_connections WHERE organization_id = $1 AND is_active = true LIMIT 1",
      [orgId]
    )

    if (esp?.provider === 'resend' && esp.api_key) {
      const fromEmail = esp.default_sender_email || 'noreply@resend.dev'
      const fromName = esp.default_sender_name || pageTitle
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${esp.api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [toEmail],
          subject,
          html: htmlBody,
        }),
      })
      if (!res.ok) console.error('[lead-magnet-email] Resend error:', await res.text())
    } else if (esp?.provider === 'sendgrid' && esp.api_key) {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${esp.api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: esp.default_sender_email || 'noreply@example.com', name: esp.default_sender_name || pageTitle },
          subject,
          content: [{ type: 'text/html', value: htmlBody }],
        }),
      })
      if (!res.ok) console.error('[lead-magnet-email] SendGrid error:', await res.text())
    } else {
      console.warn('[lead-magnet-email] No email provider configured for org', orgId)
    }
  } catch (err) {
    console.error('[landing-pages.submit] lead magnet email error:', err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const url = new URL(req.url)

    const page = await queryOne('SELECT * FROM landing_pages WHERE slug = $1 AND status = $2 AND deleted_at IS NULL', [slug, 'published'])
    if (!page) return NextResponse.json({ ok: false, error: 'Page not found' }, { status: 404 })

    const body = await req.json()
    const data = body.data || body

    const form = await queryOne('SELECT * FROM landing_page_forms WHERE landing_page_id = $1', [page.id])
    if (!form) return NextResponse.json({ ok: false, error: 'No form configured' }, { status: 400 })

    // Also look up the linked CRM form (for Forms page visibility)
    const config = typeof page.config === 'string' ? JSON.parse(page.config) : (page.config || {})
    const linkedFormId = config?.linkedFormId || null

    // Validate required fields (field.name for legacy forms, field.id for v2 wizard forms)
    const fields = typeof form.fields === 'string' ? JSON.parse(form.fields) : form.fields
    for (const field of (fields || [])) {
      const fieldKey = field.id || field.name
      if (field.required && fieldKey && !data[fieldKey]) {
        return NextResponse.json({ ok: false, error: `${field.label || fieldKey} is required`, field: fieldKey }, { status: 400 })
      }
    }

    // UTM tracking
    const utmSource = data._utm_source || url.searchParams.get('utm_source') || null
    const utmMedium = data._utm_medium || url.searchParams.get('utm_medium') || null
    const utmCampaign = data._utm_campaign || url.searchParams.get('utm_campaign') || null
    const capturedReferrer = data._referrer || req.headers.get('referer') || null
    const sourceDetails: Record<string, string> = {}
    if (utmSource) sourceDetails.utm_source = utmSource
    if (utmMedium) sourceDetails.utm_medium = utmMedium
    if (utmCampaign) sourceDetails.utm_campaign = utmCampaign
    if (capturedReferrer) sourceDetails.referrer = capturedReferrer
    sourceDetails.landing_page = page.title || page.slug

    // Record submission (use linked CRM form ID if available, so it shows in the Forms page)
    const submissionId = crypto.randomUUID()
    const submissionFormId = linkedFormId || form.id
    await query(
      'INSERT INTO form_submissions (id, tenant_id, organization_id, form_id, landing_page_id, data, source_ip, user_agent, referrer, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [submissionId, page.tenant_id, page.organization_id, submissionFormId, page.id, JSON.stringify(data), req.headers.get('x-forwarded-for') || 'unknown', req.headers.get('user-agent') || '', capturedReferrer, new Date()]
    )
    await query('UPDATE landing_pages SET submission_count = submission_count + 1 WHERE id = $1', [page.id]).catch(() => {})
    if (linkedFormId) {
      await query('UPDATE forms SET submission_count = COALESCE(submission_count, 0) + 1 WHERE id = $1', [linkedFormId]).catch(() => {})
    }

    // Create or find contact
    const email = data.email || data.Email
    const contactName = data.name || data.Name || data.full_name || (email ? email.split('@')[0] : 'Unknown')
    let contactId: string | null = null

    if (email) {
      const existing = await queryOne('SELECT id FROM customer_entities WHERE primary_email = $1 AND organization_id = $2 AND deleted_at IS NULL', [email.toLowerCase(), page.organization_id])
      if (existing) {
        contactId = existing.id
      } else {
        contactId = crypto.randomUUID()
        const source = utmSource ? `landing_page:${utmSource}` : 'landing_page'
        await query(
          'INSERT INTO customer_entities (id, tenant_id, organization_id, kind, display_name, primary_email, source, source_details, status, lifecycle_stage, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [contactId, page.tenant_id, page.organization_id, 'person', contactName, email.toLowerCase(), source, JSON.stringify(sourceDetails), 'active', 'prospect', true, new Date(), new Date()]
        ).catch(() => { contactId = null })

        if (contactId) {
          const parts = contactName.split(' ')
          await query(
            'INSERT INTO customer_people (id, tenant_id, organization_id, entity_id, first_name, last_name, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [crypto.randomUUID(), page.tenant_id, page.organization_id, contactId, parts[0] || '', parts.slice(1).join(' ') || '', new Date(), new Date()]
          ).catch(() => {})
        }
      }

      if (contactId) {
        await query('UPDATE form_submissions SET contact_id = $1 WHERE id = $2', [contactId, submissionId]).catch(() => {})

        // Fire-and-forget: automation rules, email list auto-add, lead magnet delivery
        triggerAutomation(page.organization_id, page.tenant_id, contactId!, form.id, page.slug)
        addToEmailLists(page.organization_id, contactId!, form.id)

        // Send confirmation email
        const downloadUrl = config?.leadMagnet?.downloadUrl
        if (downloadUrl) {
          // Lead magnet: send download link email
          sendLeadMagnetEmail(page.organization_id, page.tenant_id, contactId!, email, downloadUrl, page.title || 'Download', config.leadMagnet?.emailSubject, config.leadMagnet?.emailBody)
        } else {
          // All other pages: send a general confirmation email
          sendConfirmationEmail(page.organization_id, page.tenant_id, email, contactName, page.title || 'Landing Page', config?.pageType)
        }
      }
    }

    // Check for funnel context
    const funnelSid = data.funnel_sid || data._funnel_sid
    const funnelStep = data.funnel_step || data._funnel_step
    const funnelSlug = data.funnel_slug || data._funnel_slug

    if (funnelSid && funnelSlug) {
      try {
        const funnelSession = await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [funnelSid])
        if (funnelSession) {
          if (email) await query('UPDATE funnel_sessions SET email = $1, updated_at = $2 WHERE id = $3', [email.trim(), new Date(), funnelSid]).catch(() => {})
          if (contactId) await query('UPDATE funnel_sessions SET contact_id = $1 WHERE id = $2', [contactId, funnelSid]).catch(() => {})

          const currentFunnelStep = funnelStep
            ? await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [funnelStep])
            : await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [funnelSession.current_step_id])

          if (currentFunnelStep) {
            // Add product to cart if this step has one
            if (currentFunnelStep.product_id) {
              try {
                const stepProduct = await queryOne('SELECT * FROM products WHERE id = $1', [currentFunnelStep.product_id])
                if (stepProduct) {
                  const cartItems = (typeof funnelSession.cart_items === 'string' ? JSON.parse(funnelSession.cart_items) : funnelSession.cart_items) || []
                  const alreadyInCart = cartItems.some((item: any) => item.productId === stepProduct.id && item.stepId === currentFunnelStep.id)
                  if (!alreadyInCart) {
                    cartItems.push({
                      productId: stepProduct.id,
                      name: stepProduct.name,
                      price: Number(stepProduct.price),
                      currency: (stepProduct.currency || 'USD').toUpperCase(),
                      stepId: currentFunnelStep.id,
                      type: 'main',
                    })
                    await query('UPDATE funnel_sessions SET cart_items = $1 WHERE id = $2', [JSON.stringify(cartItems), funnelSid]).catch(() => {})
                  }
                }
              } catch {}
            }

            const nextFunnelStep = await queryOne(
              'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
              [funnelSession.funnel_id, currentFunnelStep.step_order]
            )
            const baseUrl = process.env.APP_URL || 'http://localhost:3000'
            if (nextFunnelStep) {
              await query('UPDATE funnel_sessions SET current_step_id = $1 WHERE id = $2', [nextFunnelStep.id, funnelSid]).catch(() => {})
              return NextResponse.json({
                ok: true, message: form.success_message || 'Thank you!',
                redirectUrl: `${baseUrl}/api/funnels/public/${funnelSlug}?step=${nextFunnelStep.id}&sid=${funnelSid}`,
              })
            }
          }
        }
      } catch {}
    }

    // If a lead magnet email was sent, show a check-your-email message instead of redirecting
    const hasLeadMagnet = config?.leadMagnet?.downloadUrl
    const message = hasLeadMagnet
      ? "Thank you! Check your email for the download link. If you don't see it, check your spam folder."
      : (form.success_message || "Thank you! We'll be in touch.")

    return NextResponse.json({
      ok: true,
      message,
    })
  } catch (error) {
    console.error('[landing-pages.submit]', error)
    return NextResponse.json({ ok: false, error: 'Failed to submit form' }, { status: 500 })
  }
}
