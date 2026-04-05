import { NextResponse } from 'next/server'
import { query, queryOne } from '@/app/api/funnels/db'

// POST: Advance funnel to next step. If the current step has a product, add it to the cart.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const body = await req.json()
    const { sid, stepId, email, name } = body

    const funnel = await queryOne('SELECT * FROM funnels WHERE slug = $1', [slug])
    if (!funnel) return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })

    const session = sid ? await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [sid]) : null
    if (!session) return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 })

    // Update session with captured email
    if (email?.trim()) {
      await query('UPDATE funnel_sessions SET email = $1, updated_at = $2 WHERE id = $3', [email.trim(), new Date(), session.id])
    }

    // Find current step
    const currentStep = stepId
      ? await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [stepId])
      : await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [session.current_step_id])

    if (!currentStep) return NextResponse.json({ ok: false, error: 'Current step not found' }, { status: 404 })

    // Add product to cart if this step has one
    if (currentStep.product_id) {
      const product = await queryOne('SELECT * FROM products WHERE id = $1', [currentStep.product_id])
      if (product) {
        const cartItems = (typeof session.cart_items === 'string' ? JSON.parse(session.cart_items) : session.cart_items) || []
        const alreadyInCart = cartItems.some((item: any) => item.productId === product.id && item.stepId === currentStep.id)
        if (!alreadyInCart) {
          cartItems.push({
            productId: product.id,
            name: product.name,
            price: Number(product.price),
            currency: (product.currency || 'USD').toUpperCase(),
            stepId: currentStep.id,
            type: (currentStep.step_type === 'page' || currentStep.step_type === 'lead_capture') ? 'main' : currentStep.step_type,
          })
          await query('UPDATE funnel_sessions SET cart_items = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(cartItems), new Date(), session.id])
        }
      }
    }

    // Find next step
    const nextStep = await queryOne(
      'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
      [funnel.id, currentStep.step_order]
    )

    const baseUrl = process.env.APP_URL || 'http://localhost:3000'

    if (nextStep) {
      await query('UPDATE funnel_sessions SET current_step_id = $1 WHERE id = $2', [nextStep.id, session.id])
      return NextResponse.json({
        ok: true,
        redirectUrl: `${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session.id}`,
      })
    }

    // No next step — funnel complete
    return NextResponse.json({
      ok: true,
      redirectUrl: `${baseUrl}/api/funnels/public/${slug}?step=thank_you&sid=${session.id}`,
    })
  } catch (error) {
    console.error('[funnel.advance]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}
