import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { query, queryOne } from '@/app/api/funnels/db'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params

    const funnel = await queryOne('SELECT * FROM funnels WHERE id = $1 AND organization_id = $2', [id, auth.orgId])
    if (!funnel) return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })

    const steps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [id])

    const analytics = []
    let prevVisits = 0

    for (const step of steps) {
      const visitResult = await queryOne(
        'SELECT count(*)::int as count FROM funnel_visits WHERE step_id = $1',
        [step.id]
      )
      const visits = visitResult?.count || 0

      // Get page title if it's a page step
      let pageTitle = null
      if (step.page_id) {
        const page = await queryOne('SELECT title FROM landing_pages WHERE id = $1', [step.page_id])
        pageTitle = page?.title || null
      }

      const dropOff = prevVisits > 0 ? ((prevVisits - visits) / prevVisits * 100).toFixed(1) : '0.0'

      analytics.push({
        stepId: step.id,
        stepOrder: step.step_order,
        stepType: step.step_type,
        stepName: step.name || step.step_type,
        pageTitle,
        visits,
        dropOff: Number(dropOff),
      })

      prevVisits = visits
    }

    // Abandoned sessions (active for >24 hours without completion)
    const abandonedResult = await query(
      "SELECT fs.email, fs.started_at, fs.updated_at, fst.name as last_step_name, fst.step_type as last_step_type FROM funnel_sessions fs LEFT JOIN funnel_steps fst ON fst.id = fs.current_step_id WHERE fs.funnel_id = $1 AND fs.status = 'active' AND fs.updated_at < NOW() - INTERVAL '24 hours' ORDER BY fs.updated_at DESC LIMIT 20",
      [id]
    )

    return NextResponse.json({ ok: true, data: analytics, abandoned: abandonedResult })
  } catch (error) {
    console.error('[funnels.analytics]', error)
    return NextResponse.json({ ok: false, error: 'Failed to load analytics' }, { status: 500 })
  }
}
