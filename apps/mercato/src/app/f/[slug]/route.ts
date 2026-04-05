import { NextResponse } from 'next/server'

// Clean URL proxy: /f/{slug} → /api/funnels/public/{slug}
// This gives users a shareable URL like example.com/f/my-funnel instead of /api/funnels/public/my-funnel
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const url = new URL(req.url)
  const queryString = url.search || ''
  const baseUrl = process.env.APP_URL || url.origin
  return NextResponse.redirect(`${baseUrl}/api/funnels/public/${slug}${queryString}`, 307)
}
