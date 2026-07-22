import {
  createOpenCodeClient,
  type OpenCodeClient,
} from './opencode-client'

export type OpenCodeSessionPurgeReceipt = {
  requested: number
  provenAbsent: number
}

/**
 * Abort, delete, and then prove absence for an exact durable inventory of
 * OpenCode sessions. A provider ambiguity rejects the whole operation so the
 * caller keeps its local ownership bindings for a safe retry.
 */
export async function purgeOpenCodeSessions(
  sessionIds: readonly string[],
  client?: Pick<OpenCodeClient, 'abortDeleteAndProveSessionAbsent'>,
): Promise<OpenCodeSessionPurgeReceipt> {
  const exactSessionIds = [...new Set(
    sessionIds
      .map((sessionId) => sessionId.trim())
      .filter(Boolean),
  )].sort()

  if (exactSessionIds.length === 0) {
    return { requested: 0, provenAbsent: 0 }
  }

  const provider = client ?? createOpenCodeClient()
  for (const sessionId of exactSessionIds) {
    await provider.abortDeleteAndProveSessionAbsent(sessionId)
  }

  return {
    requested: exactSessionIds.length,
    provenAbsent: exactSessionIds.length,
  }
}
