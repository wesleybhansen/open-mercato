import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export async function GET(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const url = new URL(req.url)
    const view = url.searchParams.get('view') // 'hottest' | 'coldest' | 'contact'
    const contactId = url.searchParams.get('contactId')

    if (view === 'hottest') {
      const hottest = await knex('contact_engagement_scores as ces')
        .join('customer_entities as ce', 'ce.id', 'ces.contact_id')
        .where('ces.organization_id', auth.orgId)
        .where('ces.score', '>', 0)
        .whereNull('ce.deleted_at')
        .orderBy('ces.score', 'desc')
        .limit(10)
        .select('ce.id', 'ce.display_name', 'ce.primary_email', 'ces.score', 'ces.last_activity_at')
      return NextResponse.json({ ok: true, data: hottest })
    }

    if (view === 'coldest') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const coldest = await knex('contact_engagement_scores as ces')
        .join('customer_entities as ce', 'ce.id', 'ces.contact_id')
        .where('ces.organization_id', auth.orgId)
        .where(function () {
          this.where('ces.last_activity_at', '<', thirtyDaysAgo).orWhereNull('ces.last_activity_at')
        })
        .whereNull('ce.deleted_at')
        .orderBy('ces.last_activity_at', 'asc')
        .limit(10)
        .select('ce.id', 'ce.display_name', 'ce.primary_email', 'ces.score', 'ces.last_activity_at')
      return NextResponse.json({ ok: true, data: coldest })
    }

    if (contactId) {
      const score = await knex('contact_engagement_scores')
        .where('contact_id', contactId)
        .where('organization_id', auth.orgId)
        .first()

      const events = await knex('engagement_events')
        .where('contact_id', contactId)
        .where('organization_id', auth.orgId)
        .orderBy('created_at', 'desc')
        .limit(20)

      return NextResponse.json({ ok: true, data: { score: score?.score || 0, lastActivity: score?.last_activity_at, events } })
    }

    // Default: all scores
    const scores = await knex('contact_engagement_scores as ces')
      .join('customer_entities as ce', 'ce.id', 'ces.contact_id')
      .where('ces.organization_id', auth.orgId)
      .whereNull('ce.deleted_at')
      .orderBy('ces.score', 'desc')
      .limit(100)
      .select('ce.id', 'ce.display_name', 'ce.primary_email', 'ces.score', 'ces.last_activity_at')

    return NextResponse.json({ ok: true, data: scores })
  } catch (error) {
    console.error('[engagement]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const body = await req.json()
    const { contactId, score } = body

    if (!contactId || score === undefined) {
      return NextResponse.json({ ok: false, error: 'contactId and score required' }, { status: 400 })
    }

    // Verify contact belongs to this org
    const contact = await knex('customer_entities')
      .where({ id: contactId, organization_id: auth.orgId })
      .whereNull('deleted_at')
      .first()
    if (!contact) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

    const existing = await knex('contact_engagement_scores')
      .where({ contact_id: contactId, organization_id: auth.orgId })
      .first()

    if (existing) {
      await knex('contact_engagement_scores')
        .where({ contact_id: contactId, organization_id: auth.orgId })
        .update({ score, last_activity_at: new Date(), updated_at: new Date() })
    } else {
      await knex('contact_engagement_scores').insert({
        id: require('crypto').randomUUID(),
        tenant_id: auth.tenantId,
        organization_id: auth.orgId,
        contact_id: contactId,
        score,
        last_activity_at: new Date(),
        updated_at: new Date(),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[engagement.PUT]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Engagement', summary: 'Engagement scores',
  methods: {
    GET: { summary: 'Get contact engagement scores', tags: ['Engagement'] },
    PUT: { summary: 'Update contact engagement score', tags: ['Engagement'] },
  },
}
