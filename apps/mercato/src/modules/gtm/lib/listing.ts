import { GtmCampaign, GtmContactPoint, GtmEvidence, GtmResearchRun } from '../data/entities'

/*
 * Read-side list helpers for the internal GTM routes (SPEC-066 section 5).
 *
 * The hub workspace UI needs workspace-wide lists of campaigns and research
 * runs (it previously tracked created ids browser-locally) plus per-candidate
 * verification/evidence rollups for the People tab. Everything here is
 * self-scoped by organization_id + tenant_id, excludes soft-deleted rows,
 * caps at GTM_LIST_CAP rows, and orders newest first. The enrichment rollup
 * runs exactly one grouped query per table over the page's candidate ids
 * (never one query per candidate).
 */

export const GTM_LIST_CAP = 50

// Narrow EntityManager slice: find with the orderBy/limit options the real
// MikroORM EntityManager accepts; FakeEm mirrors the same semantics in tests.
export interface ListEm {
  find<T extends object>(
    entityClass: new () => T,
    where: Record<string, unknown>,
    options?: { orderBy?: Record<string, 'asc' | 'desc'>; limit?: number },
  ): Promise<T[]>
}

// Identity resolved server-side at the route boundary; never caller-supplied.
export type ListCtx = { organizationId: string; tenantId: string }

function scopedWhere(ctx: ListCtx): Record<string, unknown> {
  return { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }
}

export async function listCampaigns(
  em: ListEm,
  ctx: ListCtx,
  filters: { workspaceId?: string | null } = {},
): Promise<GtmCampaign[]> {
  const where = scopedWhere(ctx)
  if (filters.workspaceId) where.workspaceId = filters.workspaceId
  return em.find(GtmCampaign, where, { orderBy: { createdAt: 'desc' }, limit: GTM_LIST_CAP })
}

export async function listResearchRuns(
  em: ListEm,
  ctx: ListCtx,
  filters: { workspaceId?: string | null; playId?: string | null } = {},
): Promise<GtmResearchRun[]> {
  const where = scopedWhere(ctx)
  if (filters.workspaceId) where.workspaceId = filters.workspaceId
  if (filters.playId) where.playId = filters.playId
  return em.find(GtmResearchRun, where, { orderBy: { createdAt: 'desc' }, limit: GTM_LIST_CAP })
}

export type CandidateEnrichment = {
  // A GtmContactPoint with channel 'email' and verification_state 'verified'
  // exists for the candidate.
  hasVerifiedEmail: boolean
  evidenceCount: number
}

/** Per-candidate verification + evidence rollup for one page of candidates.
 *  Two grouped queries total (contact points + evidence), each $in-scoped to
 *  the page's candidate ids and self-scoped to the caller org. Ids with no
 *  matching rows come back as { hasVerifiedEmail: false, evidenceCount: 0 }. */
export async function candidateEnrichment(
  em: ListEm,
  ctx: ListCtx,
  candidateIds: string[],
): Promise<Map<string, CandidateEnrichment>> {
  const rollup = new Map<string, CandidateEnrichment>()
  for (const id of candidateIds) rollup.set(id, { hasVerifiedEmail: false, evidenceCount: 0 })
  if (candidateIds.length === 0) return rollup

  const scope = { ...scopedWhere(ctx), candidateId: { $in: candidateIds } }
  const [verifiedEmails, evidence] = await Promise.all([
    em.find(GtmContactPoint, { ...scope, channel: 'email', verificationState: 'verified' }),
    em.find(GtmEvidence, scope),
  ])
  for (const point of verifiedEmails) {
    const entry = rollup.get(point.candidateId)
    if (entry) entry.hasVerifiedEmail = true
  }
  for (const row of evidence) {
    const entry = rollup.get(row.candidateId)
    if (entry) entry.evidenceCount += 1
  }
  return rollup
}
