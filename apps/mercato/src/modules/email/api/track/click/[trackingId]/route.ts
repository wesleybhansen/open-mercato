import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export const metadata = { GET: { requireAuth: false } }

export async function GET(req: Request, { params }: { params: { trackingId: string } }) {
  const url = new URL(req.url)
  const redirectUrl = url.searchParams.get('url')

  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()
    await knex('email_messages')
      .where('tracking_id', params.trackingId)
      .whereNull('clicked_at')
      .update({ clicked_at: new Date(), status: 'clicked' })
  } catch (error) {
    console.error('[email.track.click] failed', error)
  }

  if (redirectUrl) return NextResponse.redirect(redirectUrl, 302)
  return new NextResponse('Redirecting...', { status: 200 })
}
