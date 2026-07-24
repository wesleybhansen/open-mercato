import crypto from 'crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { Candidate, SourceAdapter } from '../adapters/types'
import {
  GtmCreditLedgerError,
  type GtmCreditLedger,
} from '../credits/ledger'
import { creditsForUnits, defaultMarkupMultiplier } from '../credits/markup'
import type { SourcePlanBatch } from './plan'
import { ruleBasedFitScorer, type FitScorer } from './qualify'
import { GtmCandidate, GtmEvidence, GtmProviderOperation, GtmResearchRun } from '../../data/entities'

/*
 * Research-run execution against source adapters through the SPEC-066 section
 * 11.2 credit-coupled wrapper. Per planned batch, in order:
 *
 *   1. cap check (maxCandidates reached, or maxCredits would be exceeded by
 *      this reserve) -> stop planning further batches
 *   2. ledger.reserve BEFORE any adapter call; insufficient_credits fails the
 *      run closed with ZERO adapter calls for that batch
 *   3. GtmProviderOperation shadow row (noli_core_operation_id = the canonical
 *      operation id; shadow only, never a balance)
 *   4. ledger.start
 *   5. adapter.search (fixture in this tranche)
 *   6. outcome:
 *      ok/partial   -> settle charged|partially_charged with
 *                      actual units x quoted x markup
 *      no_result    -> settle refunded 0 when pay_on_found, else charged
 *      ambiguous    -> ledger.markAmbiguous + shadow parked, NO retry, run
 *                      continues but is flagged reconciliation_required
 *      error        -> settle refunded 0 + failure recorded
 *   7. candidates inserted with dedupe_key = sha256 of the normalized
 *      identity, honoring the unique (org, workspace, dedupe_key) constraint
 *      race-safely (unique violation = counted duplicate); evidence rows from
 *      adapter receipts; deterministic rule-based qualification
 *
 * Every write happens inside em.transactional. Candidate inserts run in
 * per-candidate transactions so a unique-constraint duplicate aborts only
 * that candidate's insert (a violation inside one shared Postgres transaction
 * would poison every later write in it).
 */

// Minimal structural slice of MikroORM's EntityManager used here, so tests
// can drive execution with an in-memory fake and routes pass the real em.
export interface ResearchEm {
  transactional<T>(cb: (tem: ResearchEm) => Promise<T>): Promise<T>
  create<T extends object>(entityClass: new () => T, data: object): T
  persist(entity: object): unknown
  flush(): Promise<void>
}

export type ExecuteResearchRunDeps = {
  em: ResearchEm
  ledger: GtmCreditLedger
  // adapter_id -> adapter; the fixture registry in this tranche
  adapters: Record<string, SourceAdapter>
  run: GtmResearchRun
  play: {
    id?: string
    signal?: string | null
    entityUnit?: string | null
    geography?: string | null
  }
  userId: string
  scorer?: FitScorer
  markupMultiplier?: number
  now?: () => Date
}

export type BatchOutcome = {
  batchNo: number
  adapterId: string
  idempotencyKey: string
  operationId: string | null
  // adapter result status, or a skip marker when the adapter was never called
  outcome:
    | 'ok'
    | 'partial'
    | 'no_result'
    | 'error'
    | 'ambiguous'
    | 'skipped_max_candidates'
    | 'skipped_max_credits'
    | 'blocked_insufficient_credits'
  ledgerStatus: string | null
  chargedCredits: number
  candidatesInserted: number
  duplicatesSkipped: number
  failureReason: string | null
}

export type ResearchRunExecutionResult = {
  status: 'completed' | 'failed'
  failureReason: string | null
  reconciliationRequired: boolean
  reconciledCredits: number
  candidatesInserted: number
  duplicatesSkipped: number
  evidenceInserted: number
  batches: BatchOutcome[]
}

const CANDIDATE_RETENTION_DAYS = 90

// dedupe_key = sha256 of the normalized identity triple
// (entity_kind|name|domain-or-city), SPEC-066 section 4.
export function candidateDedupeKey(candidate: Pick<Candidate, 'entity_kind' | 'identity'>): string {
  const identity = (candidate.identity ?? {}) as Record<string, unknown>
  const name = normalizePart(identity.name)
  const domainOrCity =
    normalizePart(identity.domain) || normalizePart(identity.city) || normalizePart(identity.location)
  const material = `${candidate.entity_kind}|${name}|${domainOrCity}`
  return crypto.createHash('sha256').update(material).digest('hex')
}

function normalizePart(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : ''
}

type ParsedProviderPlan = {
  adapterPlan: SourcePlanBatch[]
  query: string
}

function parseProviderPlan(run: GtmResearchRun): ParsedProviderPlan {
  const plan = (run.providerPlan ?? {}) as Record<string, unknown>
  const adapterPlan = Array.isArray(plan.adapterPlan) ? (plan.adapterPlan as SourcePlanBatch[]) : []
  const query = typeof plan.query === 'string' ? plan.query : ''
  return { adapterPlan, query }
}

function parseLimits(run: GtmResearchRun): { maxCandidates: number; maxCredits: number } {
  const limits = (run.limits ?? {}) as Record<string, unknown>
  const maxCandidates = Number(limits.maxCandidates)
  const maxCredits = Number(limits.maxCredits)
  return {
    maxCandidates: Number.isFinite(maxCandidates) && maxCandidates > 0 ? Math.floor(maxCandidates) : 0,
    maxCredits: Number.isFinite(maxCredits) && maxCredits > 0 ? Math.floor(maxCredits) : 0,
  }
}

export async function executeResearchRun(
  deps: ExecuteResearchRunDeps,
): Promise<ResearchRunExecutionResult> {
  const { em, ledger, adapters, run, play, userId } = deps
  const scorer = deps.scorer ?? ruleBasedFitScorer
  const markup = deps.markupMultiplier ?? defaultMarkupMultiplier()
  const now = deps.now ?? (() => new Date())

  const { adapterPlan, query } = parseProviderPlan(run)
  const limits = parseLimits(run)

  const batches: BatchOutcome[] = []
  const adapterBatchCounters = new Map<string, number>()
  let candidatesInserted = 0
  let duplicatesSkipped = 0
  let evidenceInserted = 0
  let reconciledCredits = 0
  let outstandingReserved = 0
  let reconciliationRequired = false
  let failureReason: string | null = null

  for (const planned of adapterPlan) {
    const batchNo = (adapterBatchCounters.get(planned.adapter_id) ?? 0) + 1
    adapterBatchCounters.set(planned.adapter_id, batchNo)
    const idempotencyKey = `${run.id}:${planned.adapter_id}:${batchNo}`

    const base: BatchOutcome = {
      batchNo,
      adapterId: planned.adapter_id,
      idempotencyKey,
      operationId: null,
      outcome: 'error',
      ledgerStatus: null,
      chargedCredits: 0,
      candidatesInserted: 0,
      duplicatesSkipped: 0,
      failureReason: null,
    }

    // Cap: stop planning further batches once maxCandidates is reached.
    if (limits.maxCandidates > 0 && candidatesInserted >= limits.maxCandidates) {
      batches.push({ ...base, outcome: 'skipped_max_candidates' })
      continue
    }

    const remainingCandidates =
      limits.maxCandidates > 0 ? limits.maxCandidates - candidatesInserted : planned.estimatedUnits
    const requestUnits = Math.min(planned.estimatedUnits, remainingCandidates)
    const batchEstimatedCredits = creditsForUnits(requestUnits, planned.quotedCreditsPerUnit, markup)

    // Cap: stop BEFORE a reserve that would exceed maxCredits.
    if (
      limits.maxCredits > 0 &&
      reconciledCredits + outstandingReserved + batchEstimatedCredits > limits.maxCredits
    ) {
      batches.push({ ...base, outcome: 'skipped_max_credits' })
      continue
    }

    const adapter = adapters[planned.adapter_id]
    if (!adapter) {
      batches.push({ ...base, outcome: 'error', failureReason: `unknown adapter ${planned.adapter_id}` })
      continue
    }

    // 1. Reserve BEFORE any adapter call. Insufficient credits fails the run
    //    closed with zero adapter calls.
    let operationId: string
    try {
      const reserved = await ledger.reserve({
        orgId: run.organizationId,
        userId,
        kind: 'source_search',
        provider: planned.adapter_id,
        estimatedCredits: batchEstimatedCredits,
        idempotencyKey,
        unitCostSnapshot: {
          unit: 'candidate',
          quoted_credits_per_unit: planned.quotedCreditsPerUnit,
          markup_multiplier: markup,
        },
        fingerprint: {
          research_run_id: run.id,
          adapter_id: planned.adapter_id,
          batch_no: batchNo,
          signal_kind: planned.capability.signal_kind,
          entity_unit: planned.capability.entity_unit,
          geography: planned.capability.geography,
          query,
          max_candidates: requestUnits,
        },
      })
      operationId = reserved.operationId
    } catch (err) {
      if (err instanceof GtmCreditLedgerError && err.code === 'insufficient_credits') {
        failureReason = err.message
        batches.push({ ...base, outcome: 'blocked_insufficient_credits', failureReason: err.message })
        break
      }
      throw err
    }
    outstandingReserved += batchEstimatedCredits

    // 2. Shadow row before provider contact (receipt lands later).
    const shadow = await em.transactional(async (tem) => {
      const row = tem.create(GtmProviderOperation, {
        organizationId: run.organizationId,
        tenantId: run.tenantId,
        noliCoreOperationId: operationId,
        researchRunId: run.id,
        kind: 'source_search',
        provider: planned.adapter_id,
        localStatusMirror: 'reserved',
        requestedAt: now(),
      })
      tem.persist(row)
      await tem.flush()
      return row
    })

    // 3. Start, then the single provider call.
    await ledger.start(operationId)

    /*
     * NOTE on max_charge_usd: the wrapper reserves in CREDITS, and this module
     * has no credits-to-USD rate (markup.ts prices credits, it does not price
     * dollars). Rather than invent a conversion, the plan omits the field and
     * the Apify adapter falls back to its own configured per-run USD cap. When
     * a real credits-to-USD rate exists, pass it here and the provider-side
     * hard cap becomes the same number as the reservation.
     */
    const result = await adapter.search({
      signal_kind: planned.capability.signal_kind,
      entity_unit: planned.capability.entity_unit,
      geography: planned.capability.geography,
      query,
      max_candidates: requestUnits,
    })

    // 4. Outcome handling (exactly one ledger settlement path per batch).
    const receipt = (result.receipt ?? null) as Record<string, unknown> | null
    let ledgerStatus: string
    let chargedCredits = 0
    let batchFailure: string | null = null

    if (result.status === 'ok' || result.status === 'partial') {
      const actualUnits = result.cost_units ?? (Array.isArray(result.data) ? result.data.length : 0)
      chargedCredits = Math.min(
        creditsForUnits(actualUnits, planned.quotedCreditsPerUnit, markup),
        batchEstimatedCredits,
      )
      ledgerStatus = await ledger.settle(
        operationId,
        result.status === 'partial' ? 'partially_charged' : 'charged',
        chargedCredits,
        receipt,
      )
      reconciledCredits += chargedCredits
      outstandingReserved -= batchEstimatedCredits
    } else if (result.status === 'no_result') {
      if (adapter.descriptor.cost_model.pay_on_found) {
        ledgerStatus = await ledger.settle(operationId, 'refunded', 0, receipt)
      } else {
        chargedCredits = Math.min(
          creditsForUnits(result.cost_units ?? 1, planned.quotedCreditsPerUnit, markup),
          batchEstimatedCredits,
        )
        ledgerStatus = await ledger.settle(operationId, 'charged', chargedCredits, receipt)
        reconciledCredits += chargedCredits
      }
      outstandingReserved -= batchEstimatedCredits
    } else if (result.status === 'ambiguous') {
      // Unknown outcome: park the SAME operation, never retry, never infer a
      // charge locally. The reservation stays escrowed until reconciliation.
      ledgerStatus = await ledger.markAmbiguous(operationId, {
        error: result.error ?? 'ambiguous provider outcome',
        receipt,
      })
      reconciliationRequired = true
      batchFailure = result.error ?? 'ambiguous provider outcome'
    } else {
      // Definitive error: refund the reservation, record the failure, and
      // continue with the remaining batches.
      ledgerStatus = await ledger.settle(operationId, 'refunded', 0, receipt)
      outstandingReserved -= batchEstimatedCredits
      batchFailure = result.error ?? 'provider error'
    }

    // 5. Mirror the outcome on the shadow row (jsonb receipt carries the
    //    ambiguity timestamp; the shadow never stores balances).
    await em.transactional(async (tem) => {
      shadow.localStatusMirror = ledgerStatus
      shadow.receipt =
        result.status === 'ambiguous'
          ? { ...(receipt ?? {}), ambiguous_at: now().toISOString(), detail: result.error ?? null }
          : receipt
      if (result.status !== 'ambiguous') shadow.settledAt = now()
      tem.persist(shadow)
      await tem.flush()
    })

    // 6. Candidates + evidence + deterministic qualification.
    let batchInserted = 0
    let batchDuplicates = 0
    const found = Array.isArray(result.data) ? result.data : []
    for (const candidate of found) {
      if (limits.maxCandidates > 0 && candidatesInserted >= limits.maxCandidates) break
      const fit = scorer.score(candidate, play, candidate.evidence ?? [])
      const dedupeKey = candidateDedupeKey(candidate)
      try {
        const insertedEvidence = await em.transactional(async (tem) => {
          const row = tem.create(GtmCandidate, {
            // app-side id so evidence rows can reference the candidate before
            // the transaction flushes (the column default is DB-generated)
            id: crypto.randomUUID(),
            organizationId: run.organizationId,
            tenantId: run.tenantId,
            researchRunId: run.id,
            workspaceId: run.workspaceId,
            entityKind: candidate.entity_kind,
            identity: candidate.identity as Record<string, unknown>,
            dedupeKey,
            fitStatus: fit.verdict,
            fitScore: String(fit.fitScore),
            rejectReason: fit.verdict === 'rejected' ? fit.reason : null,
            retentionExpiresAt: new Date(
              now().getTime() + CANDIDATE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
            ),
          })
          tem.persist(row)
          let evidenceRows = 0
          for (const evidence of candidate.evidence ?? []) {
            const evidenceRow = tem.create(GtmEvidence, {
              organizationId: run.organizationId,
              tenantId: run.tenantId,
              candidateId: row.id,
              claim: evidence.claim,
              sourceUrl: evidence.source_url ?? null,
              providerRef: {
                provider: planned.adapter_id,
                operation_id: operationId,
                provider_request_id: receipt?.provider_request_id ?? null,
                query,
                // inert per-observation detail from the adapter (engagement
                // kind, reaction types, comment body); present only when the
                // adapter actually captured some, never fabricated
                ...(evidence.detail ? { detail: evidence.detail } : {}),
              },
              observedAt: evidence.observed_at ? new Date(evidence.observed_at) : null,
              confidence: String(evidence.confidence),
            })
            tem.persist(evidenceRow)
            evidenceRows += 1
          }
          await tem.flush()
          return evidenceRows
        })
        batchInserted += 1
        candidatesInserted += 1
        evidenceInserted += insertedEvidence
      } catch (err) {
        // Race-safe dedupe: a concurrent (or same-run) duplicate loses the
        // unique (org, workspace, dedupe_key) race and is counted, not fatal.
        if (err instanceof UniqueConstraintViolationException) {
          batchDuplicates += 1
          duplicatesSkipped += 1
          continue
        }
        throw err
      }
    }

    batches.push({
      ...base,
      operationId,
      outcome: result.status,
      ledgerStatus,
      chargedCredits,
      candidatesInserted: batchInserted,
      duplicatesSkipped: batchDuplicates,
      failureReason: batchFailure,
    })
  }

  const status: 'completed' | 'failed' = failureReason ? 'failed' : 'completed'
  const summary: ResearchRunExecutionResult = {
    status,
    failureReason,
    reconciliationRequired,
    reconciledCredits,
    candidatesInserted,
    duplicatesSkipped,
    evidenceInserted,
    batches,
  }

  // 7. Finalize the run row: status, reconciled credits, and the execution
  //    summary folded into the provider_plan jsonb (reconciliation_required
  //    and failure_reason live here; the entity has no dedicated columns and
  //    Tranche 3 adds no schema).
  await em.transactional(async (tem) => {
    run.status = status
    run.reconciledCredits = String(reconciledCredits)
    run.completedAt = now()
    run.providerPlan = {
      ...((run.providerPlan ?? {}) as Record<string, unknown>),
      execution: {
        status,
        failure_reason: failureReason,
        reconciliation_required: reconciliationRequired,
        reconciled_credits: reconciledCredits,
        candidates_inserted: candidatesInserted,
        duplicates_skipped: duplicatesSkipped,
        evidence_inserted: evidenceInserted,
        batches: batches.map((batch) => ({
          batch_no: batch.batchNo,
          adapter_id: batch.adapterId,
          idempotency_key: batch.idempotencyKey,
          operation_id: batch.operationId,
          outcome: batch.outcome,
          ledger_status: batch.ledgerStatus,
          charged_credits: batch.chargedCredits,
          candidates_inserted: batch.candidatesInserted,
          duplicates_skipped: batch.duplicatesSkipped,
          failure_reason: batch.failureReason,
        })),
      },
    }
    tem.persist(run)
    await tem.flush()
  })

  return summary
}
