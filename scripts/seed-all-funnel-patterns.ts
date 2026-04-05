/**
 * Seed all funnel patterns for comprehensive testing.
 * Run: npx tsx scripts/seed-all-funnel-patterns.ts
 */

import { Pool } from 'pg'
import crypto from 'crypto'
import { assemblePage } from '../apps/mercato/src/lib/landing-page-wizard/page-assembler'
import { STYLES } from '../apps/mercato/src/lib/landing-page-wizard/styles'
import type { GeneratedSection, StyleDefinition } from '../apps/mercato/src/lib/landing-page-wizard/types'

const pool = new Pool({ connectionString: 'postgres://crm:crm_dev_2026@localhost:5432/crm', max: 3 })
const ORG_ID = 'ca86dc70-95cf-41f8-a5f7-fe695fe74b7e'
const TENANT_ID = '64da439a-e961-459f-afcb-c490c5799461'
const style: StyleDefinition = STYLES.find(s => s.id === 'warm')!
const now = new Date()
function uuid() { return crypto.randomUUID() }

// Shared products
const courseProductId = uuid()    // $49 course
const templateProductId = uuid()  // $19 templates upsell
const liteProductId = uuid()      // $9 lite downsell
const consultProductId = uuid()   // $199 consulting

async function createProducts() {
  const products = [
    [courseProductId, 'Online Marketing Course', 'Complete 8-module marketing course with lifetime access.', 49.00],
    [templateProductId, 'Pro Templates Bundle', '50 premium marketing templates for ads, emails, and landing pages.', 19.00],
    [liteProductId, 'Starter Templates', '15 essential marketing templates to get started.', 9.00],
    [consultProductId, '1-on-1 Strategy Session', '60-minute personalized marketing strategy call with an expert.', 199.00],
  ] as const

  for (const [id, name, desc, price] of products) {
    await pool.query(
      `INSERT INTO products (id, tenant_id, organization_id, name, description, price, currency, billing_type, product_type, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING`,
      [id, TENANT_ID, ORG_ID, name, desc, price, 'USD', 'one_time', 'digital', true, now, now]
    )
  }
  console.log('✓ Products created')
}

function makePage(
  id: string, slug: string, title: string, pageType: string,
  sections: GeneratedSection[],
  formFields: { label: string; type: string; required: boolean }[] = [],
  productId?: string | null
) {
  const html = assemblePage({
    sections, style, pageTitle: title,
    metaDescription: `Test: ${title}`,
    formFields,
    formAction: `/api/landing-pages/public/${slug}/submit`,
    slug, businessName: 'GrowthLab',
    pageType, productId: productId || null, heroImageUrl: null,
  })
  return { id, slug, title, pageType, html, sections }
}

async function insertPage(page: ReturnType<typeof makePage>, category: string) {
  await pool.query(
    `INSERT INTO landing_pages (id, tenant_id, organization_id, title, slug, template_id, template_category, status, config, published_html, published_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT DO NOTHING`,
    [page.id, TENANT_ID, ORG_ID, page.title, page.slug, 'custom', category, 'published',
     JSON.stringify({ sections: page.sections, style: style.id, pageType: page.pageType }),
     page.html, now, now, now]
  )
}

async function insertForm(pageId: string) {
  await pool.query(
    `INSERT INTO landing_page_forms (id, tenant_id, organization_id, landing_page_id, name, fields, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [uuid(), TENANT_ID, ORG_ID, pageId, 'default',
     JSON.stringify([
       { name: 'name', type: 'text', label: 'Name', required: true },
       { name: 'email', type: 'email', label: 'Email', required: true },
     ]), now, now]
  )
}

async function createFunnel(name: string, slug: string, steps: any[]) {
  const existing = await pool.query('SELECT id FROM funnels WHERE slug = $1 AND organization_id = $2', [slug, ORG_ID])
  if (existing.rows.length > 0) {
    await pool.query('DELETE FROM funnels WHERE id = $1', [existing.rows[0].id])
  }
  const funnelId = uuid()
  await pool.query(
    `INSERT INTO funnels (id, tenant_id, organization_id, name, slug, is_published, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [funnelId, TENANT_ID, ORG_ID, name, slug, true, now, now]
  )
  for (const step of steps) {
    await pool.query(
      `INSERT INTO funnel_steps (id, funnel_id, step_order, step_type, name, page_id, product_id, on_accept_step_id, on_decline_step_id, config, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [step.id, funnelId, step.order, step.type, step.name, step.pageId || null, step.productId || null,
       step.onAccept || null, step.onDecline || null, JSON.stringify(step.config || {}), now]
    )
  }
  return funnelId
}

// ===========================================================================
// PATTERN 1: Free Lead Magnet → Upsell → Downsell → Checkout → Thank You
// ===========================================================================
async function pattern1() {
  const prefix = 'p1'
  const leadPage = makePage(uuid(), `${prefix}-lead-${Date.now()}`, 'Free Marketing Guide', 'capture-leads', [
    { type: 'hero', headline: 'Get the Free Marketing Guide', subtitle: 'Learn the 5 strategies top marketers use.', ctaText: 'Download Free Guide' },
    { type: 'cta-block', headline: 'Get Your Free Copy Now', ctaText: 'Download Free Guide' },
  ], [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }])

  const upsellPage = makePage(uuid(), `${prefix}-upsell-${Date.now()}`, 'Course Upsell', 'upsell', [
    { type: 'hero', headline: 'Go Deeper: Full Marketing Course', subtitle: '8 video modules + templates. One-time $49.', ctaText: 'Yes! Get the Course — $49' },
    { type: 'pricing', headline: 'Special Offer', price: '$49', priceNote: 'One-time payment', ctaText: 'Get Instant Access', guaranteeText: '30-Day Money-Back Guarantee',
      items: [{ title: '8 Video Modules', description: '6+ hours of training' }, { title: 'Templates Included', description: 'Ads, emails, pages' }] },
  ])

  const downsellPage = makePage(uuid(), `${prefix}-downsell-${Date.now()}`, 'Templates Downsell', 'downsell', [
    { type: 'hero', headline: 'Not ready for the course? Grab the templates.', subtitle: '15 essential templates for just $9.', ctaText: 'Yes! Get Templates — $9' },
    { type: 'pricing', headline: 'Limited Offer', price: '$9', priceNote: 'One-time', ctaText: 'Get Templates', guaranteeText: '30-Day Guarantee',
      items: [{ title: '15 Templates', description: 'Emails, ads, pages' }] },
  ])

  await insertPage(leadPage, 'capture-leads')
  await insertForm(leadPage.id)
  await insertPage(upsellPage, 'upsell')
  await insertPage(downsellPage, 'downsell')

  const stepIds = { lead: uuid(), upsell: uuid(), downsell: uuid(), checkout: uuid(), thanks: uuid() }
  await createFunnel('Pattern 1: Free Lead → Upsell → Downsell', 'test-pattern-1', [
    { id: stepIds.lead, order: 1, type: 'page', name: 'Free Guide', pageId: leadPage.id },
    { id: stepIds.upsell, order: 2, type: 'upsell', name: 'Course ($49)', pageId: upsellPage.id, productId: courseProductId,
      onAccept: stepIds.checkout, onDecline: stepIds.downsell,
      config: { headline: 'Marketing Course', price: 49, accept_button_text: 'Yes! Get the Course — $49', decline_button_text: "No thanks" } },
    { id: stepIds.downsell, order: 3, type: 'downsell', name: 'Templates ($9)', pageId: downsellPage.id, productId: liteProductId,
      onAccept: stepIds.checkout, onDecline: stepIds.checkout,
      config: { headline: 'Starter Templates', price: 9, accept_button_text: 'Yes! Get Templates — $9', decline_button_text: "No thanks, skip" } },
    { id: stepIds.checkout, order: 4, type: 'checkout', name: 'Checkout', config: {} },
    { id: stepIds.thanks, order: 5, type: 'thank_you', name: 'Thank You', config: { message: 'Thank you! Check your email for access.' } },
  ])

  console.log(`✓ Pattern 1: /api/funnels/public/test-pattern-1`)
  return { slug: 'test-pattern-1', stepIds, leadSlug: leadPage.slug }
}

// ===========================================================================
// PATTERN 2: Paid Product → Upsell → Checkout → Thank You
// ===========================================================================
async function pattern2() {
  const prefix = 'p2'
  const sellPage = makePage(uuid(), `${prefix}-sell-${Date.now()}`, 'Marketing Course', 'sell-digital', [
    { type: 'hero', headline: 'Master Digital Marketing in 30 Days', subtitle: 'The complete course for entrepreneurs.', ctaText: 'Buy Now — $49' },
    { type: 'pricing', headline: 'Get Started Today', price: '$49', priceNote: 'One-time payment — lifetime access', ctaText: 'Buy Now',
      guaranteeText: '30-Day Money-Back Guarantee',
      items: [{ title: '8 Modules', description: 'Self-paced' }, { title: 'Templates', description: 'Included' }] },
  ], [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }], courseProductId)

  const upsellPage = makePage(uuid(), `${prefix}-upsell-${Date.now()}`, 'Consulting Upsell', 'upsell', [
    { type: 'hero', headline: 'Add a 1-on-1 Strategy Session', subtitle: 'Get personalized guidance from an expert. $199 one-time.', ctaText: 'Yes! Add Strategy Session — $199' },
    { type: 'pricing', headline: 'Exclusive Add-On', price: '$199', priceNote: 'One-time', ctaText: 'Add to Order', guaranteeText: 'Satisfaction Guaranteed',
      items: [{ title: '60-Minute Call', description: 'Personalized strategy' }, { title: 'Action Plan', description: 'Custom roadmap' }] },
  ])

  await insertPage(sellPage, 'sell-digital')
  await insertForm(sellPage.id)
  await insertPage(upsellPage, 'upsell')

  const stepIds = { sell: uuid(), upsell: uuid(), checkout: uuid(), thanks: uuid() }
  await createFunnel('Pattern 2: Paid Product → Upsell', 'test-pattern-2', [
    { id: stepIds.sell, order: 1, type: 'page', name: 'Course ($49)', pageId: sellPage.id, productId: courseProductId },
    { id: stepIds.upsell, order: 2, type: 'upsell', name: 'Strategy Session ($199)', pageId: upsellPage.id, productId: consultProductId,
      onAccept: stepIds.checkout, onDecline: stepIds.checkout,
      config: { headline: '1-on-1 Strategy Session', price: 199, accept_button_text: 'Yes! Add Session — $199', decline_button_text: "No thanks" } },
    { id: stepIds.checkout, order: 3, type: 'checkout', name: 'Checkout', config: {} },
    { id: stepIds.thanks, order: 4, type: 'thank_you', name: 'Thank You', config: { message: 'Thank you for your purchase! Check your email.' } },
  ])

  console.log(`✓ Pattern 2: /api/funnels/public/test-pattern-2`)
  return { slug: 'test-pattern-2', stepIds, sellSlug: sellPage.slug }
}

// ===========================================================================
// PATTERN 3: Simple — Page → Checkout → Thank You (no upsell/downsell)
// ===========================================================================
async function pattern3() {
  const prefix = 'p3'
  const sellPage = makePage(uuid(), `${prefix}-sell-${Date.now()}`, 'Pro Templates', 'sell-digital', [
    { type: 'hero', headline: 'Get 50 Pro Marketing Templates', subtitle: 'Everything you need to launch your marketing. $19 one-time.', ctaText: 'Buy Now — $19' },
    { type: 'pricing', headline: 'One-Time Purchase', price: '$19', priceNote: 'Instant download', ctaText: 'Buy Now', guaranteeText: '30-Day Guarantee',
      items: [{ title: '50 Templates', description: 'Ads, emails, pages, social' }, { title: 'Free Updates', description: 'Quarterly additions' }] },
  ], [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }], templateProductId)

  await insertPage(sellPage, 'sell-digital')
  await insertForm(sellPage.id)

  const stepIds = { sell: uuid(), checkout: uuid(), thanks: uuid() }
  await createFunnel('Pattern 3: Simple Product Sale', 'test-pattern-3', [
    { id: stepIds.sell, order: 1, type: 'page', name: 'Templates ($19)', pageId: sellPage.id, productId: templateProductId },
    { id: stepIds.checkout, order: 2, type: 'checkout', name: 'Checkout', productId: templateProductId, config: {} },
    { id: stepIds.thanks, order: 3, type: 'thank_you', name: 'Thank You', config: { message: 'Thank you! Your templates are on the way.' } },
  ])

  console.log(`✓ Pattern 3: /api/funnels/public/test-pattern-3`)
  return { slug: 'test-pattern-3', stepIds, sellSlug: sellPage.slug }
}

// ===========================================================================
// PATTERN 4: Free Lead → Checkout (no upsell) — simple lead gen with optional purchase
// ===========================================================================
async function pattern4() {
  const prefix = 'p4'
  const leadPage = makePage(uuid(), `${prefix}-lead-${Date.now()}`, 'Free Checklist', 'capture-leads', [
    { type: 'hero', headline: 'Download the Marketing Checklist', subtitle: 'A step-by-step checklist for launching your first campaign.', ctaText: 'Get the Free Checklist' },
  ], [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }])

  await insertPage(leadPage, 'capture-leads')
  await insertForm(leadPage.id)

  const stepIds = { lead: uuid(), thanks: uuid() }
  await createFunnel('Pattern 4: Free Lead Only', 'test-pattern-4', [
    { id: stepIds.lead, order: 1, type: 'page', name: 'Free Checklist', pageId: leadPage.id },
    { id: stepIds.thanks, order: 2, type: 'thank_you', name: 'Thank You', config: { message: 'Thanks for signing up! Check your inbox for the checklist.' } },
  ])

  console.log(`✓ Pattern 4: /api/funnels/public/test-pattern-4`)
  return { slug: 'test-pattern-4', stepIds, leadSlug: leadPage.slug }
}

async function main() {
  try {
    await createProducts()
    const p1 = await pattern1()
    const p2 = await pattern2()
    const p3 = await pattern3()
    const p4 = await pattern4()

    console.log('\n══════════════════════════════════════════════════')
    console.log('  ALL FUNNELS CREATED')
    console.log('══════════════════════════════════════════════════')
    console.log(`  Pattern 1 (free→upsell→downsell): /api/funnels/public/${p1.slug}`)
    console.log(`  Pattern 2 (paid→upsell):          /api/funnels/public/${p2.slug}`)
    console.log(`  Pattern 3 (simple paid):           /api/funnels/public/${p3.slug}`)
    console.log(`  Pattern 4 (free lead only):        /api/funnels/public/${p4.slug}`)
    console.log('')
  } catch (err) {
    console.error('ERROR:', err)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
