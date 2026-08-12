export const metadata = {
  path: '/team',
  GET: { requireAuth: true },
  POST: { requireAuth: true },
}

import { noliTeamManagedResponse } from './containment'

export async function GET() {
  return noliTeamManagedResponse()
}

export async function POST() {
  return noliTeamManagedResponse()
}
