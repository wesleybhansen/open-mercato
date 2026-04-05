/**
 * Regenerate HTML for test funnel landing pages (after page-assembler changes).
 * Run: npx tsx scripts/regen-test-funnel-pages.ts
 */
import { Pool } from 'pg'
import { assemblePage } from '../apps/mercato/src/lib/landing-page-wizard/page-assembler'
import { STYLES } from '../apps/mercato/src/lib/landing-page-wizard/styles'

const pool = new Pool({ connectionString: 'postgres://crm:crm_dev_2026@localhost:5432/crm', max: 3 })
const style = STYLES.find(s => s.id === 'warm')!

async function main() {
  const pages = await pool.query(
    "SELECT id, slug, title, config, template_category FROM landing_pages WHERE slug LIKE 'test-funnel-%' ORDER BY created_at"
  )

  for (const page of pages.rows) {
    const config = typeof page.config === 'string' ? JSON.parse(page.config) : page.config
    const pageType = config.pageType || page.template_category

    const isLeadCapture = pageType === 'capture-leads'
    const isFunnelCheckout = pageType === 'funnel-checkout'
    const formFields = (isLeadCapture || isFunnelCheckout)
      ? [
          { label: 'Name', type: 'text', required: true },
          { label: 'Email', type: 'email', required: true },
        ]
      : []

    const html = assemblePage({
      sections: config.sections,
      style,
      pageTitle: page.title,
      metaDescription: `Test funnel page: ${page.title}`,
      formFields,
      formAction: `/api/landing-pages/public/${page.slug}/submit`,
      slug: page.slug,
      businessName: 'GrowthLab',
      pageType,
      productId: null,
      heroImageUrl: null,
    })

    await pool.query('UPDATE landing_pages SET published_html = $1, updated_at = $2 WHERE id = $3', [html, new Date(), page.id])
    console.log(`✓ Regenerated: ${page.title} (${page.slug})`)
  }

  await pool.end()
  console.log('\nDone. Refresh your browser to see changes.')
}

main().catch(err => { console.error(err); process.exit(1) })
