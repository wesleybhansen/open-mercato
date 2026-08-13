import crypto from 'crypto'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'

/*
 * Internal server-to-server endpoint (Noli U-53 guided setup). Returns which
 * one-time CRM setup decisions are still open for a noli user's org so the
 * COS opener can propose the next one. Read-only; same shared-secret auth as
 * the other /internal/* endpoints.
 */
export const metadata = {
  path: '/internal/setup-status',
  POST: { requireAuth: false },
}

const SETUP_STATUS_UNAVAILABLE = 'setup_status_unavailable'

function readCount(row: { n?: string | number } | undefined): number {
  const value = row?.n
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(SETUP_STATUS_UNAVAILABLE)
  }
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(SETUP_STATUS_UNAVAILABLE)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(SETUP_STATUS_UNAVAILABLE)
  }
  return parsed
}

function unavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Setup status unavailable',
      code: SETUP_STATUS_UNAVAILABLE,
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: Request) {
  const secret = process.env.NOLI_INTERNAL_SERVICE_SECRET
  const authHeader = (req.headers.get('authorization') || '').trim()
  const expected = secret ? `Bearer ${secret}` : ''
  if (
    !secret ||
    authHeader.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  ) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { noliUserId?: unknown }
  const noliUserId = typeof body.noliUserId === 'string' ? body.noliUserId.trim() : ''
  if (!noliUserId) {
    return NextResponse.json({ ok: false, error: 'noliUserId required' }, { status: 400 })
  }

  try {
    const { findNoliUserById, isEntitled } = await import(
      '@open-mercato/shared/lib/noli/core-client'
    )
    const noliUser = await findNoliUserById(noliUserId)
    if (!noliUser) return NextResponse.json({ exists: false })
    if (!(await isEntitled(noliUser.id, 'crm'))) return NextResponse.json({ exists: false })
    if (!noliUser.clerk_user_id) throw new Error(SETUP_STATUS_UNAVAILABLE)

    const { resolveClerkUserToAuthContext } = await import('@open-mercato/shared/lib/auth/clerk')
    const auth = await resolveClerkUserToAuthContext(noliUser.clerk_user_id)
    if (!auth?.orgId || !auth.tenantId) throw new Error(SETUP_STATUS_UNAVAILABLE)
    const orgId = auth.orgId
    const tenantId = auth.tenantId

    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const count = async (table: string, extra?: (q: ReturnType<typeof knex>) => void) => {
      const q = knex(table)
        .where('organization_id', orgId)
        .where('tenant_id', tenantId)
      if (extra) extra(q as ReturnType<typeof knex>)
      const row = (await q.count({ n: '*' }).first()) as { n?: string | number } | undefined
      return readCount(row)
    }

    const [contacts, landingPages, bookingPages, emailConnections] = await Promise.all([
      count('customer_entities', (q) => void q.whereNull('deleted_at')),
      count('landing_pages'),
      count('booking_pages'),
      count('email_accounts'),
    ])

    return NextResponse.json({
      exists: true,
      hasContacts: contacts > 0,
      hasCapturePage: landingPages > 0 || bookingPages > 0,
      emailConnected: emailConnections > 0,
    })
  } catch {
    console.error('[internal.setup-status] setup_status_unavailable')
    return unavailableResponse()
  }
}
