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
 * EVERY actor id below is VERIFY-ON-FIRST-RUN: ids, input schemas, output
 * field names, and per-result pricing all shift on the marketplace and none
 * of this has been exercised against the live API (no network calls are made
 * in development or tests, by standing rule).
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
 * VERIFY-ON-FIRST-RUN for every row: actor id exists, is public, its input
 * schema matches buildActorInput below, and its per-result price matches the
 * researched $1.20-2.00 / 1k (LinkedIn) and $0.15-0.40 / 1k (X) figures in
 * `Software Strategy/gtm-data-sources-origami-map-2026-07-24.md`.
 */
export const APIFY_ACTORS: Record<ApifyCapabilityKind, ApifyActorConfig> = {
  linkedin_post_reactions: {
    kind: 'linkedin_post_reactions',
    // VERIFY-ON-FIRST-RUN
    defaultActorId: 'harvestapi/linkedin-post-reactions',
    // VERIFY-ON-FIRST-RUN (documented fallback, not auto-selected)
    fallbackActorId: 'apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies',
    envVar: 'GTM_APIFY_ACTOR_LINKEDIN_POST_REACTIONS',
    allowedHosts: ['linkedin.com'],
  },
  linkedin_post_comments: {
    kind: 'linkedin_post_comments',
    // VERIFY-ON-FIRST-RUN
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
// Input builders (VERIFY-ON-FIRST-RUN: each actor's input schema)
// ---------------------------------------------------------------------------

export function buildActorInput(
  kind: ApifyCapabilityKind,
  args: { postUrl: string; maxItems: number },
): Record<string, unknown> {
  const maxItems = Math.max(1, Math.floor(args.maxItems))
  switch (kind) {
    case 'linkedin_post_reactions':
      // VERIFY-ON-FIRST-RUN: harvestapi reactions actor input keys.
      return { posts: [args.postUrl], postUrl: args.postUrl, maxItems }
    case 'linkedin_post_comments':
      // VERIFY-ON-FIRST-RUN: harvestapi comments actor input keys.
      return { posts: [args.postUrl], postUrl: args.postUrl, maxItems }
    case 'x_post_engagers':
      // VERIFY-ON-FIRST-RUN: apidojo tweet-scraper input keys.
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
 *   engagement-type token, never from raw provider text;
 * - source_url is OUR plan's post URL, not a url echoed back by the actor.
 */

// Direct observation of a public engagement event: high but not certain,
// because the actor layer sits between us and the platform.
export const APIFY_EVIDENCE_CONFIDENCE = 0.9

const MAX_ENGAGEMENT_TOKEN = 24

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
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

const LINKEDIN_NAME_PATHS: string[][] = [
  ['actor', 'name'],
  ['reactor', 'name'],
  ['author', 'name'],
  ['profile', 'fullName'],
  ['profile', 'name'],
  ['fullName'],
  ['name'],
]

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
  engagementType: string,
  claimPrefix: string,
): Candidate | null {
  const name = pick(item, LINKEDIN_NAME_PATHS) ?? joinName(item, LINKEDIN_FIRST_PATHS, LINKEDIN_LAST_PATHS)
  // No usable name = no candidate. We never synthesize one.
  if (!name) return null
  return {
    entity_kind: 'person',
    identity: buildIdentity({
      name,
      title: pick(item, LINKEDIN_TITLE_PATHS),
      company: pick(item, LINKEDIN_COMPANY_PATHS),
      profileUrl: pickUrl(item, LINKEDIN_PROFILE_URL_PATHS),
    }),
    evidence: [
      {
        // fixed vocabulary + sanitized token; no raw provider text
        claim: `${claimPrefix} (${engagementType})`,
        source_url: ctx.postUrl,
        observed_at: ctx.observedAt,
        confidence: APIFY_EVIDENCE_CONFIDENCE,
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
      const type = normalizeEngagementType(
        at(item, ['type']) ?? at(item, ['reactionType']) ?? at(item, ['reaction']),
        'REACTION',
      )
      candidate = linkedinCandidate(item, ctx, type, 'Reacted to the source LinkedIn post')
    } else if (kind === 'linkedin_post_comments') {
      // The comment BODY is deliberately not stored in the claim: it is
      // third-party free text and belongs nowhere near an instruction path.
      candidate = linkedinCandidate(item, ctx, 'COMMENT', 'Commented on the source LinkedIn post')
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
