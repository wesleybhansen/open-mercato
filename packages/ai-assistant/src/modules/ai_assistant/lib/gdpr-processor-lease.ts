import type { EntityManager } from '@mikro-orm/postgresql'
import {
  beginGdprLocalWriteLease,
  beginGdprUserWriteLease,
  type GdprLocalWriteLease,
} from '@open-mercato/core/modules/auth/lib/gdprLocalWriteLease'

export const AI_ASSISTANT_GDPR_BLOCK_MESSAGE =
  'AI operations are unavailable while this account is being deleted.'

const LOCAL_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type AiAssistantAuth = {
  orgId?: string | null
  sub?: string | null
  userId?: string | null
}

export type AiAssistantProcessorLease = {
  organizationId: string
  localUserId: string
  release: () => Promise<void>
}

export function resolveAiAssistantLocalUserId(auth: AiAssistantAuth): string | null {
  const userId = auth.userId?.trim()
  if (userId && LOCAL_USER_ID.test(userId)) return userId
  const subject = auth.sub?.trim()
  return subject && LOCAL_USER_ID.test(subject) ? subject : null
}

async function releaseLeases(
  userLease: GdprLocalWriteLease | null,
  organizationLease: GdprLocalWriteLease,
): Promise<void> {
  let releaseError: unknown
  try {
    await userLease?.release()
  } catch (error) {
    releaseError = error
  }
  try {
    await organizationLease.release()
  } catch (error) {
    releaseError ??= error
  }
  if (releaseError) throw releaseError
}

/**
 * Admits one assistant operation under exact organization and user processor
 * fences. The caller owns the returned lease until every provider call and
 * related local write for that operation has settled.
 */
export async function beginAiAssistantProcessorLease(
  em: EntityManager,
  auth: AiAssistantAuth,
): Promise<AiAssistantProcessorLease | null> {
  const organizationId = auth.orgId?.trim()
  const localUserId = resolveAiAssistantLocalUserId(auth)
  if (!organizationId || !localUserId) return null

  const database = em.getKnex()
  let organizationLease: GdprLocalWriteLease | null = null
  let userLease: GdprLocalWriteLease | null = null
  try {
    organizationLease = await beginGdprLocalWriteLease(
      database as never,
      organizationId,
      'processor',
    )
    if (!organizationLease) return null

    userLease = await beginGdprUserWriteLease(database as never, localUserId, 'processor')
    if (!userLease) {
      await organizationLease.release().catch(() => {})
      return null
    }

    const acquiredOrganizationLease = organizationLease
    const acquiredUserLease = userLease
    let releasePromise: Promise<void> | null = null
    return {
      organizationId,
      localUserId,
      release: () => {
        releasePromise ??= releaseLeases(acquiredUserLease, acquiredOrganizationLease)
        return releasePromise
      },
    }
  } catch {
    if (organizationLease) {
      await releaseLeases(userLease, organizationLease).catch(() => {})
    }
    return null
  }
}
