import type { Candidate, CandidateIdentity } from '../types'

/*
 * Apify actor registry: our capability kinds -> a marketplace actor id, an
 * input builder, and an output normalizer.
 *
 * WHY this indirection exists: marketplace actor supply degrades. Actors get
 * renamed, deprecated, rate-limited, or quietly stop returning a field. That
 * is the documented Origami failure mode (their permanent "LinkedIn upstream
 * provider issues" banner). Swapping an actor must therefore be a one-line
 * change: replace the default id (or set the env override) and, if the payload
 * shape differs, extend the alias list in the normalizer. Nothing outside this
 * file knows an actor id.
 *
 * VERIFICATION STATE (see
 * `Software Strategy/gtm-apify-verified-contract-2026-07-24.md`):
 * - `harvestapi/linkedin-post-comments`: input schema AND output shape
 *   LIVE-VERIFIED 2026-07-24.
 * - `harvestapi/linkedin-post-reactions`: input schema LIVE-VERIFIED; output
 *   shape STILL UNVERIFIED (the probe post had no reactions, so a 201 with an
 *   empty array was all we saw). Its normalizer keeps defensive aliases.
 * - `apidojo/tweet-scraper` (X): input AND output STILL UNVERIFIED.
 * Pricing lives in APIFY_MEASURED_USD below, in DOLLARS (measured 2026-07-24,
 * not yet reconciled against an invoice).
 */

export type ApifyCapabilityKind =
  | 'linkedin_post_reactions'
  | 'linkedin_post_comments'
  | 'x_post_engagers'

export const APIFY_CAPABILITY_KINDS: ApifyCapabilityKind[] = [
  'linkedin_post_reactions',
  'linkedin_post_comments',
  'x_post_engagers',
]

export type ApifyActorConfig = {
  kind: ApifyCapabilityKind
  // default actor id, overridable per deployment without a code change
  defaultActorId: string
  // documented alternative if the default degrades; NOT used automatically,
  // because silently switching provider supply hides a real failure
  fallbackActorId: string
  envVar: string
  // hostnames the source post URL must belong to (fail closed on anything else)
  allowedHosts: string[]
}

/*
 * Actor ids VERIFIED to exist and accept our input for both LinkedIn rows;
 * per-result price measured but not yet invoice-confirmed (background in
 * `Software Strategy/gtm-data-sources-origami-map-2026-07-24.md`).
 */
export const APIFY_ACTORS: Record<ApifyCapabilityKind, ApifyActorConfig> = {
  linkedin_post_reactions: {
    kind: 'linkedin_post_reactions',
    // id + input schema VERIFIED 2026-07-24
    defaultActorId: 'harvestapi/linkedin-post-reactions',
    // VERIFY-ON-FIRST-RUN (documented fallback, not auto-selected)
    fallbackActorId: 'apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies',
    envVar: 'GTM_APIFY_ACTOR_LINKEDIN_POST_REACTIONS',
    allowedHosts: ['linkedin.com'],
  },
  linkedin_post_comments: {
    kind: 'linkedin_post_comments',
    // id + input schema + output shape VERIFIED 2026-07-24
    defaultActorId: 'harvestapi/linkedin-post-comments',
    // VERIFY-ON-FIRST-RUN (documented fallback, not auto-selected)
    fallbackActorId: 'apimaestro/linkedin-profile-comments',
    envVar: 'GTM_APIFY_ACTOR_LINKEDIN_POST_COMMENTS',
    allowedHosts: ['linkedin.com'],
  },
  x_post_engagers: {
    kind: 'x_post_engagers',
    // VERIFY-ON-FIRST-RUN (apidojo/kaito-class pay-per-result tweet scraper)
    defaultActorId: 'apidojo/tweet-scraper',
    // VERIFY-ON-FIRST-RUN (documented fallback, not auto-selected)
    fallbackActorId: 'kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest',
    envVar: 'GTM_APIFY_ACTOR_X_POST_ENGAGERS',
    allowedHosts: ['x.com', 'twitter.com'],
  },
}

/*
 * PROVIDER COST, IN USD. USD is the natural unit here: it is what Apify
 * invoices, what their per-1k pricing quotes, and what their per-event pricing
 * quotes. Noli credits are derived from these with creditsFromUsd
 * (lib/credits/markup.ts), never hand-copied from another vendor's rate card.
 *
 * Every figure below was LIVE-MEASURED or read off the actor's own pricing
 * schema on 2026-07-24. RE-CHECK AGAINST A REAL INVOICE before customer use:
 * marketplace pricing changes without notice.
 */
export const APIFY_MEASURED_USD = {
  // ~$0.003 per returned engagement result (LinkedIn comments/reactions, X)
  sourcing_per_result: 0.003,
  // profile detail without an email lookup ("main" profile mode territory)
  profile_without_email: 0.004,
  // full-profile-with-email event on the reactions actor
  profile_with_email: 0.01,
} as const

export type ApifyEnv = Record<string, string | undefined>

export function isApifyCapabilityKind(value: string): value is ApifyCapabilityKind {
  return (APIFY_CAPABILITY_KINDS as string[]).includes(value)
}

// One-line swap point: env override wins, default otherwise.
export function resolveActorId(kind: ApifyCapabilityKind, env: ApifyEnv): string {
  const config = APIFY_ACTORS[kind]
  const override = (env[config.envVar] ?? '').trim()
  return override || config.defaultActorId
}

// ---------------------------------------------------------------------------
// Source post URL handling (fail closed: no URL, no run)
// ---------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/i

export type PostUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string }

/*
 * The plan query carries the source post URL. We extract the FIRST url and
 * check its host against the capability's allow list, so a LinkedIn actor can
 * never be pointed at an arbitrary host by a crafted query.
 */
export function extractPostUrl(kind: ApifyCapabilityKind, query: string): PostUrlResult {
  const match = URL_PATTERN.exec(query ?? '')
  if (!match) return { ok: false, reason: 'missing_post_url: the plan query contains no source post URL' }
  let parsed: URL
  try {
    parsed = new URL(match[0])
  } catch {
    return { ok: false, reason: 'invalid_post_url: the plan query URL could not be parsed' }
  }
  const host = parsed.hostname.toLowerCase()
  const allowed = APIFY_ACTORS[kind].allowedHosts.some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  )
  if (!allowed) {
    return {
      ok: false,
      reason: `invalid_post_url: host ${host} is not valid for ${kind}`,
    }
  }
  return { ok: true, url: parsed.toString() }
}

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

/*
 * Both harvestapi actors expose `profileScraperMode` as an enum whose members
 * are exactly ["short","main"], LOWERCASE. A capitalized 'Short' is rejected
 * with HTTP 400 `invalid-input` (this was the adapter's original bug).
 *
 * Cost, straight from the actor's own schema titles: `short` carries NO charge
 * for profile details; `main` costs $0.002 per profile. We default to `short`
 * and only ever move to `main` when a plan justifies paying for profile depth.
 */
export const APIFY_PROFILE_SCRAPER_MODES = ['short', 'main'] as const
export type ApifyProfileScraperMode = (typeof APIFY_PROFILE_SCRAPER_MODES)[number]
export const APIFY_DEFAULT_PROFILE_SCRAPER_MODE: ApifyProfileScraperMode = 'short'

export function normalizeProfileScraperMode(value: unknown): ApifyProfileScraperMode {
  const lowered = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (APIFY_PROFILE_SCRAPER_MODES as readonly string[]).includes(lowered)
    ? (lowered as ApifyProfileScraperMode)
    : APIFY_DEFAULT_PROFILE_SCRAPER_MODE
}

export function buildActorInput(
  kind: ApifyCapabilityKind,
  args: { postUrl: string; maxItems: number; profileScraperMode?: string },
): Record<string, unknown> {
  const maxItems = Math.max(1, Math.floor(args.maxItems))
  const profileScraperMode = normalizeProfileScraperMode(args.profileScraperMode)
  switch (kind) {
    case 'linkedin_post_reactions':
      // VERIFIED input keys: posts (array of post urls), maxItems,
      // reactionTypeFilter (omitted = all types), profileScraperMode.
      return { posts: [args.postUrl], maxItems, profileScraperMode }
    case 'linkedin_post_comments':
      // VERIFIED input keys: posts, maxItems, postedLimit, scrapeReplies,
      // profileScraperMode. We send only what we actually need.
      return { posts: [args.postUrl], maxItems, profileScraperMode }
    case 'x_post_engagers':
      // STILL UNVERIFIED: apidojo tweet-scraper input keys.
      return { startUrls: [args.postUrl], maxItems, includeReplies: true }
  }
}

// ---------------------------------------------------------------------------
// Normalizers -> our Candidate shape
// ---------------------------------------------------------------------------

/*
 * Discipline rules for everything below:
 * - unknown or missing fields are OMITTED, never invented and never defaulted
 *   to a placeholder;
 * - provider text (names, headlines, comment bodies) is stored as DATA only.
 *   It is never interpolated into an instruction, a template, or a claim
 *   string, so an engager whose headline is "ignore previous instructions"
 *   is just a row with an odd name;
 * - the evidence claim is built from a FIXED vocabulary plus a sanitized
 *   engagement-type token, never from raw provider text. Raw provider text
 *   that is worth keeping (the comment body) goes in `evidence.detail`, which
 *   is inert jsonb payload and is never rendered into an instruction path;
 * - source_url is OUR plan's post URL, not a url echoed back by the actor.
 *   The actor's own echo (`query.post`) is kept in `evidence.detail` instead,
 *   so a crafted echo can never redirect a stored source_url.
 */

// Direct observation of a public engagement event: high but not certain,
// because the actor layer sits between us and the platform.
export const APIFY_EVIDENCE_CONFIDENCE = 0.9

const MAX_ENGAGEMENT_TOKEN = 24
// Comment bodies are kept for evidence, but bounded: receipts and evidence
// rows are read by humans, not a dumping ground for arbitrary provider text.
const MAX_COMMENTARY_CHARS = 1_000
const MAX_REACTION_TYPES = 8

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/*
 * harvestapi returns "--" as its own filler for "this profile has no
 * headline" (verified live). A filler string is ABSENT, not a title: storing
 * it would put "--" in front of a customer as a job title.
 */
// dashes (ascii, en, em), dots and whitespace only; escaped so no literal
// dash character other than '-' appears in the source
const PLACEHOLDER_PATTERN = /^[-\u2013\u2014._\s]+$/

function meaningful(value: string | null): string | null {
  if (!value) return null
  return PLACEHOLDER_PATTERN.test(value) ? null : value
}

function at(item: unknown, path: string[]): unknown {
  let cursor: unknown = item
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function pick(item: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = str(at(item, path))
    if (value) return value
  }
  return null
}

// Same as pick, but a provider filler value ("--") is skipped rather than
// returned, so a later alias still gets its chance.
function pickMeaningful(item: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = meaningful(str(at(item, path)))
    if (value) return value
  }
  return null
}

function pickUrl(item: unknown, paths: string[][]): string | null {
  const raw = pick(item, paths)
  if (!raw) return null
  // Only http(s) urls are stored; anything else is dropped rather than kept
  // as an unverified string.
  return /^https?:\/\//i.test(raw) ? raw : null
}

function joinName(item: unknown, firstPaths: string[][], lastPaths: string[][]): string | null {
  const first = pick(item, firstPaths)
  const last = pick(item, lastPaths)
  const joined = [first, last].filter(Boolean).join(' ').trim()
  return joined ? joined : null
}

/*
 * Sanitize a provider-supplied engagement type into a short uppercase token.
 * This is the ONLY provider string that reaches a claim, and it is stripped
 * to [A-Z_] and length-capped first.
 */
export function normalizeEngagementType(raw: unknown, fallback: string): string {
  const value = str(raw)
  if (!value) return fallback
  const token = value.toUpperCase().replace(/[^A-Z_]/g, '')
  if (!token) return fallback
  return token.slice(0, MAX_ENGAGEMENT_TOKEN)
}

/*
 * Reaction types observed on the item, sanitized to short uppercase tokens.
 * VERIFIED location on the comments actor: engagement.reactions[].type
 * (e.g. EMPATHY). These are reactions ON the comment, so they are evidence
 * detail, not the engagement kind itself.
 */
function reactionTypes(item: unknown): string[] {
  const raw = at(item, ['engagement', 'reactions'])
  if (!Array.isArray(raw)) return []
  const seen: string[] = []
  for (const entry of raw) {
    const declared = str(at(entry, ['type']))
    if (!declared) continue
    const token = normalizeEngagementType(declared, '')
    if (token && !seen.includes(token)) seen.push(token)
    if (seen.length >= MAX_REACTION_TYPES) break
  }
  return seen
}

/*
 * observed_at is WHEN THE ENGAGEMENT HAPPENED when the actor tells us
 * (verified fields: createdAtTimestamp epoch ms, createdAt), and only falls
 * back to our own attempt time when it does not. An unparseable value falls
 * back rather than being coerced.
 */
function itemObservedAt(item: unknown, fallback: string): string {
  const epoch = at(item, ['createdAtTimestamp'])
  if (typeof epoch === 'number' && Number.isFinite(epoch) && epoch > 0) {
    const fromEpoch = new Date(epoch)
    if (!Number.isNaN(fromEpoch.getTime())) return fromEpoch.toISOString()
  }
  const raw = str(at(item, ['createdAt']))
  if (raw) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback
}

function buildIdentity(parts: {
  name: string
  title: string | null
  company: string | null
  profileUrl: string | null
}): CandidateIdentity {
  const identity: CandidateIdentity = { name: parts.name }
  // omitted, never invented
  if (parts.title) identity.title = parts.title
  if (parts.company) identity.company = parts.company
  if (parts.profileUrl) identity.urls = [parts.profileUrl]
  return identity
}

export type NormalizeContext = {
  postUrl: string
  observedAt: string
}

export type NormalizeResult = {
  candidates: Candidate[]
  // items the actor returned that could not become a candidate (no usable
  // name). Surfaced on the receipt: we never fabricate a name to keep a row.
  dropped: number
}

/*
 * VERIFIED (comments actor): the person is nested under `actor`, with
 * `actor.name` as ONE full-name field (there is no firstName/lastName split),
 * `actor.linkedinUrl`, and `actor.position` for the headline. The verified
 * names come FIRST in every list below.
 *
 * The remaining aliases exist for the reactions actor, whose output shape is
 * STILL UNVERIFIED (see the header note), and for a marketplace actor swap.
 */
const LINKEDIN_NAME_PATHS: string[][] = [
  ['actor', 'name'],
  ['reactor', 'name'],
  ['author', 'name'],
  ['profile', 'fullName'],
  ['profile', 'name'],
  ['fullName'],
  ['name'],
]

// UNVERIFIED alias set: the verified comments actor has no first/last split.
// Retained only so an actor swap that does split names still normalizes.
const LINKEDIN_FIRST_PATHS: string[][] = [
  ['actor', 'firstName'],
  ['reactor', 'firstName'],
  ['author', 'firstName'],
  ['firstName'],
]

const LINKEDIN_LAST_PATHS: string[][] = [
  ['actor', 'lastName'],
  ['reactor', 'lastName'],
  ['author', 'lastName'],
  ['lastName'],
]

const LINKEDIN_TITLE_PATHS: string[][] = [
  ['actor', 'position'],
  ['actor', 'headline'],
  ['reactor', 'headline'],
  ['reactor', 'position'],
  ['author', 'headline'],
  ['profile', 'headline'],
  ['headline'],
  ['position'],
  ['occupation'],
]

/*
 * COMPANY IS NOT RETURNED by the verified comments actor in `short` mode:
 * there is no company field at all, so the comments path never consults this
 * list and company stays undefined. Company must come from a later enrichment
 * step, or possibly from `main` mode at $0.002/profile (UNTESTED).
 *
 * The list below is used only by the UNVERIFIED reactions path.
 */
const LINKEDIN_COMPANY_PATHS: string[][] = [
  ['actor', 'companyName'],
  ['actor', 'company', 'name'],
  ['reactor', 'companyName'],
  ['author', 'companyName'],
  ['currentCompany', 'name'],
  ['companyName'],
  ['company', 'name'],
]

const LINKEDIN_PROFILE_URL_PATHS: string[][] = [
  ['actor', 'linkedinUrl'],
  ['actor', 'profileUrl'],
  ['actor', 'url'],
  ['reactor', 'linkedinUrl'],
  ['reactor', 'profileUrl'],
  ['author', 'linkedinUrl'],
  ['author', 'profileUrl'],
  ['profile', 'url'],
  ['profileUrl'],
  ['linkedinUrl'],
  ['authorProfileUrl'],
]

const X_NAME_PATHS: string[][] = [
  ['author', 'name'],
  ['user', 'name'],
  ['author', 'userName'],
  ['user', 'screen_name'],
  ['screenName'],
  ['name'],
]

const X_PROFILE_URL_PATHS: string[][] = [
  ['author', 'url'],
  ['author', 'profileUrl'],
  ['user', 'url'],
  ['profileUrl'],
]

const X_ENGAGEMENT_PATHS: string[][] = [['engagementType'], ['type']]

function linkedinCandidate(
  item: unknown,
  ctx: NormalizeContext,
  opts: {
    engagementKind: 'comment' | 'reaction'
    engagementType: string
    claimPrefix: string
    // false for the verified comments actor: it returns no company field
    allowCompany: boolean
  },
): Candidate | null {
  const name = pick(item, LINKEDIN_NAME_PATHS) ?? joinName(item, LINKEDIN_FIRST_PATHS, LINKEDIN_LAST_PATHS)
  // No usable name = no candidate. We never synthesize one.
  if (!name) return null

  const detail: Record<string, unknown> = { engagement_kind: opts.engagementKind }
  const reactions = reactionTypes(item)
  if (reactions.length > 0) detail.reaction_types = reactions
  // The comment body, kept as INERT data for evidence. It is bounded and never
  // reaches a claim, a template, or any instruction path.
  const commentary = str(at(item, ['commentary']))
  if (commentary) detail.commentary = commentary.slice(0, MAX_COMMENTARY_CHARS)
  const createdAt = str(at(item, ['createdAt']))
  if (createdAt) detail.created_at = createdAt
  // The actor's echo of the post we asked for. Recorded for reconciliation
  // only; source_url below stays OUR host-checked plan URL.
  const queryPost = str(at(item, ['query', 'post']))
  if (queryPost) detail.query_post = queryPost

  return {
    entity_kind: 'person',
    identity: buildIdentity({
      name,
      // "--" and friends are treated as absent, not as a real title
      title: pickMeaningful(item, LINKEDIN_TITLE_PATHS),
      company: opts.allowCompany ? pick(item, LINKEDIN_COMPANY_PATHS) : null,
      profileUrl: pickUrl(item, LINKEDIN_PROFILE_URL_PATHS),
    }),
    evidence: [
      {
        // fixed vocabulary + sanitized token; no raw provider text
        claim: `${opts.claimPrefix} (${opts.engagementType})`,
        source_url: ctx.postUrl,
        observed_at: itemObservedAt(item, ctx.observedAt),
        confidence: APIFY_EVIDENCE_CONFIDENCE,
        detail,
      },
    ],
  }
}

function xEngagementType(item: unknown): string {
  const declared = pick(item, X_ENGAGEMENT_PATHS)
  if (declared) return normalizeEngagementType(declared, 'ENGAGEMENT')
  const record = (item ?? {}) as Record<string, unknown>
  if (record.isReply === true || str(record.inReplyToId) || str(at(item, ['inReplyToUser', 'id']))) {
    return 'REPLY'
  }
  if (record.isRetweet === true || record.retweeted_tweet != null || record.retweetedTweet != null) {
    return 'RETWEET'
  }
  if (record.isQuote === true || record.quoted_tweet != null || record.quotedTweet != null) {
    return 'QUOTE'
  }
  return 'ENGAGEMENT'
}

export function normalizeItems(
  kind: ApifyCapabilityKind,
  items: unknown[],
  ctx: NormalizeContext,
): NormalizeResult {
  const candidates: Candidate[] = []
  let dropped = 0
  for (const item of items) {
    let candidate: Candidate | null = null
    if (kind === 'linkedin_post_reactions') {
      // STILL UNVERIFIED shape: the reactions actor returned an empty array on
      // the live probe, so these aliases (and the company mapping) remain
      // defensive guesses until a post with reactions is run.
      const type = normalizeEngagementType(
        at(item, ['type']) ?? at(item, ['reactionType']) ?? at(item, ['reaction']),
        'REACTION',
      )
      candidate = linkedinCandidate(item, ctx, {
        engagementKind: 'reaction',
        engagementType: type,
        claimPrefix: 'Reacted to the source LinkedIn post',
        allowCompany: true,
      })
    } else if (kind === 'linkedin_post_comments') {
      // VERIFIED shape. The comment BODY is deliberately not stored in the
      // claim: it is third-party free text and belongs nowhere near an
      // instruction path. It is carried on evidence.detail as inert data.
      candidate = linkedinCandidate(item, ctx, {
        engagementKind: 'comment',
        engagementType: 'COMMENT',
        claimPrefix: 'Commented on the source LinkedIn post',
        // no company field exists in `short` mode: never invent one
        allowCompany: false,
      })
    } else {
      const name = pick(item, X_NAME_PATHS)
      if (name) {
        candidate = {
          entity_kind: 'person',
          identity: buildIdentity({
            name,
            title: null,
            company: null,
            profileUrl: pickUrl(item, X_PROFILE_URL_PATHS),
          }),
          evidence: [
            {
              claim: `Engaged with the source X post (${xEngagementType(item)})`,
              source_url: ctx.postUrl,
              observed_at: ctx.observedAt,
              confidence: APIFY_EVIDENCE_CONFIDENCE,
            },
          ],
        }
      }
    }
    if (candidate) candidates.push(candidate)
    else dropped += 1
  }
  return { candidates, dropped }
}
