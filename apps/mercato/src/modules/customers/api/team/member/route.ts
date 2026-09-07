export const metadata = {
  path: '/team/member',
  DELETE: { requireAuth: true },
}

import { noliTeamManagedResponse } from '../containment'

export async function DELETE() {
  return noliTeamManagedResponse()
}
