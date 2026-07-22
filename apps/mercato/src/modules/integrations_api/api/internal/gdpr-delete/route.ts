import crypto from 'crypto'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex as KnexTypes } from 'knex'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { purgeOpenCodeSessions } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/opencode-session-purge'
import { gdprDeleteResponse, parseGdprDeleteRequest, type GdprDeleteRequest } from './contract'
import {
  activeOrganizationJobTables,
  crmQueueBarriers,
  missingOrganizationWriteFences,
  missingUserSearchWriteFences,
  missingUserWriteFences,
  orderOrganizationTablesForDelete,
  organizationScopedTables,
  purgeCrmOrganizationFiles,
  purgeCrmOrganizationSearch,
  purgeCrmUserFiles,
  purgeCrmUserLocalSearch,
  purgeCrmUserSearch,
  userReferenceColumns,
  type CrmUserReferenceColumn,
  type CrmUserSearchSubject,
} from './local-proof'

/*
 * Internal server-to-server GDPR purge (coordinated Noli platform delete).
 *
 * The hub orchestrator (POST /api/admin/gdpr-delete) calls this — proven by
 * the shared NOLI_INTERNAL_SERVICE_SECRET — to erase a user's CRM data in the
 * CRM's OWN database. Public at the dispatcher level (requireAuth: false);
 * we authenticate with the shared secret instead of a Clerk/JWT session,
 * exactly like /internal/provision-key.
 *
 * The v2 contract has two idempotent phases. `user` deletes only the bound
 * user's sessions and anonymizes their row. `organization` is called only by
 * the durable noli-core finalizer selected after locked member detach; it uses
 * the stable noli_org_id, refuses to run while any active local user remains,
 * and purges the workspace in one transaction. Only an exact versioned
 * `status: complete` response is an acknowledgement.
 */
export const metadata = {
  path: '/internal/gdpr-delete',
  POST: { requireAuth: false },
}

// PostgreSQL's Serializable isolation makes the "no active users" predicate
// part of the transaction invariant. If provisioning races this finalizer,
// one side is aborted instead of allowing a newly-created user to land in a
// workspace that has already been scrubbed.
export const GDPR_ORG_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: 'serializable' as const,
})

export function isSerializationFailure(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '40001',
  )
}

const USER_DELETE_TABLES = new Set([
  'access_logs',
  'action_logs',
  'api_keys',
  'contact_notes',
  'customer_activities',
  'customer_comments',
  'dashboard_layouts',
  'dashboard_user_widgets',
  'email_connections',
  'email_intelligence_settings',
  'messages',
  'notifications',
  'password_resets',
  'reminders',
  'sessions',
  'user_acls',
  'user_roles',
  'user_sidebar_preferences',
  'workflow_events',
])

const USER_CONTENT_AUTHOR_COLUMN =
  /(^|_)(actor|author|executed|locked|reviewed|sender)(_by)?_user_id$/

export async function POST(req: Request) {
  // 1. Shared-secret auth (constant-time compare on BYTE lengths — a plain
  //    string-length check can still make timingSafeEqual throw on multibyte).
  const secret = process.env.NOLI_INTERNAL_SERVICE_SECRET
  const got = Buffer.from((req.headers.get('authorization') || '').trim())
  const expected = Buffer.from(secret ? `Bearer ${secret}` : '')
  if (!secret || got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const request = parseGdprDeleteRequest(await req.json().catch(() => null))
  if (!request) {
    return NextResponse.json(
      { ok: false, error: 'Invalid GDPR completion contract' },
      { status: 400 },
    )
  }

  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const knex = em.getKnex()

    if (request.phase === 'user') return await deleteUserPhase(knex, request)
    return await deleteOrganizationPhase(knex, request)
  } catch (error) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'ambiguous', {}, [
        isSerializationFailure(error) ? 'serialization_retry' : 'database',
      ]),
      { status: 503 },
    )
  }
}

type Knex = ReturnType<EntityManager['getKnex']>

export async function runGdprOrganizationTransaction<T>(
  knex: Knex,
  scope: (transaction: Knex) => Promise<T>,
): Promise<T> {
  return knex.transaction(scope, GDPR_ORG_TRANSACTION_OPTIONS)
}

async function existingColumns(knex: Knex, table: string, columns: readonly string[]) {
  const rows = (await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: table })
    .whereIn('column_name', [...columns])) as Array<{ column_name: string }>
  return rows.map((row) => row.column_name)
}

type OpenCodeSessionBindingRow = {
  opencode_session_id: string
  session_user_id: string | null
  organization_id: string | null
  tenant_id: string | null
}

async function userOpenCodeSessionBindings(
  knex: Knex,
  userIds: readonly string[],
): Promise<OpenCodeSessionBindingRow[]> {
  if (userIds.length === 0) return []
  const requiredColumns = [
    'opencode_session_id',
    'session_user_id',
    'organization_id',
    'tenant_id',
  ] as const
  if ((await existingColumns(knex, 'api_keys', requiredColumns)).length !== requiredColumns.length) {
    return []
  }
  return await knex('api_keys')
    .select(...requiredColumns)
    .whereIn('session_user_id', [...userIds])
    .whereNotNull('opencode_session_id') as OpenCodeSessionBindingRow[]
}

async function organizationOpenCodeSessionBindings(
  knex: Knex,
  organizationId: string,
): Promise<OpenCodeSessionBindingRow[]> {
  const requiredColumns = [
    'opencode_session_id',
    'session_user_id',
    'organization_id',
    'tenant_id',
  ] as const
  if ((await existingColumns(knex, 'api_keys', requiredColumns)).length !== requiredColumns.length) {
    return []
  }
  return await knex('api_keys')
    .select(...requiredColumns)
    .where('organization_id', organizationId)
    .whereNotNull('opencode_session_id') as OpenCodeSessionBindingRow[]
}

function sameSessionInventory(
  left: readonly OpenCodeSessionBindingRow[],
  right: readonly OpenCodeSessionBindingRow[],
): boolean {
  const normalize = (rows: readonly OpenCodeSessionBindingRow[]) => rows
    .map((row) => JSON.stringify([
      row.opencode_session_id,
      row.session_user_id,
      row.organization_id,
      row.tenant_id,
    ]))
    .sort()
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

export async function purgeUserOpenCodeSessions(
  knex: Knex,
  subjects: readonly { id: string; organizationId: string | null; tenantId: string | null }[],
  purge: typeof purgeOpenCodeSessions = purgeOpenCodeSessions,
): Promise<number> {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]))
  const inventory = await userOpenCodeSessionBindings(knex, [...subjectById.keys()])
  for (const binding of inventory) {
    const subject = binding.session_user_id ? subjectById.get(binding.session_user_id) : null
    if (
      !subject
      || !subject.organizationId
      || !subject.tenantId
      || binding.organization_id !== subject.organizationId
      || binding.tenant_id !== subject.tenantId
    ) {
      throw new Error('OpenCode user session ownership inventory was not exact')
    }
  }
  const sessionIds = inventory.map((binding) => binding.opencode_session_id)
  if (sessionIds.length > 0) await purge(sessionIds)
  const proofInventory = await userOpenCodeSessionBindings(knex, [...subjectById.keys()])
  if (!sameSessionInventory(inventory, proofInventory)) {
    throw new Error('OpenCode user session ownership changed during provider purge')
  }
  return new Set(sessionIds).size
}

export async function purgeOrganizationOpenCodeSessions(
  knex: Knex,
  organizationId: string,
  tenantId: string | null,
  purge: typeof purgeOpenCodeSessions = purgeOpenCodeSessions,
): Promise<number> {
  const inventory = await organizationOpenCodeSessionBindings(knex, organizationId)
  for (const binding of inventory) {
    if (
      binding.organization_id !== organizationId
      || !tenantId
      || binding.tenant_id !== tenantId
    ) {
      throw new Error('OpenCode organization session ownership inventory was not exact')
    }
  }
  const sessionIds = inventory.map((binding) => binding.opencode_session_id)
  if (sessionIds.length > 0) await purge(sessionIds)
  const proofInventory = await organizationOpenCodeSessionBindings(knex, organizationId)
  if (!sameSessionInventory(inventory, proofInventory)) {
    throw new Error('OpenCode organization session ownership changed during provider purge')
  }
  return new Set(sessionIds).size
}

function applyUserReferenceFilter(
  query: KnexTypes.QueryBuilder,
  reference: CrmUserReferenceColumn,
  ids: readonly string[],
): KnexTypes.QueryBuilder {
  return reference.dataType === 'uuid'
    ? query.whereRaw('?? = any(?::uuid[])', [reference.columnName, [...ids]])
    : query.whereRaw('??::text = any(?::text[])', [reference.columnName, [...ids]])
}

function deleteWholeUserReference(reference: CrmUserReferenceColumn): boolean {
  return (
    !reference.nullable ||
    USER_DELETE_TABLES.has(reference.tableName) ||
    USER_CONTENT_AUTHOR_COLUMN.test(reference.columnName) ||
    reference.columnName === 'uploaded_by'
  )
}

async function collectUserSearchSubjects(
  knex: Knex,
  ids: readonly string[],
  references: readonly CrmUserReferenceColumn[],
  users: readonly {
    id: string
    tenant_id: string | null
    organization_id: string | null
  }[],
): Promise<{
  subjects: CrmUserSearchSubject[]
  recordIds: string[]
  deletedRecordIds: string[]
}> {
  const subjectMap = new Map<string, CrmUserSearchSubject>()
  const recordIds = new Set<string>()
  const deletedRecordIds = new Set<string>()
  const tenantByOrganization = new Map<string, string>()
  for (const user of [...users].sort((left, right) => left.id.localeCompare(right.id))) {
    if (user.organization_id && user.tenant_id) {
      tenantByOrganization.set(user.organization_id, user.tenant_id)
    }
    recordIds.add(user.id)
    deletedRecordIds.add(user.id)
    if (user.tenant_id) {
      const subject = {
        tenantId: user.tenant_id,
        organizationId: user.organization_id,
        recordId: user.id,
      }
      subjectMap.set(`${subject.tenantId}:${subject.recordId}`, subject)
    }
  }

  const tables = new Map<string, CrmUserReferenceColumn[]>()
  for (const reference of references) {
    const tableReferences = tables.get(reference.tableName) ?? []
    tableReferences.push(reference)
    tables.set(reference.tableName, tableReferences)
  }
  for (const [tableName, tableReferences] of tables) {
    const available = await existingColumns(knex, tableName, ['id', 'tenant_id', 'organization_id'])
    if (!available.includes('id')) continue
    const selectedColumns = [
      ...new Set([...available, ...tableReferences.map((reference) => reference.columnName)]),
    ]
    const rows = (await knex(tableName)
      .select(selectedColumns)
      .where((query) => {
        for (const [index, reference] of tableReferences.entries()) {
          const clause = index === 0 ? query.whereRaw.bind(query) : query.orWhereRaw.bind(query)
          clause(
            reference.dataType === 'uuid' ? '?? = any(?::uuid[])' : '??::text = any(?::text[])',
            [reference.columnName, [...ids]],
          )
        }
    })) as Array<{
      [columnName: string]: unknown
      id: unknown
      tenant_id?: unknown
      organization_id?: unknown
    }>
    for (const row of rows) {
      const recordId = typeof row.id === 'string' ? row.id : String(row.id ?? '')
      if (!recordId) continue
      recordIds.add(recordId)
      if (
        tableReferences.some(
          (reference) =>
            deleteWholeUserReference(reference) &&
            ids.includes(String(row[reference.columnName] ?? '')),
        )
      ) {
        deletedRecordIds.add(recordId)
      }
      const organizationId = typeof row.organization_id === 'string' ? row.organization_id : null
      const tenantId =
        typeof row.tenant_id === 'string'
          ? row.tenant_id
          : organizationId
            ? (tenantByOrganization.get(organizationId) ?? null)
            : null
      if (!tenantId) continue
      const subject = { tenantId, organizationId, recordId }
      subjectMap.set(`${tenantId}:${recordId}`, subject)
    }
  }

  if (
    (await existingColumns(knex, 'attachments', [
      'id',
      'record_id',
      'tenant_id',
      'organization_id',
    ])).length === 4
  ) {
    let pendingRecordIds = [...deletedRecordIds]
    while (pendingRecordIds.length) {
      const nextRecordIds = new Set<string>()
      for (let offset = 0; offset < pendingRecordIds.length; offset += 1_000) {
        const batch = pendingRecordIds.slice(offset, offset + 1_000)
        const attachmentRows = (await knex('attachments')
          .select('id', 'tenant_id', 'organization_id')
          .whereRaw('record_id = any(?::text[])', [batch])) as Array<{
          id: string
          tenant_id: string | null
          organization_id: string | null
        }>
        for (const attachment of attachmentRows) {
          if (!deletedRecordIds.has(attachment.id)) nextRecordIds.add(attachment.id)
          recordIds.add(attachment.id)
          deletedRecordIds.add(attachment.id)
          if (attachment.tenant_id) {
            const subject = {
              tenantId: attachment.tenant_id,
              organizationId: attachment.organization_id,
              recordId: attachment.id,
            }
            subjectMap.set(`${subject.tenantId}:${subject.recordId}`, subject)
          }
        }
      }
      pendingRecordIds = [...nextRecordIds]
    }
  }

  const scopedRecordIds = new Set([...subjectMap.values()].map((subject) => subject.recordId))
  for (const recordId of [...recordIds].sort()) {
    if (scopedRecordIds.has(recordId)) continue
    subjectMap.set(`*:${recordId}`, {
      tenantId: null,
      organizationId: null,
      recordId,
    })
  }

  return {
    subjects: [...subjectMap.values()].sort(
      (left, right) =>
        left.recordId.localeCompare(right.recordId) ||
        (left.tenantId ?? '').localeCompare(right.tenantId ?? ''),
    ),
    recordIds: [...recordIds],
    deletedRecordIds: [...deletedRecordIds],
  }
}

async function sweepAndProveUserReferences(
  knex: Knex,
  ids: readonly string[],
  references: readonly CrmUserReferenceColumn[],
  deleted: Record<string, number>,
) {
  for (const reference of references) {
    const query = applyUserReferenceFilter(knex(reference.tableName), reference, ids)
    const deletesRow = deleteWholeUserReference(reference)
    const count = deletesRow
      ? await query.del()
      : await query.update({ [reference.columnName]: null })
    if (count) {
      const key = deletesRow
        ? `${reference.tableName}.${reference.columnName}:deleted`
        : `${reference.tableName}.${reference.columnName}:redacted`
      deleted[key] = (deleted[key] ?? 0) + count
    }
  }

  for (const reference of references) {
    const proof = await applyUserReferenceFilter(
      knex(reference.tableName),
      reference,
      ids,
    )
      .count<{ count: string }>({ count: '*' })
      .first()
    if (Number(proof?.count ?? 0) !== 0) {
      throw new Error(`user reference proof failed: ${reference.tableName}.${reference.columnName}`)
    }
  }
}

export async function deleteUserPhase(knex: Knex, request: GdprDeleteRequest) {
  const emailHash = request.email ? computeEmailHash(request.email) : null
  const clerkHash = request.clerkUserId
    ? crypto.createHash('sha256').update(request.clerkUserId).digest('hex')
    : null
  const fence = (await knex.raw(
    'select public.crm_gdpr_begin_user_erasure(?, ?::uuid, ?, ?) as state',
    [request.noliUserId, request.operationId, emailHash, request.clerkUserId],
  )) as { rows?: Array<{ state?: string }> }
  if (fence.rows?.[0]?.state !== 'deleting') throw new Error('invalid fence receipt')

  await knex('gdpr_user_receipts')
    .insert({
      operation_id: request.operationId,
      noli_user_id: request.noliUserId,
      noli_org_id: request.noliOrgId,
      email_hash: emailHash,
      clerk_hash: clerkHash,
    })
    .onConflict('noli_user_id')
    .ignore()
  const receipt = (await knex('gdpr_user_receipts')
    .select('operation_id', 'noli_org_id', 'email_hash', 'clerk_hash', 'completed_at')
    .where('noli_user_id', request.noliUserId)
    .first()) as
    | {
        operation_id: string
        noli_org_id: string | null
        email_hash: string | null
        clerk_hash: string | null
        completed_at: Date | null
      }
    | undefined
  if (
    !receipt ||
    receipt.operation_id !== request.operationId ||
    receipt.noli_org_id !== request.noliOrgId ||
    receipt.email_hash !== emailHash ||
    receipt.clerk_hash !== clerkHash
  ) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'ambiguous', {}, ['user_receipt_mismatch']),
      { status: 409 },
    )
  }
  if (receipt.completed_at) {
    return NextResponse.json(gdprDeleteResponse(request, 'complete'))
  }

  const durable = (await knex.raw('select * from public.crm_gdpr_user_subjects(?, ?::uuid)', [
    request.noliUserId,
    request.operationId,
  ])) as {
    rows?: Array<{
      local_user_id: string
      organization_id: string | null
      tenant_id: string | null
    }>
  }

  const users = (await knex('users as users')
    .leftJoin('organizations as organizations', 'organizations.id', 'users.organization_id')
    .select(
      'users.id',
      'users.organization_id',
      'users.tenant_id',
      'users.email_hash',
      'users.clerk_user_id',
      'organizations.noli_org_id',
      'organizations.tenant_id as organization_tenant_id',
    )
    .where((query) => {
      query.where('users.id', request.noliUserId)
      if (request.clerkUserId) query.orWhere('users.clerk_user_id', request.clerkUserId)
      if (emailHash) query.orWhere('users.email_hash', emailHash)
      if (request.email) {
        query.orWhereRaw('lower(btrim(users.email)) = lower(btrim(?))', [request.email])
      }
    })) as Array<{
    id: string
    organization_id: string | null
    tenant_id: string | null
    email_hash: string | null
    clerk_user_id: string | null
    noli_org_id: string | null
    organization_tenant_id: string | null
  }>

  const clerkIds = new Set(
    users.map((user) => user.clerk_user_id).filter((value): value is string => Boolean(value)),
  )
  const discoveredOrgIds = new Set(
    users.map((user) => user.noli_org_id).filter((value): value is string => Boolean(value)),
  )
  const durableOrganizationIds = (durable.rows ?? [])
    .map((subject) => subject.organization_id)
    .filter((value): value is string => Boolean(value))
  const tenantByOrganization = new Map<string, string>()
  for (const user of users) {
    const tenantId = user.tenant_id ?? user.organization_tenant_id
    if (user.organization_id && tenantId) {
      tenantByOrganization.set(user.organization_id, tenantId)
    }
  }
  if (durableOrganizationIds.length) {
    const durableOrganizations = (await knex('organizations')
      .select('id', 'noli_org_id', 'tenant_id')
      .whereIn('id', durableOrganizationIds)) as Array<{
      id: string
      noli_org_id: string | null
      tenant_id: string | null
    }>
    for (const organization of durableOrganizations) {
      if (organization.noli_org_id) discoveredOrgIds.add(organization.noli_org_id)
      if (organization.tenant_id) {
        tenantByOrganization.set(organization.id, organization.tenant_id)
      }
    }
  }
  if (
    clerkIds.size > 1 ||
    (request.clerkUserId && [...clerkIds].some((value) => value !== request.clerkUserId)) ||
    discoveredOrgIds.size > 1 ||
    [...discoveredOrgIds].some((value) => value !== request.noliOrgId)
  ) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'skipped', {}, ['identity_or_organization_ambiguity']),
      { status: 409 },
    )
  }

  if (!users.length && !(durable.rows ?? []).length) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'ambiguous', {}, ['user_subject_receipt_missing']),
      { status: 409 },
    )
  }

  for (const user of users) {
    const localFence = (await knex.raw(
      'select public.crm_gdpr_begin_user_erasure(?, ?::uuid, ?, ?) as state',
      [user.id, request.operationId, user.email_hash, user.clerk_user_id],
    )) as { rows?: Array<{ state?: string }> }
    if (localFence.rows?.[0]?.state !== 'deleting') throw new Error('invalid local fence receipt')
    const recorded = (await knex.raw(
      'select public.crm_gdpr_record_user_subject(?, ?::uuid, ?::uuid, ?::uuid, ?::uuid) as recorded',
      [
        request.noliUserId,
        request.operationId,
        user.id,
        user.organization_id,
        user.tenant_id ?? user.organization_tenant_id,
      ],
    )) as { rows?: Array<{ recorded?: boolean }> }
    if (recorded.rows?.[0]?.recorded !== true) throw new Error('invalid subject receipt')
  }

  const subjectMap = new Map<string, { organizationId: string | null; tenantId: string | null }>()
  for (const subject of durable.rows ?? []) {
    subjectMap.set(subject.local_user_id, {
      organizationId: subject.organization_id,
      tenantId:
        subject.tenant_id ??
        (subject.organization_id ? (tenantByOrganization.get(subject.organization_id) ?? null) : null),
    })
  }
  for (const user of users) {
    subjectMap.set(user.id, {
      organizationId: user.organization_id,
      tenantId: user.tenant_id ?? user.organization_tenant_id,
    })
  }
  subjectMap.set(
    request.noliUserId,
    subjectMap.get(request.noliUserId) ?? {
      organizationId: null,
      tenantId: null,
    },
  )
  const ids = [...subjectMap.keys()].sort()

  for (const id of ids) {
    const localFence = (await knex.raw(
      'select public.crm_gdpr_begin_user_erasure(?, ?::uuid, ?, ?) as state',
      [id, request.operationId, null, null],
    )) as { rows?: Array<{ state?: string }> }
    if (localFence.rows?.[0]?.state !== 'deleting') throw new Error('invalid durable subject fence')
  }

  const leaseReceipt = (await knex.raw(
    'select public.crm_gdpr_active_user_write_leases(?, ?::uuid, ?::uuid[]) as active_count',
    [request.noliUserId, request.operationId, ids],
  )) as { rows?: Array<{ active_count?: string | number }> }
  if (Number(leaseReceipt.rows?.[0]?.active_count ?? 0) !== 0) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'partial', {}, ['user_writes_in_flight']),
      { status: 409 },
    )
  }

  const references = await userReferenceColumns(knex as never)
  const missingFences = await missingUserWriteFences(knex as never, references)
  const missingSearchFences = await missingUserSearchWriteFences(knex as never)
  if (missingFences.length || missingSearchFences.length) {
    return NextResponse.json(
      gdprDeleteResponse(
        request,
        'partial',
        {},
        [
          ...missingFences.map((table) => `user_writer_fence:${table}`),
          ...missingSearchFences.map((table) => `user_search_writer_fence:${table}`),
        ],
      ),
      { status: 503 },
    )
  }

  const userScopes = [...subjectMap.entries()].map(([id, scope]) => ({
    id,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
  }))
  const searchInventory = await collectUserSearchSubjects(knex, ids, references, userScopes)
  for (let offset = 0; offset < searchInventory.subjects.length; offset += 500) {
    const subjectBatch = searchInventory.subjects.slice(offset, offset + 500)
    await knex('gdpr_user_search_subjects')
      .insert(
        subjectBatch.map((subject) => ({
          operation_id: request.operationId,
          noli_user_id: request.noliUserId,
          tenant_id: subject.tenantId,
          tenant_scope: subject.tenantId ?? '*',
          organization_id: subject.organizationId,
          record_id: subject.recordId,
        })),
      )
      .onConflict(['operation_id', 'tenant_scope', 'record_id'])
      .ignore()
  }

  const deleted: Record<string, number> = {}
  const queueBarriers = await crmQueueBarriers([
    ...ids,
    request.noliUserId,
    request.noliOrgId,
    request.email,
    request.clerkUserId,
  ])
  if (queueBarriers.length) {
    return NextResponse.json(gdprDeleteResponse(request, 'partial', {}, queueBarriers), {
      status: 409,
    })
  }

  deleted.opencode_sessions = await purgeUserOpenCodeSessions(
    knex,
    userScopes.map((scope) => ({
      id: scope.id,
      organizationId: scope.organization_id,
      tenantId: scope.tenant_id,
    })),
  )

  const fileProof = await purgeCrmUserFiles(
    knex as never,
    ids,
    searchInventory.deletedRecordIds,
    userScopes
      .map((scope) => scope.organization_id)
      .filter((value): value is string => Boolean(value)),
  )
  Object.assign(deleted, fileProof.deleted)
  await knex('gdpr_user_receipts')
    .where({
      operation_id: request.operationId,
      noli_user_id: request.noliUserId,
    })
    .update({ storage_proven_at: knex.fn.now() })

  const durableSearchSubjects = (await knex('gdpr_user_search_subjects')
    .select('tenant_id', 'organization_id', 'record_id')
    .where({
      operation_id: request.operationId,
      noli_user_id: request.noliUserId,
    })) as Array<{
    tenant_id: string | null
    organization_id: string | null
    record_id: string
  }>
  Object.assign(
    deleted,
    await purgeCrmUserSearch(
      durableSearchSubjects.map((subject) => ({
        tenantId: subject.tenant_id,
        organizationId: subject.organization_id,
        recordId: subject.record_id,
      })),
    ),
  )
  await knex('gdpr_user_receipts')
    .where({
      operation_id: request.operationId,
      noli_user_id: request.noliUserId,
    })
    .update({ search_proven_at: knex.fn.now() })

  const finalQueueBarriers = await crmQueueBarriers([
    ...ids,
    request.noliUserId,
    request.noliOrgId,
    request.email,
    request.clerkUserId,
  ])
  if (finalQueueBarriers.length) {
    return NextResponse.json(gdprDeleteResponse(request, 'partial', deleted, finalQueueBarriers), {
      status: 409,
    })
  }
  await knex('gdpr_user_receipts')
    .where({
      operation_id: request.operationId,
      noli_user_id: request.noliUserId,
    })
    .update({ queue_proven_at: knex.fn.now() })

  await runGdprOrganizationTransaction(knex, async (transaction) => {
    await transaction.raw("select set_config('noli.gdpr_operation_id', ?, true)", [
      request.operationId,
    ])
    const activeLeases = (await transaction.raw(
      'select public.crm_gdpr_active_user_write_leases(?, ?::uuid, ?::uuid[]) as active_count',
      [request.noliUserId, request.operationId, ids],
    )) as { rows?: Array<{ active_count?: string | number }> }
    if (Number(activeLeases.rows?.[0]?.active_count ?? 0) !== 0) {
      throw new Error('CRM user writes resumed after drain')
    }
    const transactionReferences = await userReferenceColumns(transaction as never)
    const transactionMissingFences = await missingUserWriteFences(
      transaction as never,
      transactionReferences,
    )
    const transactionMissingSearchFences = await missingUserSearchWriteFences(
      transaction as never,
    )
    if (transactionMissingFences.length || transactionMissingSearchFences.length) {
      throw new Error(
        `user writer fence proof failed: ${[
          ...transactionMissingFences,
          ...transactionMissingSearchFences,
        ].join(',')}`,
      )
    }
    if (fileProof.attachmentIds.length) {
      deleted.attachments = await transaction('attachments')
        .whereIn('id', fileProof.attachmentIds)
        .del()
    }
    if (fileProof.contactAttachmentIds.length) {
      deleted.contact_attachments = await transaction('contact_attachments')
        .whereIn('id', fileProof.contactAttachmentIds)
        .del()
    }
    if (fileProof.localFileIds.length) {
      deleted.gdpr_user_local_files = await transaction('gdpr_user_local_files')
        .whereIn('id', fileProof.localFileIds)
        .del()
    }
    Object.assign(
      deleted,
      await purgeCrmUserLocalSearch(
        transaction as never,
        durableSearchSubjects.map((subject) => ({
          tenantId: subject.tenant_id,
          organizationId: subject.organization_id,
          recordId: subject.record_id,
        })),
      ),
    )
    await sweepAndProveUserReferences(transaction, ids, transactionReferences, deleted)

    const userRows = await transaction('users').whereIn('id', ids).del()
    const proof = await transaction('users')
      .whereIn('id', ids)
      .count<{ count: string }>({ count: '*' })
      .first()
    if (Number(proof?.count ?? 0) !== 0) {
      throw new Error('user deletion proof failed')
    }
    deleted.users = userRows
    await transaction('gdpr_user_receipts')
      .where({
        operation_id: request.operationId,
        noli_user_id: request.noliUserId,
      })
      .update({
        database_proven_at: transaction.fn.now(),
        completed_at: transaction.fn.now(),
      })
  })

  return NextResponse.json(gdprDeleteResponse(request, 'complete', deleted))
}

export async function deleteOrganizationPhase(knex: Knex, request: GdprDeleteRequest) {
  if (!request.noliOrgId) {
    return NextResponse.json(gdprDeleteResponse(request, 'skipped', {}, ['noli_org_id']), {
      status: 409,
    })
  }

  const deleted: Record<string, number> = {}
  const fence = (await knex.raw('select public.crm_gdpr_begin_erasure(?, ?, ?::uuid) as state', [
    'organization',
    request.noliOrgId,
    request.operationId,
  ])) as { rows?: Array<{ state?: string }> }
  if (fence.rows?.[0]?.state !== 'deleting') throw new Error('invalid fence receipt')

  const leaseReceipt = (await knex.raw(
    'select public.crm_gdpr_active_local_write_leases(?, ?::uuid) as active_count',
    [request.noliOrgId, request.operationId],
  )) as { rows?: Array<{ active_count?: string | number }> }
  if (Number(leaseReceipt.rows?.[0]?.active_count ?? 0) !== 0) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'partial', {}, ['local_writes_in_flight']),
      { status: 409 },
    )
  }

  const organizations = (await knex('organizations')
    .select('id', 'tenant_id')
    .where('noli_org_id', request.noliOrgId)) as Array<{
    id: string
    tenant_id: string | null
  }>
  if (organizations.length > 1) throw new Error('organization lookup was not exact')

  type OrganizationReceipt = {
    operation_id: string
    organization_id: string
    tenant_id: string | null
    completed_at: Date | null
  }
  let receipt = (await knex('gdpr_org_subjects')
    .select('operation_id', 'organization_id', 'tenant_id', 'completed_at')
    .where('noli_org_id', request.noliOrgId)
    .first()) as OrganizationReceipt | undefined
  const organization = organizations[0]
  if (
    organization &&
    receipt &&
    (receipt.operation_id !== request.operationId ||
      receipt.organization_id !== organization.id ||
      receipt.tenant_id !== organization.tenant_id)
  ) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'ambiguous', {}, ['organization_receipt_mismatch']),
      { status: 409 },
    )
  }
  if (organization && !receipt) {
    await knex('gdpr_org_subjects')
      .insert({
        operation_id: request.operationId,
        noli_org_id: request.noliOrgId,
        organization_id: organization.id,
        tenant_id: organization.tenant_id,
      })
      .onConflict('noli_org_id')
      .ignore()
    receipt = (await knex('gdpr_org_subjects')
      .select('operation_id', 'organization_id', 'tenant_id', 'completed_at')
      .where('noli_org_id', request.noliOrgId)
      .first()) as OrganizationReceipt | undefined
    if (!receipt || receipt.operation_id !== request.operationId) {
      throw new Error('organization receipt was not durably bound')
    }
  }

  if (!receipt) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'ambiguous', deleted, ['organization_receipt_missing']),
      { status: 409 },
    )
  }
  if (receipt.completed_at) {
    return NextResponse.json(gdprDeleteResponse(request, 'complete', deleted))
  }

  const remainingUsers = await knex('users')
    .where('organization_id', receipt.organization_id)
    .count<{ count: string }>({ count: '*' })
    .first()
  if (Number(remainingUsers?.count ?? 0) !== 0) {
    return NextResponse.json(gdprDeleteResponse(request, 'skipped', {}, ['remaining_user_rows']), {
      status: 409,
    })
  }

  const scopedTables = await organizationScopedTables(knex as never)
  const missingFences = await missingOrganizationWriteFences(knex as never, scopedTables)
  if (missingFences.length) {
    return NextResponse.json(
      gdprDeleteResponse(
        request,
        'partial',
        {},
        missingFences.map((table) => `writer_fence:${table}`),
      ),
      { status: 503 },
    )
  }
  const jobBarriers = await activeOrganizationJobTables(knex as never, receipt.organization_id)
  const queueBarriers = await crmQueueBarriers([
    request.noliOrgId,
    receipt.organization_id,
    receipt.tenant_id,
  ])
  if (jobBarriers.length || queueBarriers.length) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'partial', {}, [
        ...jobBarriers.map((table) => `active_job:${table}`),
        ...queueBarriers,
      ]),
      { status: 409 },
    )
  }

  deleted.opencode_sessions = await purgeOrganizationOpenCodeSessions(
    knex,
    receipt.organization_id,
    receipt.tenant_id,
  )

  Object.assign(deleted, await purgeCrmOrganizationFiles(knex as never, receipt.organization_id))
  await knex('gdpr_org_subjects')
    .where({
      operation_id: request.operationId,
      noli_org_id: request.noliOrgId,
    })
    .update({ storage_proven_at: knex.fn.now() })

  const tenantIds = new Set<string>()
  if (receipt.tenant_id) tenantIds.add(receipt.tenant_id)
  for (const table of scopedTables) {
    const tenantColumns = await existingColumns(knex, table, ['tenant_id'])
    if (!tenantColumns.length) continue
    const rows = (await knex(table)
      .distinct('tenant_id')
      .where('organization_id', receipt.organization_id)
      .whereNotNull('tenant_id')) as Array<{ tenant_id: string }>
    for (const row of rows) tenantIds.add(row.tenant_id)
  }
  if (process.env.MEILISEARCH_HOST?.trim() && tenantIds.size === 0) {
    throw new Error('configured CRM search has no exact tenant scope for organization purge')
  }
  Object.assign(deleted, await purgeCrmOrganizationSearch([...tenantIds], receipt.organization_id))
  await knex('gdpr_org_subjects')
    .where({
      operation_id: request.operationId,
      noli_org_id: request.noliOrgId,
    })
    .update({ search_proven_at: knex.fn.now() })

  const finalJobBarriers = await activeOrganizationJobTables(knex as never, receipt.organization_id)
  const finalQueueBarriers = await crmQueueBarriers([
    request.noliOrgId,
    receipt.organization_id,
    receipt.tenant_id,
  ])
  if (finalJobBarriers.length || finalQueueBarriers.length) {
    return NextResponse.json(
      gdprDeleteResponse(request, 'partial', deleted, [
        ...finalJobBarriers.map((table) => `active_job:${table}`),
        ...finalQueueBarriers,
      ]),
      { status: 409 },
    )
  }
  await knex('gdpr_org_subjects')
    .where({
      operation_id: request.operationId,
      noli_org_id: request.noliOrgId,
    })
    .update({ queue_proven_at: knex.fn.now() })

  await runGdprOrganizationTransaction(knex, async (transaction) => {
    await transaction.raw("select set_config('noli.gdpr_operation_id', ?, true)", [
      request.operationId,
    ])
    const activeLeases = (await transaction.raw(
      'select public.crm_gdpr_active_local_write_leases(?, ?::uuid) as active_count',
      [request.noliOrgId, request.operationId],
    )) as { rows?: Array<{ active_count?: string | number }> }
    if (Number(activeLeases.rows?.[0]?.active_count ?? 0) !== 0) {
      throw new Error('CRM local writes resumed after drain')
    }

    const lockedOrganizations = (await transaction('organizations')
      .select('id')
      .where('noli_org_id', request.noliOrgId)
      .forUpdate()) as Array<{ id: string }>
    if (lockedOrganizations.length > 1) throw new Error('organization lock was not exact')
    if (lockedOrganizations[0] && lockedOrganizations[0].id !== receipt!.organization_id) {
      throw new Error('organization identity changed after durable binding')
    }

    const userProof = await transaction('users')
      .where('organization_id', receipt!.organization_id)
      .count<{ count: string }>({ count: '*' })
      .first()
    if (Number(userProof?.count ?? 0) !== 0) {
      throw new Error('remaining CRM user rows block organization deletion')
    }

    const transactionTables = await organizationScopedTables(transaction as never)
    const transactionMissingFences = await missingOrganizationWriteFences(
      transaction as never,
      transactionTables,
    )
    if (transactionMissingFences.length) {
      throw new Error(
        `organization writer fence proof failed: ${transactionMissingFences.join(',')}`,
      )
    }

    if (
      (await existingColumns(transaction as Knex, 'sequence_step_executions', ['enrollment_id']))
        .length &&
      (await existingColumns(transaction as Knex, 'sequence_enrollments', ['id'])).length
    ) {
      deleted.sequence_step_executions = await transaction('sequence_step_executions')
        .whereIn(
          'enrollment_id',
          transaction('sequence_enrollments')
            .select('id')
            .where('organization_id', receipt!.organization_id),
        )
        .del()
    }
    if (
      (await existingColumns(transaction as Knex, 'sequence_steps', ['sequence_id'])).length &&
      (await existingColumns(transaction as Knex, 'sequences', ['id'])).length
    ) {
      deleted.sequence_steps = await transaction('sequence_steps')
        .whereIn(
          'sequence_id',
          transaction('sequences').select('id').where('organization_id', receipt!.organization_id),
        )
        .del()
    }
    if (
      (await existingColumns(transaction as Knex, 'landing_page_forms', ['landing_page_id']))
        .length &&
      (await existingColumns(transaction as Knex, 'landing_pages', ['id'])).length
    ) {
      deleted.landing_page_forms = await transaction('landing_page_forms')
        .whereIn(
          'landing_page_id',
          transaction('landing_pages')
            .select('id')
            .where('organization_id', receipt!.organization_id),
        )
        .del()
    }

    const orderedTables = await orderOrganizationTablesForDelete(
      transaction as never,
      transactionTables,
    )
    for (const table of orderedTables) {
      deleted[table] = await transaction(table)
        .where('organization_id', receipt!.organization_id)
        .del()
    }
    for (const table of transactionTables) {
      const residual = await transaction(table)
        .where('organization_id', receipt!.organization_id)
        .count<{ count: string }>({ count: '*' })
        .first()
      if (Number(residual?.count ?? 0) !== 0) {
        throw new Error(`CRM organization deletion proof failed: ${table}`)
      }
    }

    deleted.organizations = await transaction('organizations')
      .where('id', receipt!.organization_id)
      .where('noli_org_id', request.noliOrgId)
      .del()
    if (lockedOrganizations.length && deleted.organizations !== 1) {
      throw new Error('organization deletion was not exact')
    }
    const organizationProof = await transaction('organizations')
      .where((query) =>
        query.where('id', receipt!.organization_id).orWhere('noli_org_id', request.noliOrgId!),
      )
      .count<{ count: string }>({ count: '*' })
      .first()
    if (Number(organizationProof?.count ?? 0) !== 0) {
      throw new Error('organization absence proof failed')
    }
    await transaction('gdpr_org_subjects')
      .where({
        operation_id: request.operationId,
        noli_org_id: request.noliOrgId,
      })
      .update({
        database_proven_at: transaction.fn.now(),
        completed_at: transaction.fn.now(),
      })
  })

  return NextResponse.json(gdprDeleteResponse(request, 'complete', deleted))
}
