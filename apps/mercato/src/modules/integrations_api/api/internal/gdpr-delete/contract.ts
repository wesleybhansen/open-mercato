export const GDPR_DELETE_CONTRACT = 'noli-gdpr-delete-v2' as const

export type GdprDeletePhase = 'user' | 'organization'
export type GdprDeleteStatus = 'complete' | 'partial' | 'skipped' | 'ambiguous'

export type GdprDeleteRequest = {
  contract: typeof GDPR_DELETE_CONTRACT
  operationId: string
  app: 'crm'
  phase: GdprDeletePhase
  noliUserId: string
  noliOrgId: string | null
  email: string | null
  clerkUserId: string | null
}

const REQUEST_KEYS = [
  'app',
  'clerkUserId',
  'contract',
  'email',
  'noliOrgId',
  'noliUserId',
  'operationId',
  'phase',
] as const

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function nullableString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0)
}

export function parseGdprDeleteRequest(value: unknown): GdprDeleteRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  if (!hasExactKeys(request, REQUEST_KEYS)) return null
  if (
    request.contract !== GDPR_DELETE_CONTRACT ||
    request.app !== 'crm' ||
    !['user', 'organization'].includes(String(request.phase)) ||
    typeof request.operationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.operationId,
    ) ||
    typeof request.noliUserId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.noliUserId,
    ) ||
    !(
      request.noliOrgId === null ||
      (typeof request.noliOrgId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          request.noliOrgId,
        ))
    ) ||
    !nullableString(request.email) ||
    !nullableString(request.clerkUserId) ||
    (request.phase === 'user' && request.email === null && request.clerkUserId === null)
  )
    return null
  return request as GdprDeleteRequest
}

export function gdprDeleteResponse(
  request: GdprDeleteRequest,
  status: GdprDeleteStatus,
  deleted: Record<string, number> = {},
  failures: string[] = [],
) {
  const complete = status === 'complete'
  const outcome = complete
    ? Object.values(deleted).some((count) => count > 0)
      ? 'purged'
      : 'already_absent'
    : 'incomplete'
  return {
    ok: complete,
    contract: GDPR_DELETE_CONTRACT,
    operationId: request.operationId,
    app: 'crm' as const,
    phase: request.phase,
    noliUserId: request.noliUserId,
    noliOrgId: request.noliOrgId,
    complete,
    status,
    outcome,
    deleted,
    failures: complete ? [] : failures.length ? failures : ['incomplete'],
  }
}
