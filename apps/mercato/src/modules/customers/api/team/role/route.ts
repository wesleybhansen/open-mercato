export const metadata = {
  path: '/team/role',
  PUT: { requireAuth: true },
}

import { noliTeamManagedResponse } from '../containment'

export async function PUT() {
  return noliTeamManagedResponse()
}
