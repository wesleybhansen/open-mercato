export const metadata = { GET: { requireAuth: false } }
export const openApi = { summary: 'Email unsubscribe redirect', methods: { GET: { summary: 'Redirect to preference center', tags: ['Email'] } } }

import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { signEmailToken, verifyEmailToken } from '@/lib/email-token'

export async function GET(req: Request, { params }: { params: { contactId: string } }) {
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    // The link in every outbound email carries a signed token; a bare contact
    // UUID (they leak in exports, timeline links, screenshots) must not be
    // enough to open someone's preference center and opt them out.
    const presented = new URL(req.url).searchParams.get('t') ?? ''
    const verified = verifyEmailToken(presented)
    if (!verified || verified.contactId !== params.contactId) {
      return new NextResponse('Not found', { status: 404 })
    }
    const contact = await knex('customer_entities')
      .where({ id: params.contactId, organization_id: verified.orgId })
      .first()
    if (!contact) return new NextResponse('Not found', { status: 404 })

    const token = signEmailToken(params.contactId, contact.organization_id)
    const baseUrl = process.env.APP_URL || 'http://localhost:3000'

    // Redirect to the preference center
    return NextResponse.redirect(`${baseUrl}/api/email/preferences/${token}`)
  } catch {
    return new NextResponse('Error', { status: 500 })
  }
}
