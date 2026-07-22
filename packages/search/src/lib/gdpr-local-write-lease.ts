import { randomUUID } from 'crypto'

type RawDatabase = {
  raw: (
    sql: string,
    bindings?: readonly unknown[],
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

type TransactionalDatabase = RawDatabase & {
  transaction: <T>(operation: (transaction: RawDatabase) => Promise<T>) => Promise<T>
}

export type GdprUserSearchWriteSubject = {
  tenantId: string
  recordId: string
}

/** Durable record tombstones prevent a queued pre-erasure index job from
 * recreating either a Meilisearch or vector document after proof completes. */
export async function isGdprUserSearchTombstoned(
  database: RawDatabase,
  tenantId: string,
  recordId: string,
): Promise<boolean> {
  const relation = await database.raw(
    "select to_regclass('public.gdpr_user_search_subjects')::text as relation",
  )
  if (relation.rows?.[0]?.relation !== 'gdpr_user_search_subjects') return false
  const tombstone = await database.raw(
    `select exists (
       select 1
         from public.gdpr_user_search_subjects
        where record_id = ?
          and (tenant_id is null or tenant_id = ?::uuid)
     ) as tombstoned`,
    [recordId, tenantId],
  )
  return tombstone.rows?.[0]?.tombstoned === true
}

export async function tryWithGdprUserSearchWriteLeases<T>(
  database: TransactionalDatabase,
  subjects: readonly GdprUserSearchWriteSubject[],
  operation: (allowedSubjects: readonly GdprUserSearchWriteSubject[]) => Promise<T>,
): Promise<{ executed: false } | { executed: true; value: T }> {
  const uniqueSubjects = [
    ...new Map(
      subjects.map((subject) => [`${subject.tenantId}\u0000${subject.recordId}`, subject]),
    ).values(),
  ].sort(
    (left, right) =>
      left.recordId.localeCompare(right.recordId) || left.tenantId.localeCompare(right.tenantId),
  )
  if (!uniqueSubjects.length) return { executed: false }

  return database.transaction(async (transaction) => {
    const relation = await transaction.raw(
      "select to_regclass('public.gdpr_user_search_subjects')::text as relation",
    )
    if (relation.rows?.[0]?.relation !== 'gdpr_user_search_subjects') {
      throw new Error('CRM user-search write fence is not installed')
    }

    const lockKeys = [
      ...new Set(
        uniqueSubjects.flatMap((subject) => [
          `crm-gdpr-user-search:*:${subject.recordId}`,
          `crm-gdpr-user-search:${subject.tenantId}:${subject.recordId}`,
        ]),
      ),
    ].sort()
    await transaction.raw(
      `select pg_catalog.pg_advisory_xact_lock_shared(
         pg_catalog.hashtextextended(lock_key, 0)
       )
         from unnest(?::text[]) as lock_key
        order by lock_key`,
      [lockKeys],
    )

    const tombstones = await transaction.raw(
      `select tenant_id::text as tenant_id, record_id
         from public.gdpr_user_search_subjects
        where record_id = any(?::text[])`,
      [[...new Set(uniqueSubjects.map((subject) => subject.recordId))]],
    )
    const allowedSubjects = uniqueSubjects.filter(
      (subject) =>
        !(tombstones.rows ?? []).some(
          (row) =>
            row.record_id === subject.recordId &&
            (row.tenant_id == null || row.tenant_id === subject.tenantId),
        ),
    )
    if (!allowedSubjects.length) return { executed: false }
    return { executed: true, value: await operation(allowedSubjects) }
  })
}

export async function tryWithGdprUserSearchWriteLease<T>(
  database: TransactionalDatabase,
  tenantId: string,
  recordId: string,
  operation: () => Promise<T>,
): Promise<{ executed: false } | { executed: true; value: T }> {
  return tryWithGdprUserSearchWriteLeases(
    database,
    [{ tenantId, recordId }],
    async () => operation(),
  )
}

/** Suppresses a queued index mutation after the CRM organization fence enters
 * deleting, and otherwise keeps the purge waiting until the mutation ends. */
export async function tryWithGdprSearchWriteLease<T>(
  database: RawDatabase,
  organizationId: string,
  operation: () => Promise<T>,
): Promise<{ executed: false } | { executed: true; value: T }> {
  const leaseId = randomUUID()
  const acquired = await database.raw(
    "select public.crm_gdpr_acquire_local_write_lease(?::uuid, ?::uuid, 'search') as noli_org_id",
    [organizationId, leaseId],
  )
  if (typeof acquired.rows?.[0]?.noli_org_id !== 'string') return { executed: false }
  try {
    return { executed: true, value: await operation() }
  } finally {
    const released = await database.raw(
      "select public.crm_gdpr_release_local_write_lease(?::uuid, ?::uuid, 'search') as released",
      [organizationId, leaseId],
    )
    if (released.rows?.[0]?.released !== true) {
      throw new Error('CRM search-write lease release was not acknowledged')
    }
  }
}
