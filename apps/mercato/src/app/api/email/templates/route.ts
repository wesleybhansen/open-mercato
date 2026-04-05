import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

function makeTemplate(name: string, category: string, html: string) {
  return { name, category, html_template: html, is_default: true }
}

function wrapEmail(preheaderColor: string, bodyContent: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title></title>
<style type="text/css">
@media only screen and (max-width:620px){.wrapper{width:100%!important;padding:0 16px!important}.col{width:100%!important;display:block!important}.hero-text{font-size:22px!important}.btn-td{padding:12px 24px!important}}body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0;mso-table-rspace:0}img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}body{margin:0;padding:0;width:100%!important;background-color:#f4f4f7}
</style>
<!--[if mso]><style>table{border-collapse:collapse}td{font-family:Arial,sans-serif}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<span style="display:none;font-size:1px;color:${preheaderColor};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden"></span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7"><tr><td align="center" style="padding:24px 0">
<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
${bodyContent}
</table>
</td></tr></table>
</body>
</html>`
}

const DEFAULT_TEMPLATES = [
  // 1. Clean — minimal white card, subtle border, clean typography
  makeTemplate('Clean', 'newsletter', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    <tr><td style="padding:40px 40px 40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#6b7280;text-decoration:underline">Email preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 2. Bold — dark colored header banner, white content below
  makeTemplate('Bold', 'announcement', wrapEmail('#1e293b', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{{brand_primary}};border-radius:8px 8px 0 0">
    <tr><td style="padding:20px 40px">&nbsp;</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    <tr><td style="padding:40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 3. Showcase — gradient hero header, white content
  makeTemplate('Showcase', 'product', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,{{brand_primary}},{{brand_secondary}});background-color:{{brand_primary}};border-radius:8px 8px 0 0">
    <tr><td style="padding:20px 40px">&nbsp;</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    <tr><td style="padding:40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 4. Friendly — warm yellow accent header, welcoming feel
  makeTemplate('Friendly', 'onboarding', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    <tr><td style="padding:12px 40px;background-color:#fefce8;border-bottom:1px solid #fde68a">&nbsp;</td></tr>
    <tr><td style="padding:32px 40px 40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 5. Vibrant — red banner header, bold energy
  makeTemplate('Vibrant', 'promotion', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#dc2626;border-radius:8px 8px 0 0">
    <tr><td style="padding:20px 40px">&nbsp;</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    <tr><td style="padding:40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 6. Elegant — sky blue accent, centered subject
  makeTemplate('Elegant', 'event', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    <tr><td style="padding:12px;border-bottom:3px solid #0ea5e9">&nbsp;</td></tr>
    <tr><td style="padding:32px 40px 40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 7. Warm — green accent, left-aligned, personal feel
  makeTemplate('Warm', 'social-proof', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;border-top:4px solid #10b981">
    <tr><td style="padding:40px 40px 40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 8. Professional — indigo left border accent
  makeTemplate('Professional', 'educational', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;border-left:5px solid #6366f1">
    <tr><td style="padding:40px 40px 40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 9. Festive — green gradient header
  makeTemplate('Festive', 'seasonal', wrapEmail('#f4f4f7', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#059669,#047857);background-color:#059669;border-radius:8px 8px 0 0">
    <tr><td style="padding:20px 40px">&nbsp;</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    <tr><td style="padding:40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 0;text-align:center">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),

  // 10. Simple — no frills, just content
  makeTemplate('Simple', 'general', wrapEmail('#ffffff', `
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:40px;font-size:15px;line-height:1.7;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      {{content}}
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb">
  <p style="margin:0;font-size:12px;color:#9ca3af;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"><a href="{{preference_url}}" style="color:#9ca3af;text-decoration:underline">Preferences</a> &bull; <a href="{{unsubscribe_url}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`)),
]

const CATEGORY_COLORS: Record<string, string> = {
  newsletter: '#3B82F6',
  announcement: '#1E293B',
  product: '#8B5CF6',
  onboarding: '#F59E0B',
  promotion: '#DC2626',
  event: '#0EA5E9',
  'social-proof': '#10B981',
  educational: '#6366F1',
  seasonal: '#059669',
  general: '#6B7280',
}

async function seedDefaults(knex: ReturnType<EntityManager['getKnex']>, tenantId: string, orgId: string) {
  const crypto = require('crypto')
  const rows = DEFAULT_TEMPLATES.map(t => ({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    organization_id: orgId,
    name: t.name,
    category: t.category,
    html_template: t.html_template,
    is_default: true,
    created_at: new Date(),
    updated_at: new Date(),
  }))
  await knex('email_style_templates').insert(rows)
}

export async function GET() {
  await bootstrap()
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    let templates = await knex('email_style_templates')
      .where('organization_id', auth.orgId)
      .orderBy([{ column: 'category' }, { column: 'name' }])

    if (templates.length === 0) {
      await seedDefaults(knex, auth.tenantId!, auth.orgId)
      templates = await knex('email_style_templates')
        .where('organization_id', auth.orgId)
        .orderBy([{ column: 'category' }, { column: 'name' }])
    }

    const data = templates.map((t: Record<string, unknown>) => ({
      ...t,
      categoryColor: CATEGORY_COLORS[t.category as string] || CATEGORY_COLORS.general,
    }))

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    console.error('[email.templates.GET]', error)
    return NextResponse.json({ ok: false, error: 'Failed to load templates' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId || !auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const body = await req.json()
    const { name, category, htmlTemplate } = body

    if (!name || !htmlTemplate) {
      return NextResponse.json({ ok: false, error: 'name and htmlTemplate required' }, { status: 400 })
    }

    const crypto = require('crypto')
    const id = crypto.randomUUID()
    await knex('email_style_templates').insert({
      id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId,
      name,
      category: category || 'general',
      html_template: htmlTemplate,
      is_default: false,
      created_by: auth.userId,
      created_at: new Date(),
      updated_at: new Date(),
    })

    return NextResponse.json({ ok: true, data: { id } }, { status: 201 })
  } catch (error) {
    console.error('[email.templates.POST]', error)
    return NextResponse.json({ ok: false, error: 'Failed to create template' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromCookies()
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const template = await knex('email_style_templates')
      .where({ id, organization_id: auth.orgId })
      .first()

    if (!template) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    if (template.is_default) return NextResponse.json({ ok: false, error: 'Cannot delete default templates' }, { status: 403 })

    await knex('email_style_templates').where({ id, organization_id: auth.orgId }).del()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[email.templates.DELETE]', error)
    return NextResponse.json({ ok: false, error: 'Failed to delete template' }, { status: 500 })
  }
}

export const openApi = {
  tag: 'Email',
  summary: 'Email style templates CRUD',
  methods: ['GET', 'POST', 'DELETE'],
}
