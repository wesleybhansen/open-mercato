import { randomUUID } from 'crypto'

type RawDatabase = {
  raw: (
    sql: string,
    bindings?: readonly unknown[],
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
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
        where tenant_id = ?::uuid
          and record_id = ?
     ) as tombstoned`,
    [tenantId, recordId],
  )
  return tombstone.rows?.[0]?.tombstoned === true
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
