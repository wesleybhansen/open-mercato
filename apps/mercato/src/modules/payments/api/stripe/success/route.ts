export const metadata = { GET: { requireAuth: false } }

import { NextResponse } from 'next/server'

const HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment submitted</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#fff 0%,#f0f0f5 100%);padding:20px}
  .card{text-align:center;padding:48px 40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:460px;width:100%}
  .check{width:72px;height:72px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
  .check svg{width:36px;height:36px;color:#16a34a}
  h1{font-size:24px;font-weight:700;color:#111;margin:0 0 8px}
  p{color:#666;font-size:15px;line-height:1.6;margin:0}
</style>
</head><body><main class="card">
  <div class="check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
  <h1>Payment submitted</h1>
  <p>Your payment is being confirmed. You may close this page.</p>
</main></body></html>`

export async function GET() {
  return new NextResponse(HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
