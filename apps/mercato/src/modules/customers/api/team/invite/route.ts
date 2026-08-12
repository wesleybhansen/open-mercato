export const metadata = {
  path: '/team/invite',
  POST: { requireAuth: true },
  DELETE: { requireAuth: true },
}

import { noliTeamManagedResponse } from '../containment'

export async function POST() {
  return noliTeamManagedResponse()
}

export async function DELETE() {
  return noliTeamManagedResponse()
}
