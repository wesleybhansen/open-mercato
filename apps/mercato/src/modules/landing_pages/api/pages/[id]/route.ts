import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { updateLandingPageSchema } from '../../../data/validators'
import { TemplateEngine } from '../../../services/template-engine'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['landing_pages.view'] },
  PUT: { requireAuth: true, requireFeatures: ['landing_pages.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['landing_pages.delete'] },
}

function getScope(ctx: any) {
  const auth = ctx?.auth
  if (!auth?.tenantId || !auth?.orgId) return null
  return { tenantId: auth.tenantId, orgId: auth.orgId, userId: auth.sub }
}

export async function GET(req: Request, ctx: any) {
  const scope = getScope(ctx)
  if (!scope) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const id = ctx.params?.id

    const page = await knex('landing_pages').where('id', id).where('organization_id', scope.orgId).whereNull('deleted_at').first()
    if (!page) return NextResponse.json({ ok: false, error: 'Page not found' }, { status: 404 })

    const forms = await knex('landing_page_forms').where('landing_page_id', id)
    const submissions = await knex('form_submissions').where('landing_page_id', id).orderBy('created_at', 'desc').limit(20)

    return NextResponse.json({ ok: true, data: { ...page, forms, recentSubmissions: submissions } })
  } catch (error) {
    console.error('[landing_pages.get]', error)
    return NextResponse.json({ ok: false, error: 'Failed to get page' }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: any) {
  const scope = getScope(ctx)
  if (!scope) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const id = ctx.params?.id
    const body = await req.json()
    const parsed = updateLandingPageSchema.parse(body)

    const page = await knex('landing_pages').where('id', id).where('organization_id', scope.orgId).whereNull('deleted_at').first()
    if (!page) return NextResponse.json({ ok: false, error: 'Page not found' }, { status: 404 })

    if (parsed.slug && parsed.slug !== page.slug) {
      const dup = await knex('landing_pages').where('slug', parsed.slug).where('organization_id', scope.orgId).whereNull('deleted_at').whereNot('id', id).first()
      if (dup) return NextResponse.json({ ok: false, error: 'Slug already exists' }, { status: 409 })
    }

    const update: Record<string, any> = { updated_at: new Date() }
    if (parsed.title !== undefined) update.title = parsed.title
    if (parsed.slug !== undefined) update.slug = parsed.slug
    if (parsed.templateId !== undefined) update.template_id = parsed.templateId
    if (parsed.templateCategory !== undefined) update.template_category = parsed.templateCategory
    if (parsed.config !== undefined) update.config = JSON.stringify(parsed.config)
    if (parsed.customDomain !== undefined) update.custom_domain = parsed.customDomain
    if (parsed.publishedHtml !== undefined) update.published_html = parsed.publishedHtml
    if (parsed.status !== undefined) update.status = parsed.status

    if (parsed.status === 'published' && (page.template_id || parsed.templateId)) {
      const templateId = parsed.templateId || page.template_id
      const config = parsed.config || (typeof page.config === 'string' ? JSON.parse(page.config) : page.config) || {}
      const baseUrl = process.env.APP_URL || 'http://localhost:3000'
      const slug = parsed.slug || page.slug
      const formAction = `${baseUrl}/api/landing_pages/public/${slug}/submit`

      // Try AI-powered rendering first (if we have AI-generated content)
      let html: string | null = null
      try {
        const { parseTemplate } = await import('../../../services/template-parser')
        const { renderWithContent } = await import('../../../services/content-renderer')
        const schema = parseTemplate(templateId)
        html = renderWithContent(schema, config, { formAction, pageTitle: config.pageTitle || parsed.title || page.title })
      } catch (e) {
        // Fall back to basic template engine
        console.log('[landing_pages.publish] AI renderer failed, using basic engine:', e)
        const engine = new TemplateEngine()
        html = engine.renderTemplate(templateId, {
          ...config,
          formAction,
          pageTitle: config.pageTitle || parsed.title || page.title,
        })
      }

      // Always ensure form handler is injected
      if (html && !html.includes(formAction)) {
        const formScript = `<script>
(function(){document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var d={};new FormData(f).forEach(function(v,k){d[k]=v});var b=f.querySelector('[type="submit"]');if(b){b.disabled=true;b.textContent='Sending...';}fetch('${formAction}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d})}).then(function(r){return r.json()}).then(function(r){if(r.ok){f.innerHTML='<div style="text-align:center;padding:24px"><h3 style="margin-bottom:8px">Thank you!</h3><p>'+(r.message||'We\\'ll be in touch.')+'</p></div>'}}).catch(function(){if(b){b.disabled=false;b.textContent='Try Again'}})})})})();
</script>`
        html = html.replace('</body>', formScript + '\n</body>')
      }

      update.published_html = html
      if (page.status !== 'published') update.published_at = new Date()
    }
    if (parsed.status === 'draft' || parsed.status === 'archived') {
      update.published_html = null
    }

    await knex('landing_pages').where('id', id).update(update)
    const updated = await knex('landing_pages').where('id', id).first()
    return NextResponse.json({ ok: true, data: updated })
  } catch (error) {
    console.error('[landing_pages.update]', error)
    return NextResponse.json({ ok: false, error: 'Failed to update page' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: any) {
  const scope = getScope(ctx)
  if (!scope) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const id = ctx.params?.id

    await knex('landing_pages').where('id', id).where('organization_id', scope.orgId).update({
      deleted_at: new Date(), status: 'archived', published_html: null,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[landing_pages.delete]', error)
    return NextResponse.json({ ok: false, error: 'Failed to delete page' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Landing Pages', summary: 'Landing page detail',
  methods: {
    GET: { summary: 'Get landing page', tags: ['Landing Pages'] },
    PUT: { summary: 'Update landing page', tags: ['Landing Pages'] },
    DELETE: { summary: 'Delete landing page', tags: ['Landing Pages'] },
  },
}
