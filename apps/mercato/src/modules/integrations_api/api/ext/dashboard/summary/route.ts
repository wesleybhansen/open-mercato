import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { admitDashboardSummaryPartitions } from '../../../../lib/dashboard-summary-health'

export const metadata = {
  path: '/ext/dashboard/summary',
  GET: { requireAuth: true, requireFeatures: ['integrations_api.access'] },
}

type DashboardSummaryContext = {
  auth?: { tenantId?: string; orgId?: string }
}

function unavailable() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Dashboard summary temporarily unavailable',
      code: 'dashboard_summary_unavailable',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET(_req: Request, ctx: DashboardSummaryContext) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const w = { tenant_id: auth.tenantId, organization_id: auth.orgId }

    const contacts = await knex('customer_entities').where(w).whereNull('deleted_at').select(
      knex.raw('count(*) as total'),
      knex.raw('count(*) filter (where created_at >= ?) as last_30', [thirtyDaysAgo]),
      knex.raw('count(*) filter (where created_at >= ?) as last_7', [sevenDaysAgo]),
    )

    const deals = await knex('customer_deals').where(w).whereNull('deleted_at').select(
      knex.raw('count(*) as total'),
      knex.raw("count(*) filter (where status = 'open') as open"),
      knex.raw("coalesce(sum(value_amount) filter (where status = 'open'), 0) as pipeline_value"),
      knex.raw("count(*) filter (where status = 'win' and updated_at >= ?) as won_30", [thirtyDaysAgo]),
      knex.raw("coalesce(sum(value_amount) filter (where status = 'win' and updated_at >= ?), 0) as revenue_30", [thirtyDaysAgo]),
    )

    const landingPages = await knex('landing_pages').where(w).whereNull('deleted_at').select(
      knex.raw('count(*) as total'),
      knex.raw("count(*) filter (where status = 'published') as published"),
      knex.raw('coalesce(sum(view_count), 0) as views'),
      knex.raw('coalesce(sum(submission_count), 0) as submissions'),
    )

    const email = await knex('email_messages').where(w).where('direction', 'outbound').where('created_at', '>=', thirtyDaysAgo).select(
      knex.raw('count(*) as sent'),
      knex.raw('count(*) filter (where opened_at is not null) as opened'),
      knex.raw('count(*) filter (where clicked_at is not null) as clicked'),
    )

    // Customer-service stats for the ecosystem digest. Org-scoped (w) over the
    // customer-service draft-reply actions. "Replies sent" = actions marked sent;
    // "pending" = still awaiting review; "flagged" rows have metadata.flagged true.
    const customerService = await knex('inbox_proposal_actions').where(w)
      .where('action_type', 'draft_reply')
      .whereRaw(`metadata->>'feature_source' = ?`, ['customer_service'])
      .select(
        knex.raw(`count(*) filter (where status = 'sent' and created_at >= ?) as replies_sent_7`, [sevenDaysAgo]),
        knex.raw(`count(*) filter (where status = 'sent' and created_at >= ?) as replies_sent_30`, [thirtyDaysAgo]),
        knex.raw(`count(*) filter (where status = 'pending') as pending`),
        knex.raw(`count(*) filter (where status = 'pending' and metadata->>'flagged' = 'true') as flagged_pending`),
        knex.raw(`count(*) filter (where metadata->>'flagged' = 'true' and created_at >= ?) as flagged_30`, [thirtyDaysAgo]),
      )

    const data = admitDashboardSummaryPartitions({
      contacts,
      deals,
      landingPages,
      email,
      customerService,
    })

    return NextResponse.json({ ok: true, data })
  } catch {
    console.error('[ext.dashboard.summary] dashboard_summary_unavailable')
    return unavailable()
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'External API', summary: 'Dashboard KPIs',
  methods: { GET: { summary: 'Dashboard KPI summary', tags: ['External API'] } },
}
