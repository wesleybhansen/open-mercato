import crypto from 'crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { GtmCandidate } from '../../../data/entities'
import type { ResearchEm } from '../../research/execute'

/*
 * In-memory structural stand-in for MikroORM's EntityManager, covering
 * exactly the slice the research execution code uses (ResearchEm). It
 * enforces the one constraint the executor must handle race-safely: the
 * unique (organization_id, workspace_id, dedupe_key) index on gtm_candidates
 * throws UniqueConstraintViolationException at flush time, before anything
 * in the pending batch is inserted (mirroring a Postgres transaction abort).
 */
export class FakeEm implements ResearchEm {
  private rows = new Map<Function, object[]>()
  private pending: object[] = []

  table<T extends object>(Ctor: new () => T): T[] {
    return (this.rows.get(Ctor) ?? []) as T[]
  }

  async transactional<T>(cb: (tem: ResearchEm) => Promise<T>): Promise<T> {
    try {
      return await cb(this)
    } finally {
      // Anything persisted but never flushed inside the callback is dropped,
      // and a throw leaves previously flushed tables untouched (the fake
      // flush is all-or-nothing per batch).
      this.pending = []
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
  }
}
