import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { query, queryOne } from '@/app/api/funnels/db'
import crypto from 'crypto'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 100)
}

export async function GET() {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const funnels = await query('SELECT * FROM funnels WHERE organization_id = $1 ORDER BY created_at DESC', [auth.orgId])

    for (const f of funnels) {
      const [stepCount] = await query('SELECT count(*)::int as count FROM funnel_steps WHERE funnel_id = $1', [f.id])
      const [visitCount] = await query('SELECT count(*)::int as count FROM funnel_visits WHERE funnel_id = $1', [f.id])
      const [sessionStats] = await query(
        "SELECT count(*)::int as total, count(*) FILTER (WHERE status = 'completed')::int as completed, count(*) FILTER (WHERE status = 'active' AND updated_at < NOW() - INTERVAL '24 hours')::int as abandoned, COALESCE(sum(total_revenue), 0)::numeric as revenue FROM funnel_sessions WHERE funnel_id = $1",
        [f.id]
      )
      f.step_count = Number(stepCount?.count || 0)
      f.total_visits = Number(visitCount?.count || 0)
      f.total_sessions = Number(sessionStats?.total || 0)
      f.completed_sessions = Number(sessionStats?.completed || 0)
      f.abandoned_sessions = Number(sessionStats?.abandoned || 0)
      f.total_revenue = Number(sessionStats?.revenue || 0)
      f.conversion_rate = f.total_sessions > 0 ? Number(((f.completed_sessions / f.total_sessions) * 100).toFixed(1)) : 0
    }

    return NextResponse.json({ ok: true, data: funnels })
  } catch (error) {
    console.error('[funnels.list]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'Name is required' }, { status: 400 })

    const slug = slugify(body.name)
    const existing = await queryOne('SELECT id FROM funnels WHERE slug = $1 AND organization_id = $2', [slug, auth.orgId])
    if (existing) return NextResponse.json({ ok: false, error: 'A funnel with this name already exists' }, { status: 409 })

    const id = crypto.randomUUID()
    const now = new Date()

    await query(
      'INSERT INTO funnels (id, tenant_id, organization_id, name, slug, is_published, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, auth.tenantId, auth.orgId, body.name.trim(), slug, false, now, now]
    )

    if (Array.isArray(body.steps)) {
      for (const step of body.steps) {
        await query(
          'INSERT INTO funnel_steps (id, funnel_id, step_order, step_type, page_id, product_id, name, on_accept_step_id, on_decline_step_id, config, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [crypto.randomUUID(), id, step.stepOrder || 1, step.stepType || 'page', step.pageId || null, step.productId || null, step.name || null, step.onAcceptStepId || null, step.onDeclineStepId || null, JSON.stringify(step.config || {}), now]
        )
      }
    }

    const funnel = await queryOne('SELECT * FROM funnels WHERE id = $1', [id])
    const steps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [id])
    return NextResponse.json({ ok: true, data: { ...funnel, steps } }, { status: 201 })
  } catch (error) {
    console.error('[funnels.create]', error)
    const msg = error instanceof Error ? error.message : 'Failed to create funnel'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'Missing funnel id' }, { status: 400 })

    const funnel = await queryOne('SELECT * FROM funnels WHERE id = $1 AND organization_id = $2', [id, auth.orgId])
    if (!funnel) return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })

    const body = await req.json()
    const updates: string[] = ['updated_at = $1']
    const values: any[] = [new Date()]
    let paramIdx = 2

    if (body.name !== undefined) { updates.push(`name = $${paramIdx}`); values.push(body.name.trim()); paramIdx++ }
    if (body.isPublished !== undefined) {
      // Validate before publishing
      if (body.isPublished === true) {
        const existingSteps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [id])
        const issues: string[] = []
        if (existingSteps.length === 0) issues.push('Funnel has no steps')
        for (const s of existingSteps) {
          const label = `Step ${s.step_order} (${s.step_type})`
          if ((s.step_type === 'page' || s.step_type === 'lead_capture') && !s.page_id) issues.push(`${label}: No landing page selected`)
          if (s.step_type === 'checkout' && !s.product_id) {
            // In cart model, checkout reads from cart — only warn if NO steps before it have products
            const hasProductBefore = existingSteps.some((ps: any) => ps.step_order < s.step_order && ps.product_id)
            if (!hasProductBefore) issues.push(`${label}: No product selected and no products in earlier steps`)
          }
          if ((s.step_type === 'upsell' || s.step_type === 'downsell') && !s.product_id) {
            const cfg = typeof s.config === 'string' ? JSON.parse(s.config) : (s.config || {})
            if (!cfg.price) issues.push(`${label}: No product or price configured`)
          }
        }
        const hasPaymentStep = existingSteps.some((s: any) => ['checkout', 'upsell', 'downsell'].includes(s.step_type))
        if (hasPaymentStep) {
          const stripeConn = await queryOne('SELECT id FROM stripe_connections WHERE organization_id = $1 AND is_active = true', [auth.orgId])
          if (!stripeConn) issues.push('Stripe is not connected — payment steps will not work. Connect Stripe in Settings.')
        }
        if (issues.length > 0) {
          return NextResponse.json({ ok: false, error: 'Cannot publish:\n' + issues.join('\n') }, { status: 400 })
        }
      }
      updates.push(`is_published = $${paramIdx}`); values.push(body.isPublished); paramIdx++
    }

    values.push(id)
    await query(`UPDATE funnels SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values)

    if (Array.isArray(body.steps)) {
      await query('DELETE FROM funnel_steps WHERE funnel_id = $1', [id])
      const now = new Date()
      for (const step of body.steps) {
        await query(
          'INSERT INTO funnel_steps (id, funnel_id, step_order, step_type, page_id, product_id, name, on_accept_step_id, on_decline_step_id, config, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [crypto.randomUUID(), id, step.stepOrder || 1, step.stepType || 'page', step.pageId || null, step.productId || null, step.name || null, step.onAcceptStepId || null, step.onDeclineStepId || null, JSON.stringify(step.config || {}), now]
        )
      }
    }

    const updated = await queryOne('SELECT * FROM funnels WHERE id = $1', [id])
    const steps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [id])
    return NextResponse.json({ ok: true, data: { ...updated, steps } })
  } catch (error) {
    console.error('[funnels.update]', error)
    return NextResponse.json({ ok: false, error: 'Failed to update funnel' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const id = url.searchParams.get('id')

    if (action === 'duplicate' && id) {
      const original = await queryOne('SELECT * FROM funnels WHERE id = $1 AND organization_id = $2', [id, auth.orgId])
      if (!original) return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })

      const newId = crypto.randomUUID()
      const newSlug = slugify(original.name + ' copy') + '-' + Date.now().toString(36)
      const now = new Date()

      await query(
        'INSERT INTO funnels (id, tenant_id, organization_id, name, slug, is_published, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [newId, auth.tenantId, auth.orgId, original.name + ' (Copy)', newSlug, false, now, now]
      )

      const originalSteps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [id])

      // Map old step IDs to new ones for branching preservation
      const idMap: Record<string, string> = {}
      const newSteps: { newId: string; step: any }[] = []
      for (const step of originalSteps) {
        const newStepId = crypto.randomUUID()
        idMap[step.id] = newStepId
        newSteps.push({ newId: newStepId, step })
      }

      for (const { newId: newStepId, step } of newSteps) {
        const acceptId = step.on_accept_step_id ? (idMap[step.on_accept_step_id] || null) : null
        const declineId = step.on_decline_step_id ? (idMap[step.on_decline_step_id] || null) : null
        await query(
          'INSERT INTO funnel_steps (id, funnel_id, step_order, step_type, page_id, product_id, name, on_accept_step_id, on_decline_step_id, config, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [newStepId, newId, step.step_order, step.step_type, step.page_id, step.product_id, step.name, acceptId, declineId, typeof step.config === 'string' ? step.config : JSON.stringify(step.config || {}), now]
        )
      }

      const funnel = await queryOne('SELECT * FROM funnels WHERE id = $1', [newId])
      const steps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [newId])
      return NextResponse.json({ ok: true, data: { ...funnel, steps } }, { status: 201 })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[funnels.patch]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'Missing funnel id' }, { status: 400 })

    // Delete in order to respect FK constraints
    await query('DELETE FROM funnel_orders WHERE session_id IN (SELECT id FROM funnel_sessions WHERE funnel_id = $1)', [id])
    await query('DELETE FROM funnel_sessions WHERE funnel_id = $1', [id])
    await query('DELETE FROM funnel_steps WHERE funnel_id = $1', [id])
    await query('DELETE FROM funnel_visits WHERE funnel_id = $1', [id])
    await query('DELETE FROM funnels WHERE id = $1 AND organization_id = $2', [id, auth.orgId])

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[funnels.delete]', error)
    return NextResponse.json({ ok: false, error: 'Failed to delete funnel' }, { status: 500 })
  }
}
