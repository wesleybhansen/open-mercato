import { NextResponse } from 'next/server'
import { query, queryOne } from '@/app/api/funnels/db'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    const page = await queryOne(
      'SELECT * FROM landing_pages WHERE slug = $1 AND status = $2 AND deleted_at IS NULL',
      [slug, 'published']
    )

    if (!page || !page.published_html) {
      return new NextResponse('<html><body><h1>Page not found</h1></body></html>', {
        status: 404, headers: { 'Content-Type': 'text/html' },
      })
    }

    // Increment view count
    await query('UPDATE landing_pages SET view_count = view_count + 1 WHERE id = $1', [page.id]).catch(() => {})

    // Inject UTM capture + funnel context script
    const url = new URL(req.url)
    const funnelSid = url.searchParams.get('funnel_sid') || ''
    const funnelStep = url.searchParams.get('funnel_step') || ''
    const funnelSlug = url.searchParams.get('funnel_slug') || ''

    const script = `<script>(function(){try{var p=new URLSearchParams(window.location.search);var u=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];var r=document.referrer||'';document.querySelectorAll('form').forEach(function(f){u.forEach(function(k){var v=p.get(k);if(v){var h=document.createElement('input');h.type='hidden';h.name='_'+k;h.value=v;f.appendChild(h)}});if(r){var rh=document.createElement('input');rh.type='hidden';rh.name='_referrer';rh.value=r;f.appendChild(rh)};${funnelSid ? `var fs=document.createElement('input');fs.type='hidden';fs.name='funnel_sid';fs.value='${funnelSid}';f.appendChild(fs);var ft=document.createElement('input');ft.type='hidden';ft.name='funnel_step';ft.value='${funnelStep}';f.appendChild(ft);var fl=document.createElement('input');fl.type='hidden';fl.name='funnel_slug';fl.value='${funnelSlug}';f.appendChild(fl);` : ''}})}catch(e){}})()</script>`

    const html = page.published_html.includes('</body>')
      ? page.published_html.replace('</body>', script + '</body>')
      : page.published_html + script

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    })
  } catch (error) {
    console.error('[landing-pages.public]', error)
    return new NextResponse('Server error', { status: 500 })
  }
}
