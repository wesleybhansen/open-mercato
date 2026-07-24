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
