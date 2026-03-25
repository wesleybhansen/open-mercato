import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export const metadata = { GET: { requireAuth: false } }

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(req: Request, { params }: { params: { trackingId: string } }) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    await knex('email_messages')
      .where('tracking_id', params.trackingId)
      .whereNull('opened_at')
      .update({ opened_at: new Date(), status: 'opened' })
  } catch (error) {
    console.error('[email.track.open] failed', error)
  }
  return new NextResponse(PIXEL, {
    status: 200,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
  })
}
