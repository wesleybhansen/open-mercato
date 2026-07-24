import crypto from 'crypto'
import type { CampaignEm, CampaignTemplate, GtmCtx } from './build'
import { GtmCampaign, GtmCandidate, GtmEvidence, GtmPlay } from '../../data/entities'

/*
 * Per-recipient template rendering (SPEC-066 section 14 Tranche 5).
 *
 * Deterministic merge-field substitution over a single {subject, body}
 * template. Supported fields and their GROUNDED sources:
 *
 *   {{first_name}}  first token of candidate identity.name
 *   {{company}}     candidate identity.company (or the name itself for a
 *                   company-kind candidate)
 *   {{signal}}      the candidate's highest-confidence evidence claim
 *   {{why_now}}     the play's why_now line (part of the play the user
 *                   approved, grounded by import)
 *
 * A missing field renders the honest review token [[missing:field]] and
 * flags the row needs_review; a fact is NEVER invented to fill a hole.
 *
 * Injection safety: candidate- and evidence-sourced text is DATA. Every
 * merge value is sanitized by stripping curly braces before substitution, so
 * a candidate whose name or evidence contains "{{evil}}" (or any template-
 * like sequence) can never introduce a token that expands. Substitution is
 * single-pass on the template only; rendered output is scanned and any
 * remaining {{...}} token (an unsupported field typed into the template)
 * flags the row for review instead of silently shipping.
 *
 * content_hash = sha256(subject + '\n' + body_html), the per-message hash
 * frozen onto gtm_rendered_messages at approval and folded into the draft
 * content hash (approve.ts).
 *
 * Compliance footer: every rendered body (html + text) ends with a
 * standardized footer carrying the sending ORG's business postal address
 * (CAN-SPAM: the sender is the customer's org, not Noli; read from workspace
 * settings and passed in by the caller) and an unsubscribe line holding the
 * literal token [[unsubscribe_url]]. The footer, address included, is part
 * of the frozen rendered content and therefore hash-covered. The token stays
 * a token in the stored row: the execution layer substitutes the real
 * per-enrollment URL on a copy at send time (lib/execute/send.ts). A missing
 * postal address renders the honest [[missing:postal_address]] token and
 * flags the row for review; approval is blocked separately until the address
 * is set (lib/campaign/approve.ts).
 */

export type RenderedPreview = {
  candidateId: string
  subject: string
  bodyHtml: string
  bodyText: string
  contentHash: string
  needsReview: boolean
  missingFields: string[]
}

const MERGE_FIELDS = ['first_name', 'company', 'signal', 'why_now'] as const
type MergeField = (typeof MERGE_FIELDS)[number]

const MERGE_TOKEN = /\{\{\s*(first_name|company|signal|why_now)\s*\}\}/g
const ANY_TOKEN = /\{\{[^}]*\}\}/

// Literal token stored in the frozen rendered content; replaced with the real
// per-enrollment unsubscribe URL only on the send-time copy (execute/send.ts).
export const UNSUBSCRIBE_URL_TOKEN = '[[unsubscribe_url]]'

export function substituteUnsubscribeUrl(content: string, url: string): string {
  return content.split(UNSUBSCRIBE_URL_TOKEN).join(url)
}

export function messageContentHash(subject: string, bodyHtml: string): string {
  return crypto.createHash('sha256').update(`${subject}\n${bodyHtml}`).digest('hex')
}

// Candidate-sourced text is data, never template: strip anything that could
// read as a merge token and collapse whitespace.
export function sanitizeMergeValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type MergeValues = Partial<Record<MergeField, string>>

function substitute(
  template: string,
  values: MergeValues,
  missing: Set<string>,
  transform: (value: string) => string,
): string {
  return template.replace(MERGE_TOKEN, (_match, field: MergeField) => {
    const value = values[field]
    if (!value) {
      missing.add(field)
      return `[[missing:${field}]]`
    }
    return transform(value)
  })
}

export function renderForCandidate(
  template: CampaignTemplate,
  values: MergeValues,
  candidateId: string,
  postalAddress: string | null = null,
): RenderedPreview {
  const missing = new Set<string>()
  const identity = (value: string) => value
  const subject = substitute(template.subject, values, missing, identity)
  let bodyText = substitute(template.body, values, missing, identity)
  // Escape the template body first (braces survive escaping), substitute
  // HTML-escaped values, then turn newlines into breaks.
  let bodyHtml = substitute(escapeHtml(template.body), values, missing, escapeHtml).replace(
    /\n/g,
    '<br/>',
  )

  // Standardized compliance footer on EVERY rendered body: the sending org's
  // postal address (CAN-SPAM) plus the unsubscribe token. Hash-covered as
  // part of the frozen content; a missing address is an honest review token,
  // never omitted silently.
  const address = typeof postalAddress === 'string' && postalAddress.trim() ? postalAddress.trim() : null
  if (!address) missing.add('postal_address')
  const addressText = address ?? '[[missing:postal_address]]'
  bodyText += `\n\n--\n${addressText}\nUnsubscribe: ${UNSUBSCRIBE_URL_TOKEN}`
  bodyHtml += `<br/><br/>--<br/>${address ? escapeHtml(address) : addressText}<br/>Unsubscribe: ${UNSUBSCRIBE_URL_TOKEN}`

  // Unsupported {{...}} tokens left in the output (typed into the template;
  // sanitized values can never contain braces) force a human review pass.
  const unresolved = ANY_TOKEN.test(subject) || ANY_TOKEN.test(bodyText)

  return {
    candidateId,
    subject,
    bodyHtml,
    bodyText,
    contentHash: messageContentHash(subject, bodyHtml),
    needsReview: missing.size > 0 || unresolved,
    missingFields: [...missing].sort(),
  }
}

export async function renderMessages(
  em: CampaignEm,
  ctx: GtmCtx,
  campaign: GtmCampaign,
  candidates: GtmCandidate[],
  template: CampaignTemplate,
  // The sending org's business postal address from workspace settings
  // (lib/workspace-settings.ts), passed in by the caller.
  postalAddress: string | null = null,
): Promise<RenderedPreview[]> {
  const play = await em.findOne(GtmPlay, {
    id: campaign.playId,
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    deletedAt: null,
  })
  const whyNow = sanitizeMergeValue(play?.whyNow ?? null)

  const candidateIds = candidates.map((candidate) => candidate.id)
  const evidence = candidateIds.length
    ? await em.find(GtmEvidence, {
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        candidateId: { $in: candidateIds },
        deletedAt: null,
      })
    : []
  // Highest-confidence claim per candidate; ties resolved by insertion order
  // so rendering stays deterministic.
  const topClaim = new Map<string, { claim: string; confidence: number }>()
  for (const row of evidence) {
    const confidence = Number(row.confidence ?? 0)
    const current = topClaim.get(row.candidateId)
    if (!current || confidence > current.confidence) {
      topClaim.set(row.candidateId, { claim: row.claim, confidence })
    }
  }

  return candidates.map((candidate) => {
    const identity = (candidate.identity ?? {}) as Record<string, unknown>
    const name = sanitizeMergeValue(identity.name)
    const values: MergeValues = {
      first_name: candidate.entityKind === 'person' ? name.split(' ')[0] || '' : '',
      company:
        sanitizeMergeValue(identity.company) ||
        (candidate.entityKind === 'company' ? name : ''),
      signal: sanitizeMergeValue(topClaim.get(candidate.id)?.claim ?? null),
      why_now: whyNow,
    }
    return renderForCandidate(template, values, candidate.id, postalAddress)
  })
}
