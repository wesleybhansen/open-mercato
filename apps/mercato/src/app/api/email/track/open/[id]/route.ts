import { bootstrap } from '@/bootstrap'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

// 1x1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackingId } = await params

  // Return pixel immediately, update DB in background
  try {
    await bootstrap()
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    // Update message status
    await knex('email_messages')
      .where('tracking_id', trackingId)
      .whereNot('status', 'opened')
      .update({ status: 'opened' })

    // Update campaign stats
    const message = await knex('email_messages').where('tracking_id', trackingId).first()
    if (message?.campaign_id) {
      const campaign = await knex('email_campaigns').where('id', message.campaign_id).first()
      if (campaign?.stats) {
        const stats = typeof campaign.stats === 'string' ? JSON.parse(campaign.stats) : campaign.stats
        stats.opened = (stats.opened || 0) + 1
        await knex('email_campaigns').where('id', message.campaign_id).update({
          stats: JSON.stringify(stats),
        })
      }

      // Update recipient record
      await knex('email_campaign_recipients')
        .where('campaign_id', message.campaign_id)
        .where('contact_id', message.contact_id)
        .whereNull('opened_at')
        .update({ opened_at: new Date() })
    }
  } catch {}

  return new NextResponse(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
}
