import { NextResponse } from 'next/server'
import { query, queryOne } from '@/app/api/funnels/db'
import crypto from 'crypto'

// POST: Accept or decline an upsell/downsell offer (cart model — adds to cart, no payment)
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const body = await req.json()
    const { sid, stepId, action } = body // action: 'accept' | 'decline'

    if (!sid || !stepId || !action) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
    }

    const funnel = await queryOne('SELECT * FROM funnels WHERE slug = $1', [slug])
    if (!funnel) return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })

    const session = await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [sid])
    if (!session) return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 })

    const step = await queryOne('SELECT * FROM funnel_steps WHERE id = $1 AND funnel_id = $2', [stepId, funnel.id])
    if (!step) return NextResponse.json({ ok: false, error: 'Step not found' }, { status: 404 })

    const baseUrl = process.env.APP_URL || 'http://localhost:3000'

    // Record the action
    await query(
      'INSERT INTO funnel_visits (id, funnel_id, step_id, session_id, visitor_id, action, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), funnel.id, step.id, session.id, session.visitor_id, action, new Date()]
    )

    // On accept: add product to cart
    if (action === 'accept' && step.product_id) {
      const product = await queryOne('SELECT * FROM products WHERE id = $1', [step.product_id])
      if (product) {
        const cartItems = (typeof session.cart_items === 'string' ? JSON.parse(session.cart_items) : session.cart_items) || []
        const alreadyInCart = cartItems.some((item: any) => item.productId === product.id && item.stepId === step.id)
        if (!alreadyInCart) {
          cartItems.push({
            productId: product.id,
            name: product.name,
            price: Number(product.price),
            currency: (product.currency || 'USD').toUpperCase(),
            stepId: step.id,
            type: step.step_type, // 'upsell' or 'downsell'
          })
          await query('UPDATE funnel_sessions SET cart_items = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(cartItems), new Date(), session.id])
        }
      }
    }

    // Determine next step based on action and branching
    let nextStep = null
    if (action === 'accept' && step.on_accept_step_id) {
      nextStep = await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [step.on_accept_step_id])
    } else if (action === 'decline' && step.on_decline_step_id) {
      nextStep = await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [step.on_decline_step_id])
    }

    // Fallback: next step by order
    if (!nextStep) {
      nextStep = await queryOne(
        'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
        [funnel.id, step.step_order]
      )
    }

    // Update session
    if (nextStep) {
      await query('UPDATE funnel_sessions SET current_step_id = $1, updated_at = $2 WHERE id = $3', [nextStep.id, new Date(), session.id])
    }

    const redirectUrl = nextStep
      ? `${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session.id}`
      : `${baseUrl}/api/funnels/public/${slug}?step=thank_you&sid=${session.id}`

    return NextResponse.json({ ok: true, redirectUrl })
  } catch (error) {
    console.error('[funnel.upsell]', error)
    const message = error instanceof Error ? error.message : 'Failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
