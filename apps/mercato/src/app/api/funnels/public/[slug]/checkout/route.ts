import { NextResponse } from 'next/server'
import { query, queryOne } from '@/app/api/funnels/db'
import crypto from 'crypto'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// GET: Render checkout page showing all cart items
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const url = new URL(req.url)
    const sid = url.searchParams.get('sid')
    const stepId = url.searchParams.get('step')

    const funnel = await queryOne('SELECT * FROM funnels WHERE slug = $1 AND is_published = true', [slug])
    if (!funnel) return new Response('Funnel not found', { status: 404 })

    const session = sid ? await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [sid]) : null
    const step = stepId
      ? await queryOne('SELECT * FROM funnel_steps WHERE id = $1', [stepId])
      : await queryOne('SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_type = $2 ORDER BY step_order LIMIT 1', [funnel.id, 'checkout'])
    if (!step) return new Response('Checkout step not found', { status: 404 })

    const config = typeof step.config === 'string' ? JSON.parse(step.config) : (step.config || {})

    // Read cart items from session
    const cartItems = session ? ((typeof session.cart_items === 'string' ? JSON.parse(session.cart_items) : session.cart_items) || []) : []

    // Fallback: if cart is empty and this checkout step has its own product, use it.
    // Only applies when there are no upsell/downsell steps feeding this checkout (simple funnels).
    if (cartItems.length === 0 && step.product_id) {
      const hasOfferSteps = await queryOne(
        "SELECT id FROM funnel_steps WHERE funnel_id = $1 AND step_type IN ('upsell','downsell') AND step_order < $2 LIMIT 1",
        [funnel.id, step.step_order]
      )
      if (!hasOfferSteps) {
        const product = await queryOne('SELECT * FROM products WHERE id = $1', [step.product_id])
        if (product) {
          cartItems.push({
            productId: product.id,
            name: product.name,
            price: Number(product.price),
            currency: (product.currency || 'USD').toUpperCase(),
            stepId: step.id,
            type: 'main',
          })
        }
      }
    }

    // Empty cart after offer steps — nothing to buy, redirect to next step (thank you)
    if (cartItems.length === 0) {
      const baseUrl = process.env.APP_URL || url.origin
      const nextStep = await queryOne(
        'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
        [funnel.id, step.step_order]
      )
      const thankYouUrl = nextStep
        ? `${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session?.id || ''}`
        : `${baseUrl}/api/funnels/public/${slug}?step=thank_you&sid=${session?.id || ''}`
      return NextResponse.redirect(thankYouUrl)
    }

    // Calculate cart total
    const cartTotal = cartItems.reduce((sum: number, item: any) => sum + Number(item.price), 0)

    // Build cart items HTML
    const cartHtml = cartItems.map((item: any) =>
      `<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7eb">
        <span style="font-size:14px;color:#111827">${escapeHtml(item.name)}</span>
        <span style="font-size:14px;font-weight:600;color:#111827">$${Number(item.price).toFixed(2)}</span>
      </div>`
    ).join('')

    // Load order bumps from config
    const bumps = config.order_bumps || []
    let bumpHtml = ''
    for (const bump of bumps) {
      const bumpProduct = bump.product_id ? await queryOne('SELECT * FROM products WHERE id = $1', [bump.product_id]) : null
      const bName = bumpProduct?.name || bump.headline || 'Add-on'
      const bPrice = bumpProduct?.price || bump.price || 0
      const bDesc = bump.description || bumpProduct?.description || ''
      bumpHtml += `
        <label style="display:flex;align-items:flex-start;gap:12px;padding:16px;border:2px dashed #d1d5db;border-radius:8px;cursor:pointer;margin-bottom:8px;transition:border-color .15s"
          onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#d1d5db'">
          <input type="checkbox" name="bump" value="${escapeHtml(bump.product_id || '')}" data-price="${bPrice}"
            style="margin-top:3px;width:18px;height:18px" ${bump.checked_by_default ? 'checked' : ''}
            onchange="this.parentElement.style.borderColor=this.checked?'#3b82f6':'#d1d5db';updateTotal()">
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;color:#111827">${escapeHtml(bName)} — $${Number(bPrice).toFixed(2)}</div>
            <div style="font-size:13px;color:#6b7280;margin-top:2px">${escapeHtml(bDesc)}</div>
          </div>
        </label>`
    }

    const baseUrl = process.env.APP_URL || url.origin
    const prefillEmail = session?.email || ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#f9fafb;color:#111827;min-height:100vh;display:flex;align-items:center;justify-content:center}
.checkout{max-width:520px;width:100%;margin:24px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);overflow:hidden}
.header{padding:24px 32px;background:#111827;color:#fff;text-align:center}
.header h1{margin:0;font-size:20px;font-weight:700}
.body{padding:32px}
.cart{margin-bottom:24px}
.cart-title{font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px}
.field{margin-bottom:16px}
.field label{display:block;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.field input{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;outline:none;transition:border-color .15s}
.field input:focus{border-color:#3b82f6}
.bumps{margin:20px 0}
.bumps h3{font-size:13px;font-weight:600;color:#374151;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px}
.total{text-align:center;font-size:20px;font-weight:700;margin:20px 0;padding:16px;background:#f3f4f6;border-radius:8px}
.btn{display:block;width:100%;padding:16px;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;background:#16a34a;color:#fff;transition:background .15s}
.btn:hover{background:#15803d}
.btn:disabled{background:#9ca3af;cursor:not-allowed}
.secure{text-align:center;font-size:11px;color:#9ca3af;margin-top:12px}
@media(max-width:640px){.checkout{margin:0;border-radius:0;min-height:100vh}.header{padding:20px}.body{padding:20px}}
</style></head><body>
<div class="checkout">
  <div class="header">
    <h1>Complete Your Purchase</h1>
  </div>
  <div class="body">
    <div class="cart">
      <div class="cart-title">Your Order</div>
      ${cartHtml}
    </div>
    <form id="checkoutForm" onsubmit="return handleCheckout(event)">
      <div class="field">
        <label>Full Name</label>
        <input type="text" name="name" required placeholder="Your name">
      </div>
      <div class="field">
        <label>Email Address</label>
        <input type="email" name="email" required placeholder="you@example.com" value="${escapeHtml(prefillEmail)}">
      </div>
      ${bumpHtml ? `<div class="bumps"><h3>Add to your order</h3>${bumpHtml}</div>` : ''}
      <div class="total" id="totalDisplay">Total: $${cartTotal.toFixed(2)}</div>
      <button type="submit" class="btn" id="submitBtn">Complete Purchase</button>
      <p class="secure">&#128274; Secure checkout powered by Stripe</p>
    </form>
  </div>
</div>
<script>
var cartTotal = ${cartTotal};
function updateTotal(){
  var total = cartTotal;
  document.querySelectorAll('input[name=bump]:checked').forEach(function(cb){total += Number(cb.dataset.price)});
  document.getElementById('totalDisplay').textContent = 'Total: $' + total.toFixed(2);
}
function handleCheckout(e){
  e.preventDefault();
  var btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Redirecting to payment...';
  var form = document.getElementById('checkoutForm');
  var bumps = [];
  document.querySelectorAll('input[name=bump]:checked').forEach(function(cb){bumps.push(cb.value)});
  fetch('${baseUrl}/api/funnels/public/${slug}/checkout', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      sid: '${session?.id || ''}',
      stepId: '${step.id}',
      name: form.elements.name.value,
      email: form.elements.email.value,
      bumpProductIds: bumps
    })
  }).then(function(r){return r.json()}).then(function(d){
    if(d.checkoutUrl) window.location.href = d.checkoutUrl;
    else { btn.disabled=false; btn.textContent='Complete Purchase'; alert(d.error||'Failed to create checkout'); }
  }).catch(function(){btn.disabled=false; btn.textContent='Complete Purchase'; alert('Something went wrong');});
  return false;
}
updateTotal();
</script>
</body></html>`

    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  } catch (error) {
    console.error('[funnel.checkout.GET]', error)
    return new Response('Error loading checkout', { status: 500 })
  }
}

// POST: Create Stripe Checkout session with all cart items
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const body = await req.json()
    const { sid, stepId, name, email, bumpProductIds } = body

    if (!email?.trim()) return NextResponse.json({ ok: false, error: 'Email is required' }, { status: 400 })

    const funnel = await queryOne('SELECT * FROM funnels WHERE slug = $1 AND is_published = true', [slug])
    if (!funnel) return NextResponse.json({ ok: false, error: 'Funnel not found' }, { status: 404 })

    const step = await queryOne('SELECT * FROM funnel_steps WHERE id = $1 AND funnel_id = $2', [stepId, funnel.id])
    if (!step) return NextResponse.json({ ok: false, error: 'Step not found' }, { status: 404 })

    // Get org's Stripe connection
    const stripeConnection = await queryOne(
      'SELECT stripe_account_id FROM stripe_connections WHERE organization_id = $1 AND is_active = true',
      [funnel.organization_id]
    )
    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey || !stripeConnection?.stripe_account_id) {
      return NextResponse.json({ ok: false, error: 'Payment processing is not configured' }, { status: 400 })
    }

    // Read cart items from session
    let session: any = sid ? await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [sid]) : null
    if (session) {
      await query('UPDATE funnel_sessions SET email = $1, updated_at = $2 WHERE id = $3', [email.trim(), new Date(), session.id])
    } else {
      const sessionId = crypto.randomUUID()
      await query(
        'INSERT INTO funnel_sessions (id, funnel_id, organization_id, visitor_id, email, current_step_id, status, cart_items, started_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [sessionId, funnel.id, funnel.organization_id, crypto.randomUUID(), email.trim(), step.id, 'active', '[]', new Date(), new Date()]
      )
      session = await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [sessionId])
    }

    const cartItems = (typeof session.cart_items === 'string' ? JSON.parse(session.cart_items) : session.cart_items) || []

    // Fallback: if cart is empty and this checkout step has its own product, use it.
    // Only applies when there are no upsell/downsell steps feeding this checkout (simple funnels).
    if (cartItems.length === 0 && step.product_id) {
      const hasOfferSteps = await queryOne(
        "SELECT id FROM funnel_steps WHERE funnel_id = $1 AND step_type IN ('upsell','downsell') AND step_order < $2 LIMIT 1",
        [funnel.id, step.step_order]
      )
      if (!hasOfferSteps) {
        const product = await queryOne('SELECT * FROM products WHERE id = $1', [step.product_id])
        if (product) {
          cartItems.push({
            productId: product.id,
            name: product.name,
            price: Number(product.price),
            currency: (product.currency || 'USD').toUpperCase(),
            stepId: step.id,
            type: 'main',
          })
        }
      }
    }

    if (cartItems.length === 0) {
      return NextResponse.json({ ok: false, error: 'Your cart is empty. Please go back and select a product.' }, { status: 400 })
    }

    // Build line items from cart
    const lineItems: any[] = cartItems.map((item: any) => ({
      price_data: {
        currency: (item.currency || 'usd').toLowerCase(),
        product_data: { name: item.name },
        unit_amount: Math.round(Number(item.price) * 100),
      },
      quantity: 1,
    }))

    // Add order bumps
    const bumpIds = Array.isArray(bumpProductIds) ? bumpProductIds : []
    for (const bumpProdId of bumpIds) {
      if (!bumpProdId) continue
      const bumpProduct = await queryOne('SELECT * FROM products WHERE id = $1', [bumpProdId])
      if (bumpProduct) {
        lineItems.push({
          price_data: {
            currency: (bumpProduct.currency || 'usd').toLowerCase(),
            product_data: { name: bumpProduct.name },
            unit_amount: Math.round(Number(bumpProduct.price) * 100),
          },
          quantity: 1,
        })
      }
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any })
    const baseUrl = process.env.APP_URL || 'http://localhost:3000'

    // Find the next step after checkout for the success URL
    const nextStep = await queryOne(
      'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
      [funnel.id, step.step_order]
    )

    const successUrl = nextStep
      ? `${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session.id}`
      : `${baseUrl}/api/funnels/public/${slug}?step=thank_you&sid=${session.id}`

    const allProductIds = cartItems.map((item: any) => item.productId).join(',')

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: email.trim(),
      metadata: {
        type: 'funnel',
        funnelId: funnel.id,
        funnelSlug: slug,
        stepId: step.id,
        sessionId: session.id,
        orgId: funnel.organization_id,
        tenantId: funnel.tenant_id,
        customerName: name?.trim() || '',
        customerEmail: email.trim(),
        productIds: allProductIds,
        bumpProductIds: bumpIds.join(','),
      },
      success_url: successUrl,
      cancel_url: `${baseUrl}/api/funnels/public/${slug}/checkout?sid=${session.id}&step=${step.id}`,
    }, {
      stripeAccount: stripeConnection.stripe_account_id,
    })

    // Create funnel_orders for all cart items
    for (const item of cartItems) {
      await query(
        'INSERT INTO funnel_orders (id, session_id, funnel_id, step_id, product_id, amount, currency, order_type, stripe_checkout_session_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [crypto.randomUUID(), session.id, funnel.id, item.stepId || step.id, item.productId, Number(item.price), (item.currency || 'USD').toUpperCase(), item.type || 'main', checkoutSession.id, 'pending', new Date()]
      )
    }

    // Create bump orders
    for (const bumpProdId of bumpIds) {
      const bp = await queryOne('SELECT * FROM products WHERE id = $1', [bumpProdId])
      if (bp) {
        await query(
          'INSERT INTO funnel_orders (id, session_id, funnel_id, step_id, product_id, amount, currency, order_type, stripe_checkout_session_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [crypto.randomUUID(), session.id, funnel.id, step.id, bp.id, Number(bp.price), (bp.currency || 'USD').toUpperCase(), 'order_bump', checkoutSession.id, 'pending', new Date()]
        )
      }
    }

    return NextResponse.json({ ok: true, checkoutUrl: checkoutSession.url })
  } catch (error) {
    console.error('[funnel.checkout.POST]', error)
    const message = error instanceof Error ? error.message : 'Failed to create checkout'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
