import { NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { query, queryOne } from '@/app/api/funnels/db'

const ENSURE_TABLE = `
CREATE TABLE IF NOT EXISTS email_intelligence_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_create_contacts BOOLEAN NOT NULL DEFAULT true,
  auto_update_timeline BOOLEAN NOT NULL DEFAULT true,
  auto_update_engagement BOOLEAN NOT NULL DEFAULT true,
  auto_advance_stage BOOLEAN NOT NULL DEFAULT true,
  last_gmail_history_id TEXT,
  last_outlook_delta_link TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  emails_processed_total INTEGER DEFAULT 0,
  contacts_created_total INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
)
`

let tableEnsured = false
async function ensureTable() {
  if (tableEnsured) return
  await query(ENSURE_TABLE)
  tableEnsured = true
}

export async function GET() {
  const auth = await getAuthFromCookies()
  const userId = auth?.sub || (auth as any)?.userId
  if (!auth?.tenantId || !auth?.orgId || !userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  await ensureTable()

  const settings = await queryOne(
    `SELECT * FROM email_intelligence_settings WHERE organization_id = $1 AND user_id = $2`,
    [auth.orgId, userId]
  )

  if (!settings) {
    return NextResponse.json({
      ok: true,
      data: {
        is_enabled: false,
        auto_create_contacts: true,
        auto_update_timeline: true,
        auto_update_engagement: true,
        auto_advance_stage: true,
        last_sync_at: null,
        last_sync_status: null,
        last_sync_error: null,
        emails_processed_total: 0,
        contacts_created_total: 0,
      },
    })
  }

  return NextResponse.json({ ok: true, data: settings })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromCookies()
  const userId = auth?.sub || (auth as any)?.userId
  if (!auth?.tenantId || !auth?.orgId || !userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  await ensureTable()

  const body = await req.json()
  const {
    is_enabled,
    auto_create_contacts,
    auto_update_timeline,
    auto_update_engagement,
    auto_advance_stage,
  } = body

  const existing = await queryOne(
    `SELECT id FROM email_intelligence_settings WHERE organization_id = $1 AND user_id = $2`,
    [auth.orgId, userId]
  )

  if (existing) {
    await query(
      `UPDATE email_intelligence_settings SET
        is_enabled = COALESCE($1, is_enabled),
        auto_create_contacts = COALESCE($2, auto_create_contacts),
        auto_update_timeline = COALESCE($3, auto_update_timeline),
        auto_update_engagement = COALESCE($4, auto_update_engagement),
        auto_advance_stage = COALESCE($5, auto_advance_stage),
        updated_at = now()
      WHERE organization_id = $6 AND user_id = $7`,
      [is_enabled, auto_create_contacts, auto_update_timeline, auto_update_engagement, auto_advance_stage, auth.orgId, userId]
    )
  } else {
    await query(
      `INSERT INTO email_intelligence_settings
        (tenant_id, organization_id, user_id, is_enabled, auto_create_contacts, auto_update_timeline, auto_update_engagement, auto_advance_stage)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        auth.tenantId, auth.orgId, userId,
        is_enabled ?? false,
        auto_create_contacts ?? true,
        auto_update_timeline ?? true,
        auto_update_engagement ?? true,
        auto_advance_stage ?? true,
      ]
    )
  }

  const updated = await queryOne(
    `SELECT * FROM email_intelligence_settings WHERE organization_id = $1 AND user_id = $2`,
    [auth.orgId, userId]
  )

  return NextResponse.json({ ok: true, data: updated })
}
