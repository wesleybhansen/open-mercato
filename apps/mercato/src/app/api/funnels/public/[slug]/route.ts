import { NextResponse } from 'next/server'
import { query, queryOne } from '@/app/api/funnels/db'
import crypto from 'crypto'
import { cookies } from 'next/headers'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Create a Stripe Checkout session directly, skipping the checkout form page.
// Returns the Stripe checkout URL or null if Stripe isn't configured.
async function createDirectStripeCheckout(
  funnel: any, session: any, step: any, allSteps: any[], slug: string, baseUrl: string
): Promise<string | null> {
  const stripeConnection = await queryOne(
    'SELECT stripe_account_id FROM stripe_connections WHERE organization_id = $1 AND is_active = true',
    [funnel.organization_id]
  )
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey || !stripeConnection?.stripe_account_id) return null

  // Build cart from session
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
  if (cartItems.length === 0) return null

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any })

  const lineItems = cartItems.map((item: any) => ({
    price_data: {
      currency: (item.currency || 'usd').toLowerCase(),
      product_data: { name: item.name },
      unit_amount: Math.round(Number(item.price) * 100),
    },
    quantity: 1,
  }))

  const nextStep = await queryOne(
    'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
    [funnel.id, step.step_order]
  )
  const successUrl = nextStep
    ? `${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session.id}`
    : `${baseUrl}/api/funnels/public/${slug}?step=thank_you&sid=${session.id}`

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: session.email,
    metadata: {
      type: 'funnel',
      funnelId: funnel.id,
      funnelSlug: slug,
      stepId: step.id,
      sessionId: session.id,
      orgId: funnel.organization_id,
      tenantId: funnel.tenant_id,
      customerEmail: session.email,
      productIds: cartItems.map((item: any) => item.productId).join(','),
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

  return checkoutSession.url!
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const url = new URL(req.url)
    const stepParam = url.searchParams.get('step')
    const sidParam = url.searchParams.get('sid')

    const isPreview = url.searchParams.get('preview') === '1'
    const hasSession = Boolean(sidParam)
    // Allow access if: published, preview mode, or continuing an existing session
    const funnel = (isPreview || hasSession)
      ? await queryOne('SELECT * FROM funnels WHERE slug = $1', [slug])
      : await queryOne('SELECT * FROM funnels WHERE slug = $1 AND is_published = true', [slug])
    if (!funnel) return new Response('Funnel not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })

    const steps = await query('SELECT * FROM funnel_steps WHERE funnel_id = $1 ORDER BY step_order', [funnel.id])
    if (steps.length === 0) return new Response('Funnel has no steps', { status: 404, headers: { 'Content-Type': 'text/plain' } })

    // Get or create visitor ID
    const cookieStore = await cookies()
    let visitorId = cookieStore.get('funnel_vid')?.value
    if (!visitorId) visitorId = crypto.randomUUID()

    // Determine current step
    let currentStep = steps[0]
    if (stepParam) {
      const found = steps.find((s: any) => s.id === stepParam || String(s.step_order) === stepParam)
      if (found) currentStep = found
    }

    // Get or create session (sessions valid for 7 days)
    let session = sidParam
      ? await queryOne("SELECT * FROM funnel_sessions WHERE id = $1 AND updated_at > NOW() - INTERVAL '7 days'", [sidParam])
      : await queryOne("SELECT * FROM funnel_sessions WHERE funnel_id = $1 AND visitor_id = $2 AND status = $3 AND updated_at > NOW() - INTERVAL '7 days'", [funnel.id, visitorId, 'active'])

    if (!session) {
      const sessionId = crypto.randomUUID()
      await query('INSERT INTO funnel_sessions (id, funnel_id, organization_id, visitor_id, current_step_id, status, started_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [sessionId, funnel.id, funnel.organization_id, visitorId, currentStep.id, 'active', new Date(), new Date()])
      session = await queryOne('SELECT * FROM funnel_sessions WHERE id = $1', [sessionId])
    } else {
      await query('UPDATE funnel_sessions SET current_step_id = $1, updated_at = $2 WHERE id = $3', [currentStep.id, new Date(), session.id])
    }

    // Record visit
    await query('INSERT INTO funnel_visits (id, funnel_id, step_id, session_id, visitor_id, action, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(), funnel.id, currentStep.id, session.id, visitorId, 'view', new Date()])

    const baseUrl = process.env.APP_URL || url.origin
    const config = typeof currentStep.config === 'string' ? JSON.parse(currentStep.config) : (currentStep.config || {})

    let response!: Response

    if ((currentStep.step_type === 'page' || currentStep.step_type === 'lead_capture') && currentStep.page_id) {
      const page = await queryOne('SELECT slug FROM landing_pages WHERE id = $1 AND status = $2', [currentStep.page_id, 'published'])
      if (page) {
        response = NextResponse.redirect(`${baseUrl}/api/landing-pages/public/${page.slug}?funnel_sid=${session.id}&funnel_step=${currentStep.id}&funnel_slug=${slug}`)
      } else {
        // Friendly error for missing page — try to skip to next step
        const nextStep = await queryOne(
          'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
          [funnel.id, currentStep.step_order]
        )
        if (nextStep) {
          response = NextResponse.redirect(`${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session.id}`)
        } else {
          response = new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page Unavailable</title><style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,sans-serif;margin:0;background:#f9fafb;color:#111}</style></head><body><div style="text-align:center;padding:48px"><h1 style="font-size:1.5rem;margin-bottom:12px">This page is currently unavailable</h1><p style="color:#666">Please check back later or contact support.</p></div></body></html>`, { status: 404, headers: { 'Content-Type': 'text/html' } })
        }
      }
    } else if (currentStep.step_type === 'checkout') {
      // Check if cart has items — if empty after offer steps, skip checkout entirely
      const cartItems = (typeof session.cart_items === 'string' ? JSON.parse(session.cart_items) : session.cart_items) || []
      // Only count the step's own product as a fallback if no upsell/downsell steps precede this checkout
      let hasCartItems = cartItems.length > 0
      if (!hasCartItems && currentStep.product_id) {
        const hasOfferSteps = await queryOne(
          "SELECT id FROM funnel_steps WHERE funnel_id = $1 AND step_type IN ('upsell','downsell') AND step_order < $2 LIMIT 1",
          [funnel.id, currentStep.step_order]
        )
        hasCartItems = !hasOfferSteps // only use fallback product for simple funnels
      }

      if (!hasCartItems) {
        // Nothing to buy — skip to next step (thank you)
        const nextStep = await queryOne(
          'SELECT * FROM funnel_steps WHERE funnel_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
          [funnel.id, currentStep.step_order]
        )
        response = nextStep
          ? NextResponse.redirect(`${baseUrl}/api/funnels/public/${slug}?step=${nextStep.id}&sid=${session.id}`)
          : NextResponse.redirect(`${baseUrl}/api/funnels/public/${slug}?step=thank_you&sid=${session.id}`)
      } else if (session.email) {
        // Email already captured — skip the form and go straight to Stripe
        const stripeRedirect = await createDirectStripeCheckout(funnel, session, currentStep, steps, slug, baseUrl)
        if (stripeRedirect) {
          response = NextResponse.redirect(stripeRedirect)
        } else {
          // Stripe not configured — fall back to checkout form
          response = NextResponse.redirect(`${baseUrl}/api/funnels/public/${slug}/checkout?sid=${session.id}&step=${currentStep.id}`)
        }
      } else {
        response = NextResponse.redirect(`${baseUrl}/api/funnels/public/${slug}/checkout?sid=${session.id}&step=${currentStep.id}`)
      }
    } else if (currentStep.step_type === 'upsell' || currentStep.step_type === 'downsell') {
      // Check if arriving from a checkout (show success banner)
      const prevStep = await queryOne(
        'SELECT step_type FROM funnel_steps WHERE funnel_id = $1 AND step_order < $2 ORDER BY step_order DESC LIMIT 1',
        [funnel.id, currentStep.step_order]
      )
      const showSuccessBanner = false // Cart model: no payment before upsells

      const product = currentStep.product_id
        ? await queryOne('SELECT * FROM products WHERE id = $1', [currentStep.product_id])
        : null
      const productName = product?.name || config.headline || 'Special Offer'
      const productPrice = product?.price || config.price || 0
      const description = config.description || product?.description || ''
      const acceptText = config.accept_button_text || 'Yes! Add this to my order'
      const declineText = config.decline_button_text || "No thanks, I'll pass"
      const isDownsell = currentStep.step_type === 'downsell'

      // Accept/decline script injected into both custom and default pages
      const upsellScript = `<script>
function _funnelAct(a){
  var btns=document.getElementById('funnel-btns')||document.querySelector('.funnel-actions');
  var loading=document.getElementById('funnel-loading');
  if(btns)btns.style.display='none';
  if(loading)loading.style.display='block';
  fetch('${baseUrl}/api/funnels/public/${slug}/upsell',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({sid:'${session.id}',stepId:'${currentStep.id}',action:a})})
  .then(function(r){return r.json()}).then(function(d){if(d.redirectUrl)window.location.href=d.redirectUrl;else{if(loading)loading.textContent=d.error||'Something went wrong';if(btns)btns.style.display='block';}})
  .catch(function(){if(loading)loading.textContent='Something went wrong';if(btns)btns.style.display='block';});
}
</script>`

      // If a custom landing page is linked, use it with injected accept/decline buttons
      if (currentStep.page_id) {
        const page = await queryOne('SELECT * FROM landing_pages WHERE id = $1 AND status = $2', [currentStep.page_id, 'published'])
        if (page?.published_html) {
          const successBannerHtml = showSuccessBanner ? `
<div style="position:fixed;top:0;left:0;right:0;z-index:10000;background:#16a34a;color:#fff;text-align:center;padding:12px 24px;font-size:14px;font-weight:600;animation:fadeOut 4s ease forwards 3s">
  Payment successful! Here's a special offer for you.
</div>
<style>@keyframes fadeOut{to{opacity:0;transform:translateY(-100%)}}</style>` : ''

          const buttonBarHtml = `
<div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#fff;border-top:2px solid #e5e7eb;padding:16px 24px;box-shadow:0 -4px 20px rgba(0,0,0,0.1)">
  <div style="max-width:600px;margin:0 auto;display:flex;flex-direction:column;gap:8px" id="funnel-btns">
    <button onclick="_funnelAct('accept')" style="width:100%;padding:16px;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;background:#16a34a;color:#fff">${escapeHtml(acceptText)} — $${Number(productPrice).toFixed(2)}</button>
    <button onclick="_funnelAct('decline')" style="width:100%;padding:8px;border:none;background:none;font-size:13px;color:#9ca3af;cursor:pointer;text-decoration:underline">${escapeHtml(declineText)}</button>
  </div>
  <div id="funnel-loading" style="display:none;text-align:center;padding:12px;color:#6b7280">Processing...</div>
</div>
<style>body{padding-bottom:120px!important}</style>`

          // Strip any page-assembler _funnelAct that reads from URL params (won't work here)
          // and replace with the route's hardcoded version that has the correct session/step IDs
          let pageHtml = page.published_html
          const hasOwnButtons = pageHtml.includes('_funnelAct')
          if (hasOwnButtons) {
            // Remove the page-assembler's script block that defines _funnelAct
            pageHtml = pageHtml.replace(/<script>\s*function _funnelAct[\s\S]*?<\/script>/g, '')
          }
          const html = hasOwnButtons
            ? pageHtml.replace('</body>', successBannerHtml + upsellScript + '</body>')
            : pageHtml.replace('</body>', successBannerHtml + upsellScript + buttonBarHtml + '</body>')
          response = new Response(html, { headers: { 'Content-Type': 'text/html' } })
        } else {
          // Page not found, fall through to default
          response = new Response('Linked page not found', { status: 404 })
        }
      }

      // Default inline offer card (when no custom page is linked)
      if (!response || response.status === 404) {
        const successBanner = showSuccessBanner ? `<div style="position:fixed;top:0;left:0;right:0;z-index:10000;background:#16a34a;color:#fff;text-align:center;padding:12px 24px;font-size:14px;font-weight:600;animation:fadeOut 4s ease forwards 3s">Payment successful! Here's a special offer for you.</div><style>@keyframes fadeOut{to{opacity:0;transform:translateY(-100%)}}</style>` : ''
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(productName)}</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#f9fafb;color:#111827;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{max-width:520px;width:100%;margin:24px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);overflow:hidden}
.header{padding:32px 32px 24px;text-align:center;background:${isDownsell ? '#fef3c7' : '#eff6ff'};border-bottom:1px solid ${isDownsell ? '#fde68a' : '#bfdbfe'}}
.header h1{margin:0 0 8px;font-size:24px;font-weight:700}
.header .tag{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:${isDownsell ? '#92400e' : '#1d4ed8'};margin-bottom:12px;display:inline-block}
.body{padding:32px}
.price{font-size:36px;font-weight:800;text-align:center;margin:16px 0}
.price .currency{font-size:18px;vertical-align:super}
.desc{font-size:15px;line-height:1.6;color:#4b5563;margin-bottom:24px}
.btn-accept{display:block;width:100%;padding:16px;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;background:#16a34a;color:#fff;margin-bottom:12px}
.btn-accept:hover{background:#15803d}
.btn-decline{display:block;width:100%;padding:12px;border:none;background:none;font-size:13px;color:#9ca3af;cursor:pointer;text-decoration:underline}
.btn-decline:hover{color:#6b7280}
@media(max-width:640px){.card{margin:0;border-radius:0;min-height:100vh}.header{padding:24px 20px 20px}.header h1{font-size:20px}.body{padding:24px 20px}.price{font-size:28px}}
</style></head><body>
${successBanner}
<div class="card">
  <div class="header"><span class="tag">${isDownsell ? 'Wait — special offer' : 'One-time offer'}</span><h1>${escapeHtml(productName)}</h1></div>
  <div class="body">
    <div class="price"><span class="currency">$</span>${Number(productPrice).toFixed(2)}</div>
    <p class="desc">${escapeHtml(description)}</p>
    <div id="funnel-btns">
      <button class="btn-accept" onclick="_funnelAct('accept')">✓ ${escapeHtml(acceptText)}</button>
      <button class="btn-decline" onclick="_funnelAct('decline')">${escapeHtml(declineText)}</button>
    </div>
    ${config.guarantee ? `<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:12px">&#128274; ${escapeHtml(config.guarantee)}</p>` : ''}
    <div id="funnel-loading" style="display:none;text-align:center;padding:20px;color:#6b7280">Processing...</div>
  </div>
</div>
${upsellScript}
</body></html>`
        response = new Response(html, { headers: { 'Content-Type': 'text/html' } })
      }
    } else if (currentStep.step_type === 'thank_you') {
      await query('UPDATE funnel_sessions SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4', ['completed', new Date(), new Date(), session.id])

      // If a custom thank-you landing page is linked, use it
      if (currentStep.page_id) {
        const page = await queryOne('SELECT * FROM landing_pages WHERE id = $1 AND status = $2', [currentStep.page_id, 'published'])
        if (page?.published_html) {
          response = new Response(page.published_html, { headers: { 'Content-Type': 'text/html' } })
        }
      }

      // Default thank-you page (when no custom page is linked)
      if (!response) {
        const orders = await query(
          'SELECT fo.*, p.name as product_name FROM funnel_orders fo LEFT JOIN products p ON p.id = fo.product_id WHERE fo.session_id = $1 ORDER BY fo.created_at',
          [session.id]
        )
        const hasPurchases = orders.some((o: any) => o.status === 'succeeded')
        const defaultMessage = hasPurchases ? 'Thank you for your purchase!' : 'Thank you for signing up!'
        const message = config.message || defaultMessage

        const safeMsg = escapeHtml(message)
        const orderRows = orders.filter((o: any) => o.status === 'succeeded').map((o: any) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(o.product_name || o.order_type)}</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right">$${Number(o.amount).toFixed(2)}</td></tr>`
        ).join('')
        const total = orders.filter((o: any) => o.status === 'succeeded').reduce((s: number, o: any) => s + Number(o.amount), 0)
        const summaryHtml = hasPurchases ? `<div style="margin-top:32px;max-width:400px;margin-left:auto;margin-right:auto;text-align:left"><h2 style="font-size:14px;color:#6b7280;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Order Summary</h2><table style="width:100%;border-collapse:collapse">${orderRows}<tr><td style="padding:12px 0;font-weight:700">Total</td><td style="padding:12px 0;font-weight:700;text-align:right">$${total.toFixed(2)}</td></tr></table></div>` : ''

        const downloadHtml = config.downloadUrl ? `<a href="${escapeHtml(config.downloadUrl)}" style="display:inline-block;padding:14px 28px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-top:24px">Download</a>` : ''
        const ctaHtml = config.ctaText && config.ctaUrl ? `<a href="${escapeHtml(config.ctaUrl)}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px">${escapeHtml(config.ctaText)}</a>` : ''

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank You</title>
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,system-ui,sans-serif;margin:0;background:#f9fafb;color:#111827}</style>
</head><body><div style="text-align:center;padding:48px;max-width:600px"><h1 style="font-size:1.5rem;margin-bottom:16px">${safeMsg}</h1>${downloadHtml}${summaryHtml}${ctaHtml}</div></body></html>`
        response = new Response(html, { headers: { 'Content-Type': 'text/html' } })
      }
    } else {
      response = new Response('Step not configured', { status: 404 })
    }

    // Inject preview banner for draft funnels
    if (isPreview && response.headers.get('Content-Type')?.includes('text/html')) {
      const body = await response.text()
      const previewBanner = '<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#000;text-align:center;padding:8px 24px;font-size:13px;font-weight:600">PREVIEW MODE — This funnel is not published yet</div><style>body{padding-top:36px!important}</style>'
      const injected = body.replace('<body>', '<body>' + previewBanner).replace('<body ', '<body ' )
      response = new Response(injected, { status: response.status, headers: new Headers(response.headers) })
    }

    // Set cookie
    if (response instanceof NextResponse) {
      response.cookies.set('funnel_vid', visitorId, { httpOnly: true, maxAge: 365 * 24 * 60 * 60, sameSite: 'lax', path: '/' })
    } else {
      const newResponse = new Response(response.body, { status: response.status, headers: new Headers(response.headers) })
      newResponse.headers.append('Set-Cookie', `funnel_vid=${visitorId}; HttpOnly; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax; Path=/`)
      return newResponse
    }
    return response
  } catch (error) {
    console.error('[funnels.public]', error)
    return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } })
  }
}
