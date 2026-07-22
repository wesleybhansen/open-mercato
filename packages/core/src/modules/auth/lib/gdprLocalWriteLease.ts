import { randomUUID } from 'crypto'

export type GdprLocalWriteKind = 'processor' | 'storage' | 'search'

type RawDatabase = {
  raw: (
    sql: string,
    bindings?: readonly unknown[],
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

async function acquireGdprLocalWriteLease(
  database: RawDatabase,
  organizationId: string,
  kind: GdprLocalWriteKind,
): Promise<string | null> {
  const leaseId = randomUUID()
  const acquired = await database.raw(
    'select public.crm_gdpr_acquire_local_write_lease(?::uuid, ?::uuid, ?) as noli_org_id',
    [organizationId, leaseId, kind],
  )
  return typeof acquired.rows?.[0]?.noli_org_id === 'string' ? leaseId : null
}

async function releaseGdprLocalWriteLease(
  database: RawDatabase,
  organizationId: string,
  leaseId: string,
  kind: GdprLocalWriteKind,
): Promise<void> {
  const released = await database.raw(
    'select public.crm_gdpr_release_local_write_lease(?::uuid, ?::uuid, ?) as released',
    [organizationId, leaseId, kind],
  )
  if (released.rows?.[0]?.released !== true) {
    throw new Error('CRM local-write lease release was not acknowledged')
  }
}

async function acquireGdprUserWriteLease(
  database: RawDatabase,
  userId: string,
  kind: GdprLocalWriteKind,
): Promise<string | null> {
  const leaseId = randomUUID()
  const acquired = await database.raw(
    'select public.crm_gdpr_acquire_user_write_lease(?::uuid, ?::uuid, ?) as acquired',
    [userId, leaseId, kind],
  )
  return acquired.rows?.[0]?.acquired === true ? leaseId : null
}

async function releaseGdprUserWriteLease(
  database: RawDatabase,
  userId: string,
  leaseId: string,
  kind: GdprLocalWriteKind,
): Promise<void> {
  const released = await database.raw(
    'select public.crm_gdpr_release_user_write_lease(?::uuid, ?::uuid, ?) as released',
    [userId, leaseId, kind],
  )
  if (released.rows?.[0]?.released !== true) {
    throw new Error('CRM user-write lease release was not acknowledged')
  }
}

export type GdprLocalWriteLease = {
  /** Opaque database binding used when an admitted direct operation must
   * register a longer-lived external grant before it returns. */
  leaseId: string
  release: () => Promise<void>
}

/** Acquires a lease whose release can be handed to a scheduled background
 * operation. A null result means the organization is already fenced. */
export async function beginGdprLocalWriteLease(
  database: RawDatabase,
  organizationId: string,
  kind: GdprLocalWriteKind,
): Promise<GdprLocalWriteLease | null> {
  const leaseId = await acquireGdprLocalWriteLease(database, organizationId, kind)
  if (!leaseId) return null
  let releasePromise: Promise<void> | null = null
  return {
    leaseId,
    release: () => {
      releasePromise ??= releaseGdprLocalWriteLease(database, organizationId, leaseId, kind)
      return releasePromise
    },
  }
}

export async function beginGdprUserWriteLease(
  database: RawDatabase,
  userId: string,
  kind: GdprLocalWriteKind,
): Promise<GdprLocalWriteLease | null> {
  const leaseId = await acquireGdprUserWriteLease(database, userId, kind)
  if (!leaseId) return null
  let releasePromise: Promise<void> | null = null
  return {
    leaseId,
    release: () => {
      releasePromise ??= releaseGdprUserWriteLease(database, userId, leaseId, kind)
      return releasePromise
    },
  }
}

/**
 * Registers an in-flight local side effect before it begins. Organization
 * erasure flips the same database fence first and will not proceed while any
 * lease remains, so an upload can neither start after the purge nor finish
 * unnoticed while the purge is running.
 */
export async function withGdprLocalWriteLease<T>(
  database: RawDatabase,
  organizationId: string,
  kind: GdprLocalWriteKind,
  operation: () => Promise<T>,
): Promise<T> {
  const leaseId = await acquireGdprLocalWriteLease(database, organizationId, kind)
  if (!leaseId) {
    throw new Error('CRM local-write lease did not return an exact organization receipt')
  }

  try {
    return await operation()
  } finally {
    await releaseGdprLocalWriteLease(database, organizationId, leaseId, kind)
  }
}

export async function withGdprUserWriteLease<T>(
  database: RawDatabase,
  userId: string | null | undefined,
  kind: GdprLocalWriteKind,
  operation: () => Promise<T>,
): Promise<T> {
  if (!userId) {
    throw new Error('CRM user-write lease requires an authenticated user')
  }
  const leaseId = await acquireGdprUserWriteLease(database, userId, kind)
  if (!leaseId) {
    throw new Error('CRM user-write lease was rejected by the erasure fence')
  }
  try {
    return await operation()
  } finally {
    await releaseGdprUserWriteLease(database, userId, leaseId, kind)
  }
}

/** Search workers use this form so a queued pre-erasure write is discarded
 * after the organization fence becomes deleting, instead of retrying forever. */
export async function tryWithGdprLocalWriteLease<T>(
  database: RawDatabase,
  organizationId: string,
  kind: GdprLocalWriteKind,
  operation: () => Promise<T>,
): Promise<{ executed: false } | { executed: true; value: T }> {
  const leaseId = await acquireGdprLocalWriteLease(database, organizationId, kind)
  if (!leaseId) return { executed: false }
  try {
    return { executed: true, value: await operation() }
  } finally {
    await releaseGdprLocalWriteLease(database, organizationId, leaseId, kind)
  }
}
