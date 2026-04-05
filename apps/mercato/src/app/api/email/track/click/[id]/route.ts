import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackingId } = await params
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url') || '/'

  try {
    await bootstrap()
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    // Update campaign stats
    const message = await knex('email_messages').where('tracking_id', trackingId).first()
    if (message?.campaign_id) {
      const campaign = await knex('email_campaigns').where('id', message.campaign_id).first()
      if (campaign?.stats) {
        const stats = typeof campaign.stats === 'string' ? JSON.parse(campaign.stats) : campaign.stats
        stats.clicked = (stats.clicked || 0) + 1
        await knex('email_campaigns').where('id', message.campaign_id).update({
          stats: JSON.stringify(stats),
        })
      }
    }
  } catch {}

  return NextResponse.redirect(url)
}
