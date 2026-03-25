import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()

    const page = await knex('landing_pages')
      .where('slug', params.slug)
      .where('status', 'published')
      .whereNull('deleted_at')
      .first()

    if (!page) return NextResponse.json({ ok: false, error: 'Page not found' }, { status: 404 })

    const body = await req.json()
    const data = body.data || body

    const form = await knex('landing_page_forms').where('landing_page_id', page.id).first()
    if (!form) return NextResponse.json({ ok: false, error: 'No form configured' }, { status: 400 })

    const fields = typeof form.fields === 'string' ? JSON.parse(form.fields) : form.fields
    for (const field of fields) {
      if (field.required && !data[field.name]) {
        return NextResponse.json({ ok: false, error: `${field.label} is required`, field: field.name }, { status: 400 })
      }
    }

    await knex('form_submissions').insert({
      id: require('crypto').randomUUID(),
      tenant_id: page.tenant_id,
      organization_id: page.organization_id,
      form_id: form.id,
      landing_page_id: page.id,
      data: JSON.stringify(data),
      source_ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
      referrer: req.headers.get('referer') || null,
      created_at: new Date(),
    })

    await knex('landing_pages').where('id', page.id).increment('submission_count', 1)

    // Auto-create contact if email is provided
    const email = data.email || data.Email
    const name = data.name || data.Name || data.full_name || data.fullName || email
    let contactId = null
    if (email) {
      try {
        // Check if contact already exists
        const existing = await knex('customer_entities')
          .where('primary_email', email)
          .where('organization_id', page.organization_id)
          .whereNull('deleted_at')
          .first()

        if (existing) {
          contactId = existing.id
        } else {
          contactId = require('crypto').randomUUID()
          await knex('customer_entities').insert({
            id: contactId,
            tenant_id: page.tenant_id,
            organization_id: page.organization_id,
            kind: 'person',
            display_name: name,
            primary_email: email,
            primary_phone: data.phone || data.Phone || null,
            source: 'landing_page',
            status: 'active',
            lifecycle_stage: 'prospect',
            created_at: new Date(),
            updated_at: new Date(),
          })

          // Create person profile if we have name parts
          const nameParts = (name || '').split(' ')
          if (nameParts.length > 0 && contactId) {
            await knex('customer_people').insert({
              id: require('crypto').randomUUID(),
              tenant_id: page.tenant_id,
              organization_id: page.organization_id,
              entity_id: contactId,
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' ') || '',
              created_at: new Date(),
              updated_at: new Date(),
            }).catch(() => {})  // Ignore if person profile creation fails
          }
        }

        // Link submission to contact
        if (contactId) {
          await knex('form_submissions')
            .where('form_id', form.id)
            .where('landing_page_id', page.id)
            .whereNull('contact_id')
            .orderBy('created_at', 'desc')
            .limit(1)
            .update({ contact_id: contactId })
        }

        // Log activity on the contact
        await knex('customer_activities').insert({
          id: require('crypto').randomUUID(),
          tenant_id: page.tenant_id,
          organization_id: page.organization_id,
          entity_id: contactId,
          activity_type: 'form_submission',
          subject: `Form submitted on "${page.title}"`,
          body: JSON.stringify(data),
          occurred_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        }).catch(() => {})  // Don't fail the submission if activity logging fails
      } catch (err) {
        console.error('[landing_pages.submit] contact creation failed (non-blocking)', err)
      }
    }

    return NextResponse.json({
      ok: true,
      message: form.success_message || 'Thank you! We\'ll be in touch.',
      redirectUrl: form.redirect_url || null,
    })
  } catch (error) {
    console.error('[landing_pages.public.submit] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to submit form' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Landing Pages (Public)',
  summary: 'Form submission',
  methods: { POST: { summary: 'Submit landing page form', tags: ['Landing Pages (Public)'] } },
}
