import { promises as fs } from 'fs'
import path from 'path'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { MeiliSearch } from 'meilisearch'
import type { Knex } from 'knex'
import {
  resolveAttachmentAbsolutePath,
  resolvePartitionRoot,
} from '@open-mercato/core/modules/attachments/lib/storage'
import { getRedisUrl, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function removeAndProve(candidate: string): Promise<void> {
  await fs.rm(candidate, { recursive: true, force: true })
  if (await pathExists(candidate)) {
    throw new Error(`CRM local storage deletion proof failed: ${candidate}`)
  }
}

async function tableExists(database: Knex, table: string): Promise<boolean> {
  const row = await database('information_schema.tables')
    .select('table_name')
    .where({
      table_schema: 'public',
      table_name: table,
      table_type: 'BASE TABLE',
    })
    .first()
  return Boolean(row)
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size))
  }
  return chunks
}

/** Removes both recorded files and deterministic organization prefixes, then
 * proves each target is absent before database rows can be removed. */
export async function purgeCrmOrganizationFiles(
  database: Knex,
  organizationId: string,
): Promise<Record<string, number>> {
  const proof: Record<string, number> = {}

  if (await tableExists(database, 'attachments')) {
    const attachments = (await database('attachments')
      .select('id', 'partition_code', 'storage_path', 'storage_driver')
      .where('organization_id', organizationId)) as Array<{
      id: string
      partition_code: string
      storage_path: string
      storage_driver: string | null
    }>
    for (const attachment of attachments) {
      await removeAndProve(
        resolveAttachmentAbsolutePath(
          attachment.partition_code,
          attachment.storage_path,
          attachment.storage_driver,
        ),
      )
      await removeAndProve(
        path.join(
          resolvePartitionRoot(attachment.partition_code),
          '.cache',
          'thumbnails',
          safeSegment(attachment.id),
        ),
      )
    }
    proof.attachment_files = attachments.length
  }

  if (await tableExists(database, 'attachment_partitions')) {
    const partitions = (await database('attachment_partitions').distinct('code')) as Array<{
      code: string
    }>
    for (const partition of partitions) {
      await removeAndProve(path.join(resolvePartitionRoot(partition.code), `org_${organizationId}`))
    }
    proof.attachment_partition_prefixes = partitions.length
  }

  const contactPrefix = path.join(process.cwd(), 'uploads', 'attachments', organizationId)
  const landingPrefix = path.join(process.cwd(), 'uploads', 'page-images', organizationId)
  await removeAndProve(contactPrefix)
  await removeAndProve(landingPrefix)
  proof.contact_attachment_prefixes = 1
  proof.landing_image_prefixes = 1
  return proof
}

function meilisearchIndexName(tenantId: string): string {
  const prefix = process.env.MEILISEARCH_INDEX_PREFIX ?? 'om'
  return `${prefix}_${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function escapeMeilisearchFilterValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/** Deletes the organization slice, waits for Meilisearch's durable task, and
 * performs a zero-hit readback. An unconfigured search service means there is
 * no remote index to purge; a configured but unhealthy service fails closed. */
export async function purgeCrmOrganizationSearch(
  tenantIds: readonly string[],
  organizationId: string,
): Promise<Record<string, number>> {
  const host = process.env.MEILISEARCH_HOST?.trim()
  if (!host) {
    if (process.env.CRM_GDPR_MEILISEARCH_DISABLED?.trim().toLowerCase() !== 'true') {
      throw new Error('CRM Meilisearch configuration is indeterminate')
    }
    return { meilisearch_disabled_receipt: 1 }
  }

  const client = new MeiliSearch({
    host,
    apiKey: process.env.MEILISEARCH_API_KEY,
  })
  const filter = `_organizationId = "${escapeMeilisearchFilterValue(organizationId)}"`
  let provenIndexes = 0
  for (const tenantId of [...new Set(tenantIds)].sort()) {
    const index = client.index(meilisearchIndexName(tenantId))
    try {
      const queued = index.deleteDocuments({ filter })
      const task = await queued.waitTask({ timeout: 60_000, interval: 100 })
      if (task.status !== 'succeeded') {
        throw new Error(`CRM Meilisearch deletion task ended ${task.status}`)
      }
      const readback = await index.search('', { filter, limit: 0 })
      if (readback.estimatedTotalHits !== 0) {
        throw new Error('CRM Meilisearch deletion proof returned residual documents')
      }
      provenIndexes += 1
    } catch (error) {
      if ((error as { code?: string }).code === 'index_not_found') continue
      throw error
    }
  }
  return { meilisearch_indexes: provenIndexes }
}

export type CrmUserSearchSubject = {
  tenantId: string
  organizationId: string | null
  recordId: string
}

export async function purgeCrmUserSearch(
  subjects: readonly CrmUserSearchSubject[],
): Promise<Record<string, number>> {
  const host = process.env.MEILISEARCH_HOST?.trim()
  if (!host) {
    if (process.env.CRM_GDPR_MEILISEARCH_DISABLED?.trim().toLowerCase() !== 'true') {
      throw new Error('CRM Meilisearch configuration is indeterminate')
    }
    return { meilisearch_disabled_receipt: 1 }
  }
  if (!subjects.length) {
    throw new Error('configured CRM search has no exact user document scope')
  }

  const client = new MeiliSearch({
    host,
    apiKey: process.env.MEILISEARCH_API_KEY,
  })
  const recordIdsByTenant = new Map<string, Set<string>>()
  for (const subject of subjects) {
    const recordIds = recordIdsByTenant.get(subject.tenantId) ?? new Set<string>()
    recordIds.add(subject.recordId)
    recordIdsByTenant.set(subject.tenantId, recordIds)
  }

  let provenDocuments = 0
  let provenIndexes = 0
  for (const [tenantId, recordIds] of [...recordIdsByTenant.entries()].sort()) {
    const index = client.index(meilisearchIndexName(tenantId))
    try {
      const ids = [...recordIds].sort()
      for (const batch of chunksOf(ids, 1_000)) {
        const queued = index.deleteDocuments(batch)
        const task = await queued.waitTask({ timeout: 60_000, interval: 100 })
        if (task.status !== 'succeeded') {
          throw new Error(`CRM user Meilisearch deletion task ended ${task.status}`)
        }
      }
      for (const batch of chunksOf(ids, 25)) {
        await Promise.all(
          batch.map(async (recordId) => {
            try {
              await index.getDocument(recordId)
              throw new Error('CRM user Meilisearch deletion proof returned a residual document')
            } catch (error) {
              if ((error as { code?: string }).code !== 'document_not_found') throw error
            }
          }),
        )
      }
      provenDocuments += ids.length
      provenIndexes += 1
    } catch (error) {
      if ((error as { code?: string }).code === 'index_not_found') continue
      throw error
    }
  }
  return {
    meilisearch_user_documents: provenDocuments,
    meilisearch_user_indexes: provenIndexes,
  }
}

export type CrmUserFileProof = {
  deleted: Record<string, number>
  attachmentIds: string[]
  contactAttachmentIds: string[]
}

export async function purgeCrmUserFiles(
  database: Knex,
  userIds: readonly string[],
  deletedRecordIds: readonly string[],
): Promise<CrmUserFileProof> {
  const proof: CrmUserFileProof = {
    deleted: {},
    attachmentIds: [],
    contactAttachmentIds: [],
  }
  if (!userIds.length) return proof

  if (await tableExists(database, 'contact_attachments')) {
    const contacts = (await database('contact_attachments')
      .select('id', 'organization_id', 'contact_id', 'filename')
      .whereIn('uploaded_by', [...userIds])) as Array<{
      id: string
      organization_id: string
      contact_id: string
      filename: string
    }>
    for (const contact of contacts) {
      await removeAndProve(
        path.join(
          process.cwd(),
          'uploads',
          'attachments',
          contact.organization_id,
          contact.contact_id,
          `${contact.id}-${safeSegment(contact.filename)}`,
        ),
      )
      proof.contactAttachmentIds.push(contact.id)
    }
    proof.deleted.contact_attachment_files = contacts.length
  }

  if (await tableExists(database, 'attachments')) {
    const columns = (await database('information_schema.columns')
      .select('column_name')
      .where({ table_schema: 'public', table_name: 'attachments' })
      .whereIn('column_name', ['entity_id', 'record_id', 'uploaded_by_user_id'])) as Array<{
      column_name: string
    }>
    const hasUploader = columns.some((column) => column.column_name === 'uploaded_by_user_id')
    const hasEntityRecord = ['entity_id', 'record_id'].every((columnName) =>
      columns.some((column) => column.column_name === columnName),
    )
    const attachments = (await database('attachments')
      .select('id', 'partition_code', 'storage_path', 'storage_driver')
      .where((query) => {
        if (hasUploader) query.whereIn('uploaded_by_user_id', [...userIds])
        if (hasEntityRecord) {
          const userRecordClause = (nested: Knex.QueryBuilder) =>
            nested
              .whereIn('record_id', [...userIds])
              .whereIn('entity_id', ['auth:user', 'auth:users'])
          if (hasUploader) query.orWhere(userRecordClause)
          else query.where(userRecordClause)
        }
        if (hasEntityRecord && deletedRecordIds.length) {
          query.orWhere((nested) =>
            nested.whereRaw('record_id = any(?::text[])', [[...deletedRecordIds]]),
          )
        }
      })) as Array<{
      id: string
      partition_code: string
      storage_path: string
      storage_driver: string | null
    }>
    for (const attachment of attachments) {
      await removeAndProve(
        resolveAttachmentAbsolutePath(
          attachment.partition_code,
          attachment.storage_path,
          attachment.storage_driver,
        ),
      )
      await removeAndProve(
        path.join(
          resolvePartitionRoot(attachment.partition_code),
          '.cache',
          'thumbnails',
          safeSegment(attachment.id),
        ),
      )
      proof.attachmentIds.push(attachment.id)
    }
    proof.deleted.attachment_files = attachments.length
  }
  return proof
}

export type CrmUserReferenceColumn = {
  tableName: string
  columnName: string
  nullable: boolean
  dataType: string
}

export async function userReferenceColumns(database: Knex): Promise<CrmUserReferenceColumn[]> {
  const rows = (await database('information_schema.columns as columns')
    .join('information_schema.tables as tables', (join) => {
      join
        .on('tables.table_schema', '=', 'columns.table_schema')
        .andOn('tables.table_name', '=', 'columns.table_name')
    })
    .select(
      'columns.table_name',
      'columns.column_name',
      'columns.is_nullable',
      'columns.udt_name',
    )
    .where('columns.table_schema', 'public')
    .where('tables.table_type', 'BASE TABLE')
    .whereRaw(
      `(
      lower(columns.column_name) = 'user_id'
      or lower(columns.column_name) like '%\\_user\\_id' escape '\\'
      or lower(columns.column_name) in (
        'assigned_to', 'claimed_by', 'completed_by', 'created_by',
        'updated_by', 'uploaded_by'
      )
      or exists (
        select 1
          from pg_catalog.pg_constraint as foreign_keys
          join pg_catalog.pg_class as child_tables
            on child_tables.oid = foreign_keys.conrelid
          join pg_catalog.pg_namespace as child_namespaces
            on child_namespaces.oid = child_tables.relnamespace
          join pg_catalog.pg_attribute as child_columns
            on child_columns.attrelid = foreign_keys.conrelid
           and child_columns.attnum = any(foreign_keys.conkey)
          join pg_catalog.pg_class as parent_tables
            on parent_tables.oid = foreign_keys.confrelid
          join pg_catalog.pg_namespace as parent_namespaces
            on parent_namespaces.oid = parent_tables.relnamespace
          join pg_catalog.pg_attribute as parent_columns
            on parent_columns.attrelid = foreign_keys.confrelid
           and parent_columns.attnum = any(foreign_keys.confkey)
         where foreign_keys.contype = 'f'
           and child_namespaces.nspname = columns.table_schema
           and child_tables.relname = columns.table_name
           and child_columns.attname = columns.column_name
           and parent_namespaces.nspname = 'public'
           and parent_tables.relname = 'users'
           and parent_columns.attname = 'id'
      )
    )`,
    )
    .whereNotIn('columns.table_name', [
      'users',
      'gdpr_identity_fences',
      'gdpr_user_subjects',
      'gdpr_user_receipts',
      'gdpr_user_search_subjects',
      'gdpr_user_write_leases',
    ])
    .orderBy(['columns.table_name', 'columns.column_name'])) as Array<{
    table_name: string
    column_name: string
    is_nullable: 'YES' | 'NO'
    udt_name: string
  }>
  return rows.map((row) => ({
    tableName: row.table_name,
    columnName: row.column_name,
    nullable: row.is_nullable === 'YES',
    dataType: row.udt_name,
  }))
}

export async function missingUserWriteFences(
  database: Knex,
  references: readonly CrmUserReferenceColumn[],
): Promise<string[]> {
  const tables = [...new Set(references.map((reference) => reference.tableName))]
  if (!tables.length) return []
  const rows = (await database('pg_catalog.pg_trigger as triggers')
    .join('pg_catalog.pg_class as classes', 'classes.oid', 'triggers.tgrelid')
    .join('pg_catalog.pg_namespace as namespaces', 'namespaces.oid', 'classes.relnamespace')
    .select('classes.relname', database.raw("encode(triggers.tgargs, 'escape') as arguments"))
    .where('namespaces.nspname', 'public')
    .whereIn('classes.relname', tables)
    .where('triggers.tgname', 'crm_gdpr_guard_user_scoped_write')
    .where('triggers.tgenabled', '<>', 'D')) as Array<{
    relname: string
    arguments: string
  }>
  const guarded = new Map<string, Set<string>>()
  for (const row of rows) {
    guarded.set(row.relname, new Set(row.arguments.split('\\000').filter(Boolean)))
  }
  return references
    .filter((reference) => !guarded.get(reference.tableName)?.has(reference.columnName))
    .map((reference) => `${reference.tableName}.${reference.columnName}`)
    .sort()
}

export async function organizationScopedTables(database: Knex): Promise<string[]> {
  const rows = (await database('information_schema.columns as columns')
    .join('information_schema.tables as tables', (join) => {
      join
        .on('tables.table_schema', '=', 'columns.table_schema')
        .andOn('tables.table_name', '=', 'columns.table_name')
    })
    .distinct('columns.table_name')
    .where('columns.table_schema', 'public')
    .where('columns.column_name', 'organization_id')
    .where('tables.table_type', 'BASE TABLE')
    .whereNotIn('columns.table_name', [
      'organizations',
      'gdpr_user_subjects',
      'gdpr_local_write_leases',
      'gdpr_org_subjects',
    ])
    .orderBy('columns.table_name')) as Array<{ table_name: string }>
  return rows.map((row) => row.table_name)
}

export async function missingOrganizationWriteFences(
  database: Knex,
  tables: readonly string[],
): Promise<string[]> {
  if (!tables.length) return []
  const rows = (await database('pg_catalog.pg_trigger as triggers')
    .join('pg_catalog.pg_class as classes', 'classes.oid', 'triggers.tgrelid')
    .join('pg_catalog.pg_namespace as namespaces', 'namespaces.oid', 'classes.relnamespace')
    .distinct('classes.relname')
    .where('namespaces.nspname', 'public')
    .whereIn('classes.relname', [...tables])
    .where('triggers.tgname', 'crm_gdpr_guard_org_scoped_write')
    .where('triggers.tgenabled', '<>', 'D')) as Array<{ relname: string }>
  const guarded = new Set(rows.map((row) => row.relname))
  return tables.filter((table) => !guarded.has(table))
}

/** Returns a child-before-parent order for direct organization tables. Cycles
 * are rejected because guessing an order would turn schema drift into a false
 * completion acknowledgement. */
export async function orderOrganizationTablesForDelete(
  database: Knex,
  tables: readonly string[],
): Promise<string[]> {
  const tableSet = new Set(tables)
  if (!tableSet.size) return []
  const result = (await database.raw(`
    select child.relname as child_table, parent.relname as parent_table
      from pg_catalog.pg_constraint as constraints
      join pg_catalog.pg_class as child on child.oid = constraints.conrelid
      join pg_catalog.pg_class as parent on parent.oid = constraints.confrelid
      join pg_catalog.pg_namespace as child_namespace on child_namespace.oid = child.relnamespace
      join pg_catalog.pg_namespace as parent_namespace on parent_namespace.oid = parent.relnamespace
     where constraints.contype = 'f'
       and child_namespace.nspname = 'public'
       and parent_namespace.nspname = 'public'
  `)) as { rows?: Array<{ child_table: string; parent_table: string }> }

  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, number>()
  for (const table of tableSet) {
    outgoing.set(table, new Set())
    incoming.set(table, 0)
  }
  for (const edge of result.rows ?? []) {
    if (!tableSet.has(edge.child_table) || !tableSet.has(edge.parent_table)) continue
    if (edge.child_table === edge.parent_table) continue
    const targets = outgoing.get(edge.child_table)!
    if (targets.has(edge.parent_table)) continue
    targets.add(edge.parent_table)
    incoming.set(edge.parent_table, (incoming.get(edge.parent_table) ?? 0) + 1)
  }

  const ready = [...tableSet].filter((table) => incoming.get(table) === 0).sort()
  const ordered: string[] = []
  while (ready.length) {
    const table = ready.shift()!
    ordered.push(table)
    for (const parent of [...(outgoing.get(table) ?? [])].sort()) {
      const next = (incoming.get(parent) ?? 0) - 1
      incoming.set(parent, next)
      if (next === 0) {
        ready.push(parent)
        ready.sort()
      }
    }
  }
  if (ordered.length !== tableSet.size) {
    const cycle = [...tableSet].filter((table) => !ordered.includes(table)).sort()
    throw new Error(`CRM organization table dependency cycle: ${cycle.join(',')}`)
  }
  return ordered
}

const TERMINAL_JOB_STATUSES = [
  'cancelled',
  'canceled',
  'complete',
  'completed',
  'done',
  'failed',
  'skipped',
  'succeeded',
  'success',
] as const

/** Finds durable database jobs that could still perform side effects after a
 * purge. The organization write trigger prevents new jobs after the fence;
 * existing non-terminal work must finish or be cancelled first. */
export async function activeOrganizationJobTables(
  database: Knex,
  organizationId: string,
): Promise<string[]> {
  const rows = (await database('information_schema.columns as organization_columns')
    .join('information_schema.columns as status_columns', (join) => {
      join
        .on('status_columns.table_schema', '=', 'organization_columns.table_schema')
        .andOn('status_columns.table_name', '=', 'organization_columns.table_name')
    })
    .join('information_schema.tables as tables', (join) => {
      join
        .on('tables.table_schema', '=', 'organization_columns.table_schema')
        .andOn('tables.table_name', '=', 'organization_columns.table_name')
    })
    .distinct('organization_columns.table_name')
    .where('organization_columns.table_schema', 'public')
    .where('organization_columns.column_name', 'organization_id')
    .where('status_columns.column_name', 'status')
    .where('tables.table_type', 'BASE TABLE')
    .where((query) =>
      query
        .whereLike('organization_columns.table_name', '%job%')
        .orWhereLike('organization_columns.table_name', '%run%')
        .orWhereLike('organization_columns.table_name', '%queue%')
        .orWhereLike('organization_columns.table_name', '%scheduled%')
        .orWhereIn('organization_columns.table_name', [
          'automation_scheduled_steps',
          'sequence_enrollments',
        ]),
    )
    .orderBy('organization_columns.table_name')) as Array<{
    table_name: string
  }>

  const active: string[] = []
  const terminalPlaceholders = TERMINAL_JOB_STATUSES.map(() => '?').join(', ')
  for (const row of rows) {
    const result = await database(row.table_name)
      .where('organization_id', organizationId)
      .whereRaw(`lower(coalesce(??, '')) not in (${terminalPlaceholders})`, [
        'status',
        ...TERMINAL_JOB_STATUSES,
      ])
      .count<{ count: string }>({ count: '*' })
      .first()
    if (Number(result?.count ?? 0) > 0) active.push(row.table_name)
  }
  return active
}

function valueContainsSubject(value: unknown, subjects: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return subjects.has(value)
  if (Array.isArray(value)) return value.some((entry) => valueContainsSubject(entry, subjects))
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).some((entry) =>
    valueContainsSubject(entry, subjects),
  )
}

const ACTIVE_ASYNC_QUEUE_STATES = [
  'active',
  'delayed',
  'paused',
  'prioritized',
  'waiting',
  'waiting-children',
] as const

async function asyncQueueNames(): Promise<string[]> {
  const redis = new Redis(getRedisUrl('QUEUE'), {
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  const names = new Set<string>()
  try {
    await redis.connect()
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'bull:*:meta', 'COUNT', 100)
      cursor = nextCursor
      for (const key of keys) {
        const match = /^bull:(.+):meta$/.exec(key)
        if (match?.[1]) names.add(match[1])
      }
    } while (cursor !== '0')
  } finally {
    redis.disconnect()
  }
  return [...names].sort()
}

async function asyncQueueBarriers(subjects: ReadonlySet<string>): Promise<string[]> {
  let names: string[]
  try {
    names = await asyncQueueNames()
  } catch {
    return ['async_queue_inventory_unreadable']
  }

  const barriers: string[] = []
  for (const queueName of names) {
    const queue = new Queue(queueName, {
      connection: parseRedisUrl(getRedisUrl('QUEUE')),
    })
    try {
      const schedulers = await queue.getJobSchedulers(0, -1, true)
      for (const scheduler of schedulers) {
        if (!valueContainsSubject(scheduler.template?.data, subjects)) continue
        const removed = await queue.removeJobScheduler(scheduler.key)
        if (!removed) {
          barriers.push(`async_queue_scheduler_remove_unacknowledged:${queueName}`)
        }
      }

      const jobs = await queue.getJobs([...ACTIVE_ASYNC_QUEUE_STATES], 0, -1, true)
      for (const job of jobs) {
        if (!valueContainsSubject(job.data, subjects)) continue
        const state = await job.getState()
        if (state === 'active') {
          barriers.push(`async_queue_active:${queueName}`)
          continue
        }
        try {
          await job.remove({ removeChildren: true })
        } catch {
          const currentState = await job.getState()
          barriers.push(
            currentState === 'active'
              ? `async_queue_active:${queueName}`
              : `async_queue_remove_unacknowledged:${queueName}`,
          )
        }
      }

      const residualJobs = await queue.getJobs([...ACTIVE_ASYNC_QUEUE_STATES], 0, -1, true)
      if (residualJobs.some((job) => valueContainsSubject(job.data, subjects))) {
        barriers.push(`async_queue_residual:${queueName}`)
      }
      const residualSchedulers = await queue.getJobSchedulers(0, -1, true)
      if (
        residualSchedulers.some((scheduler) =>
          valueContainsSubject(scheduler.template?.data, subjects),
        )
      ) {
        barriers.push(`async_queue_scheduler:${queueName}`)
      }
    } catch {
      barriers.push(`async_queue_unreadable:${queueName}`)
    } finally {
      await queue.close().catch(() => {})
    }
  }
  return [...new Set(barriers)].sort()
}

/** Queue payloads are part of the erasure surface. Waiting target jobs are
 * durably removed; active jobs remain an explicit barrier until the generic
 * worker execution lease has drained. */
export async function crmQueueBarriers(
  subjectValues: readonly (string | null)[],
): Promise<string[]> {
  const subjects = new Set(subjectValues.filter((value): value is string => Boolean(value)))
  if (!subjects.size) return []
  if (process.env.QUEUE_STRATEGY === 'async') return asyncQueueBarriers(subjects)
  const baseDir = path.resolve(process.env.QUEUE_BASE_DIR || '.mercato/queue')
  let queueDirs: string[]
  try {
    queueDirs = await fs.readdir(baseDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    return ['local_queue_inventory_unreadable']
  }

  const barriers: string[] = []
  for (const queueName of queueDirs.sort()) {
    const queueFile = path.join(baseDir, queueName, 'queue.json')
    try {
      const parsed = JSON.parse(await fs.readFile(queueFile, 'utf8')) as unknown
      if (!Array.isArray(parsed)) {
        barriers.push(`local_queue_invalid:${queueName}`)
        continue
      }
      if (parsed.some((job) => valueContainsSubject(job, subjects))) {
        barriers.push(`local_queue_job:${queueName}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      barriers.push(`local_queue_unreadable:${queueName}`)
    }
  }
  return barriers
}
