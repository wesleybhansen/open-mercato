import { NextResponse } from 'next/server'

// Clean URL proxy: /p/{slug} → /api/landing-pages/public/{slug}
// This gives users a shareable URL like example.com/p/my-page instead of /api/landing-pages/public/my-page
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const url = new URL(req.url)
  const queryString = url.search || ''
  const baseUrl = process.env.APP_URL || url.origin
  return NextResponse.redirect(`${baseUrl}/api/landing-pages/public/${slug}${queryString}`, 307)
}
