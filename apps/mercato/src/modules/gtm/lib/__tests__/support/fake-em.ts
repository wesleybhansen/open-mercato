import crypto from 'crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { GtmCandidate } from '../../../data/entities'
import type { ResearchEm } from '../../research/execute'
import type { RetentionEm } from '../../retention/sweep'

/*
 * In-memory structural stand-in for MikroORM's EntityManager, covering
 * exactly the slices the gtm library code uses (ResearchEm + RetentionEm).
 * It enforces the one constraint the executor must handle race-safely: the
 * unique (organization_id, workspace_id, dedupe_key) index on gtm_candidates
 * throws UniqueConstraintViolationException at flush time, before anything
 * in the pending batch is inserted (mirroring a Postgres transaction abort).
 * `find` supports the narrow where-operator vocabulary the sweep uses:
 * equality, null, { $in: [...] }, and { $lte: Date }.
 */
export class FakeEm implements ResearchEm, RetentionEm {
  private rows = new Map<Function, object[]>()
  private pending: object[] = []
  private pendingRemovals: object[] = []

  table<T extends object>(Ctor: new () => T): T[] {
    return (this.rows.get(Ctor) ?? []) as T[]
  }

  async transactional<T>(cb: (tem: FakeEm) => Promise<T>): Promise<T> {
    try {
      return await cb(this)
    } finally {
      // Anything persisted but never flushed inside the callback is dropped,
      // and a throw leaves previously flushed tables untouched (the fake
      // flush is all-or-nothing per batch).
      this.pending = []
      this.pendingRemovals = []
    }
  }

  create<T extends object>(Ctor: new () => T, data: object): T {
    const entity = new Ctor()
    Object.assign(entity, data)
    const withId = entity as { id?: string }
    if (!withId.id) withId.id = crypto.randomUUID()
    return entity
  }

  persist(entity: object): unknown {
    this.pending.push(entity)
    return this
  }

  remove(entity: object): unknown {
    this.pendingRemovals.push(entity)
    return this
  }

  async find<T extends object>(Ctor: new () => T, where: Record<string, unknown>): Promise<T[]> {
    return this.table(Ctor).filter((row) => matchesWhere(row, where))
  }

  async flush(): Promise<void> {
    // Validate the whole pending batch first so a violation inserts nothing.
    for (const entity of this.pending) {
      if (entity instanceof GtmCandidate) {
        const duplicate = this.table(GtmCandidate).some(
          (row) =>
            row !== entity &&
            row.organizationId === entity.organizationId &&
            row.workspaceId === entity.workspaceId &&
            row.dedupeKey === entity.dedupeKey,
        )
        if (duplicate) {
          this.pending = []
          throw new UniqueConstraintViolationException(
            new Error(`duplicate key value violates unique constraint: ${entity.dedupeKey}`),
          )
        }
      }
    }
    for (const entity of this.pending) {
      const Ctor = entity.constructor as new () => object
      const arr = this.rows.get(Ctor) ?? []
      if (!arr.includes(entity)) arr.push(entity)
      this.rows.set(Ctor, arr)
    }
    this.pending = []
    for (const entity of this.pendingRemovals) {
      const Ctor = entity.constructor as new () => object
      const arr = this.rows.get(Ctor) ?? []
      const index = arr.indexOf(entity)
      if (index >= 0) arr.splice(index, 1)
      this.rows.set(Ctor, arr)
    }
    this.pendingRemovals = []
  }
}

// Narrow where matcher: equality, null, { $in: [...] }, { $lte: Date }.
function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as Record<string, unknown>)[key]
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const ops = condition as Record<string, unknown>
      if ('$in' in ops) {
        if (!Array.isArray(ops.$in) || !ops.$in.includes(value)) return false
      }
      if ('$lte' in ops) {
        const bound = ops.$lte
        if (value == null) return false
        if (value instanceof Date && bound instanceof Date) {
          if (value.getTime() > bound.getTime()) return false
        } else if ((value as number | string) > (bound as number | string)) {
          return false
        }
      }
      continue
    }
    if (condition === null) {
      if (value != null) return false
      continue
    }
    if (value !== condition) return false
  }
  return true
}
