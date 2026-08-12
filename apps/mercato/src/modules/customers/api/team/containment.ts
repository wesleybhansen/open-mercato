import { NextResponse } from 'next/server'

const MANAGE_TEAM_URL = 'https://app.noliai.com/team'

export function noliTeamManagedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Team membership is managed in Noli.',
      manageTeamUrl: MANAGE_TEAM_URL,
    },
    { status: 409 },
  )
}

export function retiredLocalInviteResponse() {
  return NextResponse.json(
    {
      ok: false,
      error:
        'This local invitation flow has been retired. Team membership is managed in Noli.',
      manageTeamUrl: MANAGE_TEAM_URL,
    },
    { status: 410 },
  )
}
