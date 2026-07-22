import type { EntityManager } from '@mikro-orm/postgresql'
import { ApiKey } from '../data/entities'

export type OpenCodeSessionOwner = {
  localUserId: string
  organizationId: string
  tenantId: string
}

export type OpenCodeSessionBinding = OpenCodeSessionOwner & {
  keyId: string
  sessionId: string
  expiresAt: Date
}

type NewOpenCodeSessionBinding = OpenCodeSessionOwner & {
  keyId: string
  sessionToken: string
  sessionId: string
}

function activeBinding(record: ApiKey): OpenCodeSessionBinding | null {
  if (
    !record.opencodeSessionId
    || !record.sessionUserId
    || !record.organizationId
    || !record.tenantId
    || !record.expiresAt
    || record.expiresAt.getTime() <= Date.now()
  ) {
    return null
  }
  return {
    keyId: record.id,
    sessionId: record.opencodeSessionId,
    localUserId: record.sessionUserId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    expiresAt: record.expiresAt,
  }
}

export async function bindOpenCodeSession(
  em: EntityManager,
  input: NewOpenCodeSessionBinding,
): Promise<OpenCodeSessionBinding> {
  const record = await em.findOne(ApiKey, {
    id: input.keyId,
    sessionToken: input.sessionToken,
    sessionUserId: input.localUserId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    deletedAt: null,
  })
  if (!record || !record.expiresAt || record.expiresAt.getTime() <= Date.now()) {
    throw new Error('OpenCode session key ownership receipt was not exact')
  }
  if (record.opencodeSessionId && record.opencodeSessionId !== input.sessionId) {
    throw new Error('OpenCode session key is already bound to another session')
  }

  const conflicting = await em.findOne(ApiKey, {
    opencodeSessionId: input.sessionId,
    deletedAt: null,
  })
  if (conflicting && conflicting.id !== record.id) {
    throw new Error('OpenCode session is already bound to another owner')
  }

  record.opencodeSessionId = input.sessionId
  await em.persistAndFlush(record)
  const binding = activeBinding(record)
  if (!binding || binding.sessionId !== input.sessionId) {
    throw new Error('OpenCode session binding receipt was not exact')
  }
  return binding
}

export async function findOwnedOpenCodeSession(
  em: EntityManager,
  sessionId: string,
  owner: OpenCodeSessionOwner,
): Promise<OpenCodeSessionBinding | null> {
  if (!sessionId.trim()) return null
  const record = await em.findOne(ApiKey, {
    opencodeSessionId: sessionId,
    sessionUserId: owner.localUserId,
    organizationId: owner.organizationId,
    tenantId: owner.tenantId,
    deletedAt: null,
  })
  const binding = record ? activeBinding(record) : null
  return binding?.sessionId === sessionId ? binding : null
}
