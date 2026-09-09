import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'

/**
 * Create a person contact through the ORM so the tenant-data encryption
 * subscriber runs (primary_email / display_name ciphertext + lookup hashes).
 * The public form, event, kiosk, chat, import, scan and affiliate paths used
 * raw knex inserts, which stored PII in plaintext and could never dedupe
 * against encrypted rows (2026-09-08 review, CRM finding H1).
 *
 * Returns the new contact id. Never throws for the caller's happy path to
 * keep: wrap in try/catch at the call site exactly like the old inserts.
 */
export type NewPersonContact = {
  organizationId: string
  tenantId: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  source: string
  status?: string | null
  lifecycleStage?: string | null
  firstName?: string | null
  lastName?: string | null
  description?: string | null
  /** Plaintext attribution JSON (form name, UTM); not PII, written after the ORM insert. */
  sourceDetails?: Record<string, unknown> | null
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' }
}

export async function createPersonContact(em: EntityManager, input: NewPersonContact): Promise<string> {
  const fork = em.fork()
  const now = new Date()
  const name = input.displayName.trim() || input.primaryEmail?.trim() || 'Unknown'
  const split = splitName(name)
  const entity = fork.create(CustomerEntity, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    kind: 'person',
    displayName: name,
    primaryEmail: input.primaryEmail ? input.primaryEmail.trim().toLowerCase() : null,
    primaryPhone: input.primaryPhone?.trim() || null,
    source: input.source,
    status: input.status ?? 'active',
    lifecycleStage: input.lifecycleStage === undefined ? 'prospect' : input.lifecycleStage,
    description: input.description ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  const person = fork.create(CustomerPersonProfile, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    entity,
    firstName: input.firstName ?? split.firstName,
    lastName: input.lastName ?? split.lastName,
    createdAt: now,
    updatedAt: now,
  })
  try {
    await fork.persistAndFlush([entity, person])
  } catch (err) {
    // A concurrent write for the same address won the race (unique index on
    // org + lower(email)): adopt the winner instead of failing the caller.
    if ((err as { code?: string })?.code === '23505' && input.primaryEmail) {
      const { findOrMergeContact } = await import('./dedup')
      const winner = await findOrMergeContact(em.getKnex(), input.organizationId, input.tenantId, input.primaryEmail.trim().toLowerCase(), name, input.primaryPhone ?? undefined, em)
      if (winner.existing?.id) return winner.existing.id
    }
    throw err
  }
  if (input.sourceDetails) {
    await em.getKnex()('customer_entities').where('id', entity.id).update({ source_details: JSON.stringify(input.sourceDetails) }).catch(() => {})
  }
  return entity.id
}
