/**
 * Seed a test funnel for prospect walkthrough testing.
 *
 * Funnel: "Digital Marketing Masterclass"
 *   Step 1: Landing page (free guide lead capture)
 *   Step 2: Upsell ($29 mini-course)
 *   Step 3: Downsell ($9 templates if they decline the upsell)
 *   Step 4: Checkout (Stripe)
 *   Step 5: Thank you
 *
 * Run: npx tsx scripts/seed-test-funnel.ts
 */

import { Pool } from 'pg'
import crypto from 'crypto'
import { assemblePage } from '../apps/mercato/src/lib/landing-page-wizard/page-assembler'
import { STYLES } from '../apps/mercato/src/lib/landing-page-wizard/styles'
import type { GeneratedSection, StyleDefinition } from '../apps/mercato/src/lib/landing-page-wizard/types'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://crm:crm_dev_2026@localhost:5432/crm'
const pool = new Pool({ connectionString: DATABASE_URL, max: 3 })

const ORG_ID = 'ca86dc70-95cf-41f8-a5f7-fe695fe74b7e'
const TENANT_ID = '64da439a-e961-459f-afcb-c490c5799461'

function uuid() { return crypto.randomUUID() }
const now = new Date()

// Use the "warm" style for a friendly, inviting feel
const style: StyleDefinition = STYLES.find(s => s.id === 'warm')!

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const mainProductId = uuid()   // Free guide (lead magnet — no price)
const upsellProductId = uuid()  // $29 mini-course
const downsellProductId = uuid() // $9 templates pack

async function createProducts() {
  await pool.query(
    `INSERT INTO products (id, tenant_id, organization_id, name, description, price, currency, billing_type, product_type, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [upsellProductId, TENANT_ID, ORG_ID, 'Digital Marketing Masterclass — Mini Course',
     'A 5-module video course covering Facebook Ads, SEO basics, email sequences, conversion copywriting, and analytics dashboards. Lifetime access included.',
     29.00, 'USD', 'one_time', 'digital', true, now, now]
  )
  await pool.query(
    `INSERT INTO products (id, tenant_id, organization_id, name, description, price, currency, billing_type, product_type, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [downsellProductId, TENANT_ID, ORG_ID, 'Marketing Templates Starter Pack',
     '27 ready-to-use marketing templates: email sequences, ad copy, social media calendars, and landing page wireframes.',
     9.00, 'USD', 'one_time', 'digital', true, now, now]
  )
  console.log('✓ Products created')
}

// ---------------------------------------------------------------------------
// Landing Pages
// ---------------------------------------------------------------------------
const leadPageId = uuid()
const leadPageSlug = `test-funnel-free-guide-${Date.now()}`
const upsellPageId = uuid()
const upsellPageSlug = `test-funnel-upsell-${Date.now()}`
const downsellPageId = uuid()
const downsellPageSlug = `test-funnel-downsell-${Date.now()}`
const checkoutPageId = uuid()
const checkoutPageSlug = `test-funnel-checkout-${Date.now()}`

// ---------- Lead Capture Page ----------
const leadSections: GeneratedSection[] = [
  {
    type: 'hero',
    headline: 'The 7 Marketing Shortcuts That Tripled Our Revenue in 90 Days',
    subtitle: 'Download the free playbook used by 12,000+ small business owners to get more leads, close more deals, and stop wasting money on ads that don\'t convert.',
    ctaText: 'Get My Free Playbook',
  },
  {
    type: 'pain-points',
    headline: 'Sound Familiar?',
    items: [
      { title: 'Burning cash on ads with no ROI', description: 'You\'ve tried Facebook Ads and Google Ads but the numbers never add up.' },
      { title: 'Posting on social media into the void', description: 'Hours spent creating content, but crickets when it comes to engagement or leads.' },
      { title: 'Your competitors are outranking you', description: 'They\'re not smarter — they just know the shortcuts you haven\'t found yet.' },
      { title: 'No system to turn visitors into customers', description: 'Traffic comes and goes, but you have no repeatable process to capture and convert.' },
    ],
  },
  {
    type: 'features-benefits',
    headline: 'Inside the Free Playbook',
    items: [
      { title: 'The $5/Day Ad Formula', description: 'How to run profitable Facebook ads on a shoestring budget — tested across 200+ campaigns.' },
      { title: 'SEO Quick Wins', description: '3 changes you can make today to start ranking on page one within 30 days.' },
      { title: 'The Email Money Machine', description: 'A 5-email welcome sequence template that converts subscribers into buyers at 8-12%.' },
      { title: 'Conversion Copy Cheat Sheet', description: 'Fill-in-the-blank headlines, CTAs, and landing page formulas that actually work.' },
      { title: 'Analytics Dashboard Setup', description: 'Know exactly which channels bring revenue — stop guessing, start measuring.' },
    ],
  },
  {
    type: 'testimonials',
    headline: 'What Others Are Saying',
    items: [
      { title: 'Sarah K., E-commerce Owner', description: '"I implemented shortcut #3 and got 47 new leads in my first week. This playbook is gold."' },
      { title: 'Marcus T., SaaS Founder', description: '"Finally, marketing advice that\'s actionable, not just theory. We cut our CPA by 60%."' },
      { title: 'Priya M., Freelance Consultant', description: '"The email sequence template alone was worth 10x. I\'ve been sending it for 3 months and it converts like crazy."' },
    ],
  },
  {
    type: 'faq',
    headline: 'Questions? We\'ve Got Answers',
    faqItems: [
      { question: 'Is this really free?', answer: 'Yes, 100% free. No credit card required. We created this playbook to help small business owners get started with proven marketing strategies.' },
      { question: 'How long will it take to see results?', answer: 'Most people see their first results within 7-14 days of implementing the strategies. The SEO quick wins can start showing results within 30 days.' },
      { question: 'Is this for beginners or advanced marketers?', answer: 'Both! Beginners will love the step-by-step approach, and experienced marketers will find new angles and optimizations they haven\'t tried.' },
    ],
  },
  {
    type: 'cta-block',
    headline: 'Ready to Transform Your Marketing?',
    subtitle: 'Join 12,000+ business owners who already have their copy. Download the free playbook now.',
    ctaText: 'Get My Free Playbook',
  },
]

// ---------- Upsell Page (Mini Course $29) ----------
const upsellSections: GeneratedSection[] = [
  {
    type: 'hero',
    headline: 'Go Deeper: The Digital Marketing Masterclass',
    subtitle: 'You loved the playbook — now get the full system. 5 video modules, hands-on templates, and a private community to accelerate your results.',
    ctaText: 'Yes! I Want the Masterclass — $29',
  },
  {
    type: 'features-benefits',
    headline: 'What You Get Inside the Masterclass',
    items: [
      { title: 'Module 1: Facebook & Instagram Ads Mastery', description: 'Advanced targeting, retargeting funnels, and scaling strategies that work in 2026.' },
      { title: 'Module 2: SEO That Actually Ranks', description: 'Keyword research, on-page optimization, and link building — no fluff, just results.' },
      { title: 'Module 3: Email Marketing Automation', description: 'Build sequences that nurture leads on autopilot and turn subscribers into repeat buyers.' },
      { title: 'Module 4: Conversion Copywriting', description: 'Write headlines, ads, and landing pages that convert — with proven frameworks and swipe files.' },
      { title: 'Module 5: Analytics & Optimization', description: 'Set up dashboards, track ROI, and make data-driven decisions that grow revenue.' },
    ],
  },
  {
    type: 'pricing',
    headline: 'Special One-Time Offer',
    price: '$29',
    priceNote: 'One-time payment — lifetime access',
    ctaText: 'Get Instant Access',
    guaranteeText: '30-Day Money-Back Guarantee — No questions asked',
    items: [
      { title: '5 HD Video Modules', description: 'Over 4 hours of hands-on training' },
      { title: '27 Done-For-You Templates', description: 'Ads, emails, landing pages, and more' },
      { title: 'Private Community Access', description: 'Get feedback and support from fellow marketers' },
      { title: 'Lifetime Updates', description: 'New modules added quarterly at no extra cost' },
      { title: 'Bonus: Campaign Audit Checklist', description: 'Find and fix leaks in your current marketing' },
    ],
  },
  {
    type: 'testimonials',
    headline: 'Students Love the Masterclass',
    items: [
      { title: 'Jake R., Agency Owner', description: '"I\'ve taken courses 5x more expensive that taught half as much. The Facebook Ads module alone paid for itself in a day."' },
      { title: 'Lisa W., Shopify Store Owner', description: '"My email open rates went from 12% to 38% after implementing Module 3. This course is ridiculously underpriced."' },
    ],
  },
]

// ---------- Downsell Page (Templates $9) ----------
const downsellSections: GeneratedSection[] = [
  {
    type: 'hero',
    headline: 'Not Ready for the Full Course? Grab the Templates Instead',
    subtitle: 'Get all 27 marketing templates from the Masterclass — ad copy, email sequences, landing page wireframes, and social calendars — for just $9.',
    ctaText: 'Yes! I Want the Templates — Just $9',
  },
  {
    type: 'features-benefits',
    headline: 'What\'s in the Templates Pack',
    items: [
      { title: '12 Email Sequence Templates', description: 'Welcome series, cart abandonment, re-engagement, and promotion sequences ready to customize.' },
      { title: '8 Ad Copy Templates', description: 'Facebook, Instagram, and Google Ad copy that\'s been tested across thousands of dollars in spend.' },
      { title: '4 Landing Page Wireframes', description: 'Proven page layouts for lead capture, sales, webinar registration, and thank you pages.' },
      { title: '3 Social Media Calendars', description: '30-day content calendars for Instagram, LinkedIn, and Twitter/X with post ideas and hashtags.' },
    ],
  },
  {
    type: 'pricing',
    headline: 'Limited-Time Offer',
    price: '$9',
    priceNote: 'One-time payment — instant download',
    ctaText: 'Get the Templates Now',
    guaranteeText: '30-Day Money-Back Guarantee',
    items: [
      { title: '27 Ready-To-Use Templates', description: 'Copy, paste, customize, and launch' },
      { title: 'Google Docs & Notion Formats', description: 'Use in your favorite tools' },
      { title: 'Free Updates for Life', description: 'New templates added every quarter' },
    ],
  },
]

// ---------- Checkout Page ----------
const checkoutSections: GeneratedSection[] = [
  {
    type: 'hero',
    headline: 'You\'re Almost There!',
    subtitle: 'Complete your purchase to get instant access to everything.',
    ctaText: 'Proceed to Payment',
  },
]

async function createLandingPages() {
  const pages = [
    {
      id: leadPageId,
      slug: leadPageSlug,
      title: 'Free Marketing Playbook',
      category: 'capture-leads',
      pageType: 'capture-leads' as const,
      sections: leadSections,
      formFields: [
        { label: 'Name', type: 'text', required: true },
        { label: 'Email', type: 'email', required: true },
      ],
    },
    {
      id: upsellPageId,
      slug: upsellPageSlug,
      title: 'Digital Marketing Masterclass — Upsell',
      category: 'upsell',
      pageType: 'upsell' as const,
      sections: upsellSections,
      formFields: [],
    },
    {
      id: downsellPageId,
      slug: downsellPageSlug,
      title: 'Marketing Templates — Downsell',
      category: 'downsell',
      pageType: 'downsell' as const,
      sections: downsellSections,
      formFields: [],
    },
    {
      id: checkoutPageId,
      slug: checkoutPageSlug,
      title: 'Checkout',
      category: 'funnel-checkout',
      pageType: 'funnel-checkout' as const,
      sections: checkoutSections,
      formFields: [
        { label: 'Name', type: 'text', required: true },
        { label: 'Email', type: 'email', required: true },
      ],
    },
  ]

  for (const page of pages) {
    const html = assemblePage({
      sections: page.sections,
      style,
      pageTitle: page.title,
      metaDescription: `Test funnel page: ${page.title}`,
      formFields: page.formFields,
      formAction: `/api/landing-pages/public/${page.slug}/submit`,
      slug: page.slug,
      businessName: 'GrowthLab',
      pageType: page.pageType,
      productId: null,
      heroImageUrl: null,
    })

    await pool.query(
      `INSERT INTO landing_pages (id, tenant_id, organization_id, title, slug, template_id, template_category, status, config, published_html, published_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        page.id, TENANT_ID, ORG_ID, page.title, page.slug,
        'custom', page.category, 'published',
        JSON.stringify({ sections: page.sections, style: style.id, pageType: page.pageType }),
        html, now, now, now,
      ]
    )
    console.log(`✓ Landing page created: ${page.title} → /api/landing-pages/public/${page.slug}`)
  }

  // Create the form for the lead capture page
  await pool.query(
    `INSERT INTO landing_page_forms (id, tenant_id, organization_id, landing_page_id, name, fields, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      uuid(), TENANT_ID, ORG_ID, leadPageId, 'default',
      JSON.stringify([
        { name: 'name', type: 'text', label: 'Name', required: true },
        { name: 'email', type: 'email', label: 'Email', required: true },
      ]),
      now, now,
    ]
  )
  console.log('✓ Lead capture form created')
}

// ---------------------------------------------------------------------------
// Funnel + Steps
// ---------------------------------------------------------------------------
const funnelId = uuid()
const funnelSlug = 'marketing-masterclass'

// Step IDs (needed for branching)
const stepLandingId = uuid()
const stepUpsellId = uuid()
const stepDownsellId = uuid()
const stepCheckoutId = uuid()
const stepThankYouId = uuid()

async function createFunnel() {
  // Check if slug already exists
  const existing = await pool.query('SELECT id FROM funnels WHERE slug = $1 AND organization_id = $2', [funnelSlug, ORG_ID])
  if (existing.rows.length > 0) {
    console.log('⚠ Funnel with slug "marketing-masterclass" already exists. Deleting and recreating...')
    await pool.query('DELETE FROM funnels WHERE id = $1', [existing.rows[0].id])
  }

  await pool.query(
    `INSERT INTO funnels (id, tenant_id, organization_id, name, slug, is_published, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [funnelId, TENANT_ID, ORG_ID, 'Digital Marketing Masterclass', funnelSlug, true, now, now]
  )

  const steps = [
    {
      id: stepLandingId, order: 1, type: 'page', name: 'Free Playbook (Lead Capture)',
      pageId: leadPageId, productId: null,
      onAccept: null, onDecline: null,
      config: {},
    },
    {
      id: stepUpsellId, order: 2, type: 'upsell', name: 'Masterclass Upsell ($29)',
      pageId: upsellPageId, productId: upsellProductId,
      onAccept: stepCheckoutId, onDecline: stepDownsellId,
      config: {
        headline: 'Digital Marketing Masterclass',
        price: 29,
        description: '5 video modules + 27 templates + private community. Lifetime access.',
        accept_button_text: 'Yes! I Want the Masterclass — $29',
        decline_button_text: 'No thanks, I\'ll skip this',
      },
    },
    {
      id: stepDownsellId, order: 3, type: 'downsell', name: 'Templates Downsell ($9)',
      pageId: downsellPageId, productId: downsellProductId,
      onAccept: stepCheckoutId, onDecline: stepCheckoutId,
      config: {
        headline: 'Marketing Templates Starter Pack',
        price: 9,
        description: '27 ready-to-use marketing templates. Copy, paste, and launch.',
        accept_button_text: 'Yes! Give Me the Templates — $9',
        decline_button_text: 'No thanks, take me to checkout',
      },
    },
    {
      id: stepCheckoutId, order: 4, type: 'checkout', name: 'Checkout',
      pageId: null, productId: upsellProductId,  // fallback product if cart empty
      onAccept: null, onDecline: null,
      config: {},
    },
    {
      id: stepThankYouId, order: 5, type: 'thank_you', name: 'Thank You',
      pageId: null, productId: null,
      onAccept: null, onDecline: null,
      config: {
        message: 'Thank you for your purchase! 🎉 Check your email for instant access to your materials.',
        downloadUrl: null,
        ctaText: 'Go to Dashboard',
        ctaUrl: '/',
      },
    },
  ]

  for (const step of steps) {
    await pool.query(
      `INSERT INTO funnel_steps (id, funnel_id, step_order, step_type, name, page_id, product_id, on_accept_step_id, on_decline_step_id, config, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [step.id, funnelId, step.order, step.type, step.name, step.pageId, step.productId, step.onAccept, step.onDecline, JSON.stringify(step.config), now]
    )
  }

  console.log(`✓ Funnel created: "${funnelSlug}" with ${steps.length} steps`)
  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  FUNNEL READY FOR TESTING')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('')
  console.log('  Public URL:')
  console.log(`  http://localhost:3000/api/funnels/public/${funnelSlug}`)
  console.log('')
  console.log('  Preview URL (works even if unpublished):')
  console.log(`  http://localhost:3000/api/funnels/public/${funnelSlug}?preview=1`)
  console.log('')
  console.log('  Flow:')
  console.log('  1. Landing page → enter name/email → submit')
  console.log('  2. Upsell ($29 Masterclass) → "Yes" or "No thanks"')
  console.log('  3. If declined → Downsell ($9 Templates) → "Yes" or "No thanks"')
  console.log('  4. Checkout → Stripe (email pre-filled, skips form if email captured)')
  console.log('  5. Thank You page with order summary')
  console.log('')
  console.log('  Individual page previews:')
  console.log(`  Lead:     http://localhost:3000/api/landing-pages/public/${leadPageSlug}`)
  console.log(`  Upsell:   http://localhost:3000/api/landing-pages/public/${upsellPageSlug}`)
  console.log(`  Downsell: http://localhost:3000/api/landing-pages/public/${downsellPageSlug}`)
  console.log('')
}

async function main() {
  try {
    await createProducts()
    await createLandingPages()
    await createFunnel()
  } catch (err) {
    console.error('ERROR:', err)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
