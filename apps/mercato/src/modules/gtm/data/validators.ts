import { z } from 'zod'

const optionalText = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))

// Typed play payload per GTM-SPEC-01 section 3.5. The hub's play type names
// the sourcing hint `source`; SPEC-066 stores it as `source_hint` (the CRM
// `source` column means imported | authored), so both spellings are accepted.
export const importedPlaySchema = z.object({
  market_type: optionalText,
  audience: optionalText,
  signal: optionalText,
  source_hint: optionalText,
  source: optionalText,
  geography: optionalText,
  recency_window: optionalText,
  why_now: optionalText,
  recommended_angle: optionalText,
  supported_channels: z.array(z.string().trim().min(1).max(200)).max(50).optional().nullable(),
  estimated_size: z.record(z.string(), z.unknown()).optional().nullable(),
  entity_unit: optionalText,
  estimate_method: optionalText,
  confidence: optionalText,
  confidence_rationale: optionalText,
})

export const importAudiencePlayBodySchema = z.object({
  noliUserId: z.string().trim().min(1).max(200),
  report_token_hash: z
    .string()
    .trim()
    .min(16)
    .max(128)
    .regex(/^\S+$/, 'report_token_hash must not contain whitespace'),
  play: importedPlaySchema,
  likely_buyer: optionalText,
})

export type ImportedPlayInput = z.infer<typeof importedPlaySchema>
export type ImportAudiencePlayBody = z.infer<typeof importAudiencePlayBodySchema>

// Internal read routes (SPEC-066 section 5): every internal route re-resolves
// noliUserId server-side; the caller never supplies org/tenant identifiers.
export const gtmOverviewBodySchema = z.object({
  noliUserId: z.string().trim().min(1).max(200),
})

// playId is intentionally NOT format-validated here: a malformed id must
// produce the same opaque 404 as a missing/foreign row (checked in the route
// via isUuid), never a distinguishable 400.
export const gtmPlayDetailBodySchema = z.object({
  noliUserId: z.string().trim().min(1).max(200),
  playId: z.string().trim().min(1).max(200),
})

export type GtmOverviewBody = z.infer<typeof gtmOverviewBodySchema>
export type GtmPlayDetailBody = z.infer<typeof gtmPlayDetailBodySchema>

// ---------------------------------------------------------------------------
// Tranche 3: research runs + candidates (SPEC-066 sections 5, 11, 14)
// ---------------------------------------------------------------------------

// Ids are NOT format-validated here: a malformed id must produce the same
// opaque 404 as a missing/foreign row (checked in the route via isUuid).
const idString = z.string().trim().min(1).max(200)

const researchLimitsSchema = z.object({
  maxCandidates: z.number().int().min(1).max(100).optional(),
  maxCredits: z.number().int().min(1).optional(),
})

export const gtmResearchRunsBodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('plan'),
    noliUserId: idString,
    playId: idString,
    limits: researchLimitsSchema.optional(),
  }),
  z.object({
    op: z.literal('create'),
    noliUserId: idString,
    playId: idString,
    limits: researchLimitsSchema.optional(),
  }),
  z.object({
    op: z.literal('execute'),
    noliUserId: idString,
    runId: idString,
  }),
  z.object({
    op: z.literal('status'),
    noliUserId: idString,
    runId: idString,
  }),
  // Tranche 4: retention sweep exposed as a service-caller op (no in-app
  // worker convention exists; see lib/retention/sweep.ts).
  z.object({
    op: z.literal('retention-sweep'),
    noliUserId: idString,
  }),
])

// ---------------------------------------------------------------------------
// Tranche 4: enrichment + verification waterfall (SPEC-066 sections 4, 11.2)
// ---------------------------------------------------------------------------

// Exactly one of runId | workspaceId scopes the operation; the route enforces
// the at-least-one rule so both shapes share the union discriminator.
export const gtmEnrichBodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('run'),
    noliUserId: idString,
    runId: idString.optional(),
    workspaceId: idString.optional(),
    maxCredits: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('status'),
    noliUserId: idString,
    runId: idString.optional(),
    workspaceId: idString.optional(),
  }),
])

export type GtmEnrichBody = z.infer<typeof gtmEnrichBodySchema>

export const gtmCandidatesBodySchema = z.object({
  noliUserId: idString,
  op: z.enum(['list', 'review']).optional().default('list'),
  // list filters
  runId: idString.optional(),
  workspaceId: idString.optional(),
  fitStatus: z.enum(['unscored', 'accepted', 'rejected']).optional(),
  // review op
  candidateId: idString.optional(),
  verdict: z.enum(['accepted', 'rejected']).optional(),
  reason: z.string().trim().max(2000).optional(),
})

export type GtmResearchRunsBody = z.infer<typeof gtmResearchRunsBodySchema>
export type GtmCandidatesBody = z.infer<typeof gtmCandidatesBodySchema>

// ---------------------------------------------------------------------------
// Tranche 5: campaign drafting + immutable batch approval (SPEC-066
// sections 4, 7, 8, 12)
// ---------------------------------------------------------------------------

const campaignTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(20000),
})

const campaignChannelMixSchema = z.object({
  emails: z.number().int().min(1).max(3).optional(),
  linkedin: z.boolean().optional(),
  x: z.boolean().optional(),
})

// daily_cap is deliberately NOT capped here: the campaign library rejects
// values above the hard ceiling with an explicit, testable error code.
const campaignSettingsSchema = z.object({
  daily_cap: z.number().int().min(1).max(10000).optional(),
  send_window: z
    .object({
      start_hour: z.number().int().min(0).max(23).optional(),
      end_hour: z.number().int().min(1).max(24).optional(),
      timezone: z.string().trim().min(1).max(100).optional(),
    })
    .optional(),
  jitter_minutes: z.number().int().min(0).max(120).optional(),
  mailbox_connection_id: idString.optional().nullable(),
  duplicate_override: z.boolean().optional(),
})

export const gtmCampaignsBodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    noliUserId: idString,
    workspaceId: idString,
    playId: idString,
    name: z.string().trim().min(1).max(200),
    channelMix: campaignChannelMixSchema.optional(),
    settings: campaignSettingsSchema.optional(),
  }),
  z.object({
    op: z.literal('draft-state'),
    noliUserId: idString,
    campaignId: idString,
  }),
  z.object({
    op: z.literal('update-template'),
    noliUserId: idString,
    campaignId: idString,
    template: campaignTemplateSchema,
  }),
  z.object({
    op: z.literal('exclude'),
    noliUserId: idString,
    campaignId: idString,
    candidateId: idString,
  }),
  z.object({
    op: z.literal('include'),
    noliUserId: idString,
    campaignId: idString,
    candidateId: idString,
  }),
  z.object({
    op: z.literal('approve'),
    noliUserId: idString,
    campaignId: idString,
    expected_content_hash: z.string().trim().min(16).max(128).optional(),
  }),
  z.object({
    op: z.literal('invalidate'),
    noliUserId: idString,
    campaignId: idString,
    reason: z.string().trim().min(1).max(200),
  }),
  z.object({
    op: z.literal('status'),
    noliUserId: idString,
    campaignId: idString,
  }),
])

export type GtmCampaignsBody = z.infer<typeof gtmCampaignsBodySchema>
