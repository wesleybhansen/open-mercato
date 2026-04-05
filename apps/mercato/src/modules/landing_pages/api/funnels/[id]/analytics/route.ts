import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['landing_pages.view'] },
}

export async function GET(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const funnelId = ctx.params?.id

    const funnel = await knex('funnels')
      .where('id', funnelId)
      .where('organization_id', auth.orgId)
      .first()
    if (!funnel) {
      return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })
    }

    const steps = await knex('funnel_steps')
      .where('funnel_id', funnelId)
      .orderBy('step_order')

    const stepAnalytics = []
    for (const step of steps) {
      const [{ count: visits }] = await knex('funnel_visits')
        .where('funnel_id', funnelId)
        .where('step_id', step.id)
        .count()

      let pageTitle: string | null = null
      if (step.page_id) {
        const page = await knex('landing_pages').where('id', step.page_id).first()
        pageTitle = page?.title || null
      }

      stepAnalytics.push({
        stepOrder: step.step_order,
        stepType: step.step_type,
        pageTitle,
        visits: Number(visits),
        dropOffRate: 0,
      })
    }

    // Calculate drop-off rates
    for (let i = 1; i < stepAnalytics.length; i++) {
      const prev = stepAnalytics[i - 1].visits
      const curr = stepAnalytics[i].visits
      if (prev > 0) {
        stepAnalytics[i].dropOffRate = Math.round(((prev - curr) / prev) * 100)
      }
    }

    return NextResponse.json({ ok: true, data: stepAnalytics })
  } catch (error) {
    console.error('[funnels.analytics]', error)
    return NextResponse.json({ ok: false, error: 'Failed to get analytics' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Funnels',
  summary: 'Funnel step analytics',
  methods: {
    GET: { summary: 'Get funnel analytics by step', tags: ['Funnels'] },
  },
}
