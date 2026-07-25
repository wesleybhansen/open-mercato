import crypto from 'crypto'
import { NextResponse } from 'next/server'

/*
 * The old public-dispatcher/shared-secret endpoint performed best-effort user
 * and organization deletion inside one request while mailbox, send, sync,
 * search, file, and provider state could remain. Keep it fail-closed until the
 * versioned, restartable erasure protocol and exact CRM absence contract are
 * deployed.
 */
export const metadata = {
  path: '/internal/gdpr-delete',
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  const secret = process.env.NOLI_INTERNAL_SERVICE_SECRET
  const got = Buffer.from((req.headers.get('authorization') || '').trim())
  const expected = Buffer.from(secret ? `Bearer ${secret}` : '')
  if (!secret || got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    {
      ok: false,
      code: 'automated_deletion_disabled',
      error: 'Automated deletion is disabled pending durable protocol rollout.',
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': '86400',
      },
    },
  )
}
