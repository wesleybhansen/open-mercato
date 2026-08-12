export const metadata = {
  path: '/invite/accept',
  GET: { requireAuth: true },
  POST: { requireAuth: true },
}

import { retiredLocalInviteResponse } from '../../team/containment'

export async function GET() {
  return retiredLocalInviteResponse()
}

export async function POST() {
  return retiredLocalInviteResponse()
}
