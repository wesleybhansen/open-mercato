import type { AdapterResultStatus } from '../types'

/*
 * Thin, injectable Apify REST client (SPEC-066 Tranche 3, first REAL source
 * provider). No Apify SDK dependency: one fetch call, injected so every test
 * runs against a fake and no test can ever open a socket.
 *
 * Ships DARK. Nothing here runs unless the caller (source.ts) passes the
 * env gate, and nothing in this file executes at import time.
 *
 * Honesty rules encoded here:
 * - The token is NEVER logged, never echoed into a receipt, and never left in
 *   a stored URL: `requestUrl` on the outcome is always the redacted form.
 * - A timeout / abort / HTTP 408 is AMBIGUOUS, never a silent retry
 *   (SPEC-066 section 6 rule 4). A generic transport failure is ALSO treated
 *   as ambiguous: once the POST is dispatched we cannot know whether the
 *   actor run started and billed, so we park it for reconciliation instead of
 *   guessing. That is deliberately conservative about the customer's money.
 * - Every outcome carries actor_id / run_id / item_count material so the
 *   ledger can settle on the units actually returned (pay-per-result).
 *
 * VERIFY-ON-FIRST-RUN (Apify API shape assumptions, none of them tested
 * against the live API; see the return report):
 * - endpoint: POST /v2/acts/{actorId}/run-sync-get-dataset-items
 * - actor ids of the form `username/actor-name` are addressed in the API path
 *   as `username~actor-name`
 * - a 2xx body is a JSON ARRAY of dataset items
 * - the run id is surfaced on a response header; we probe a few candidate
 *   header names and fall back to null rather than inventing one
 * - `timeout` (seconds) and `maxItems` are accepted as query parameters
 */

export const APIFY_API_BASE = 'https://api.apify.com/v2'
export const APIFY_DEFAULT_TIMEOUT_MS = 60_000
// Response bodies are truncated before they reach a receipt: receipts are
// stored jsonb and read by humans, not a place for a full provider payload.
export const APIFY_BODY_SNIPPET_LIMIT = 500

// Header names probed for the run id, most specific first. VERIFY-ON-FIRST-RUN.
export const APIFY_RUN_ID_HEADERS = ['x-apify-run-id', 'x-apify-actor-run-id', 'x-apify-run'] as const

// ---------------------------------------------------------------------------
// Injectable fetch surface (structural slice only, so tests pass a plain fn)
// ---------------------------------------------------------------------------

export type ApifyFetchHeaders = { get(name: string): string | null | undefined }

export type ApifyFetchResponse = {
  status: number
  headers?: ApifyFetchHeaders | null
  text(): Promise<string>
}

export type ApifyFetchInit = {
  method: string
  headers: Record<string, string>
  body: string
  signal?: unknown
}

export type ApifyFetchLike = (url: string, init: ApifyFetchInit) => Promise<ApifyFetchResponse>

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type ApifyOutcomeKind =
  | 'ok'
  | 'no_result'
  | 'auth_error'
  | 'rate_limited'
  | 'server_error'
  | 'client_error'
  | 'invalid_schema'
  | 'timeout'
  | 'transport_unknown'

/*
 * THE status mapping table. Kept as data (not scattered `if`s) so it can be
 * asserted directly in tests and read at a glance in review.
 */
export const APIFY_STATUS_MAP: Record<ApifyOutcomeKind, AdapterResultStatus> = {
  ok: 'ok',
  no_result: 'no_result',
  auth_error: 'error',
  rate_limited: 'error',
  server_error: 'error',
  client_error: 'error',
  invalid_schema: 'error',
  // never a silent retry: parked for reconciliation
  timeout: 'ambiguous',
  transport_unknown: 'ambiguous',
}

export type ApifyRunOutcome = {
  kind: ApifyOutcomeKind
  status: AdapterResultStatus
  items: unknown[]
  actorId: string
  runId: string | null
  itemCount: number
  httpStatus: number | null
  retryAfterSeconds: number | null
  bodySnippet: string | null
  // redacted: the token is stripped before this value exists
  requestUrl: string
  attemptedAt: string
  error: string | null
}

export type ApifyRunOptions = {
  token: string
  timeoutMs?: number
  maxItems?: number
  // 'header' (default) keeps the token out of the URL entirely; 'query' is
  // the documented `?token=` form. Either way the token is redacted from
  // anything we store or return.
  tokenTransport?: 'header' | 'query'
  now?: () => Date
  fetchImpl?: ApifyFetchLike
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `username/actor-name` -> `username~actor-name` for the API path.
// VERIFY-ON-FIRST-RUN.
export function encodeActorId(actorId: string): string {
  return actorId.trim().replace(/\//g, '~')
}

export function redactToken(text: string, token: string): string {
  let out = text
  if (token) out = out.split(token).join('[redacted]')
  return out.replace(/token=[^&\s]+/gi, 'token=[redacted]')
}

export function truncateBody(text: string, limit = APIFY_BODY_SNIPPET_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...[truncated ${text.length - limit} chars]`
}

function readHeader(headers: ApifyFetchHeaders | null | undefined, name: string): string | null {
  if (!headers || typeof headers.get !== 'function') return null
  const value = headers.get(name)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRunId(headers: ApifyFetchHeaders | null | undefined): string | null {
  for (const name of APIFY_RUN_ID_HEADERS) {
    const value = readHeader(headers, name)
    if (value) return value
  }
  return null
}

function readRetryAfter(headers: ApifyFetchHeaders | null | undefined): number | null {
  const raw = readHeader(headers, 'retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return true
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /abort|timed?\s?out|timeout|etimedout/i.test(message)
}

export function buildRunSyncUrl(
  actorId: string,
  options: { token: string; tokenTransport: 'header' | 'query'; timeoutMs: number; maxItems?: number },
): { url: string; redactedUrl: string } {
  const params: string[] = []
  // Apify's own run timeout, in seconds, kept just under our client deadline
  // so the provider gives up before we do where possible.
  params.push(`timeout=${Math.max(1, Math.floor(options.timeoutMs / 1000))}`)
  if (typeof options.maxItems === 'number' && options.maxItems > 0) {
    params.push(`maxItems=${Math.floor(options.maxItems)}`)
  }
  const base = `${APIFY_API_BASE}/acts/${encodeActorId(actorId)}/run-sync-get-dataset-items`
  const redactedUrl = `${base}?${[...params, 'token=[redacted]'].join('&')}`
  const url =
    options.tokenTransport === 'query'
      ? `${base}?${[...params, `token=${encodeURIComponent(options.token)}`].join('&')}`
      : `${base}?${params.join('&')}`
  return { url, redactedUrl }
}

// ---------------------------------------------------------------------------
// The one call
// ---------------------------------------------------------------------------

export async function runActorSync(
  actorId: string,
  input: Record<string, unknown>,
  options: ApifyRunOptions,
): Promise<ApifyRunOutcome> {
  const timeoutMs = options.timeoutMs ?? APIFY_DEFAULT_TIMEOUT_MS
  const tokenTransport = options.tokenTransport ?? 'header'
  const now = options.now ?? (() => new Date())
  const attemptedAt = now().toISOString()
  const fetchImpl =
    options.fetchImpl ?? ((globalThis as { fetch?: unknown }).fetch as ApifyFetchLike | undefined)

  const { url, redactedUrl } = buildRunSyncUrl(actorId, {
    token: options.token,
    tokenTransport,
    timeoutMs,
    maxItems: options.maxItems,
  })

  const base = {
    actorId,
    runId: null as string | null,
    itemCount: 0,
    httpStatus: null as number | null,
    retryAfterSeconds: null as number | null,
    bodySnippet: null as string | null,
    requestUrl: redactedUrl,
    attemptedAt,
  }

  if (typeof fetchImpl !== 'function') {
    return {
      ...base,
      kind: 'client_error',
      status: APIFY_STATUS_MAP.client_error,
      items: [],
      error: 'apify_client_unavailable: no fetch implementation available',
    }
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (tokenTransport === 'header') headers.authorization = `Bearer ${options.token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: ApifyFetchResponse
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
    })
  } catch (err) {
    const message = redactToken(err instanceof Error ? err.message : String(err), options.token)
    const kind: ApifyOutcomeKind = isAbortLike(err) ? 'timeout' : 'transport_unknown'
    return {
      ...base,
      kind,
      status: APIFY_STATUS_MAP[kind],
      items: [],
      error:
        kind === 'timeout'
          ? `timeout: no Apify response within ${timeoutMs}ms (${message})`
          : `transport_unknown: ${message}`,
    }
  } finally {
    clearTimeout(timer)
  }

  const httpStatus = typeof response.status === 'number' ? response.status : null
  const runId = readRunId(response.headers)
  const retryAfterSeconds = readRetryAfter(response.headers)

  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch (err) {
    const message = redactToken(err instanceof Error ? err.message : String(err), options.token)
    return {
      ...base,
      kind: 'transport_unknown',
      status: APIFY_STATUS_MAP.transport_unknown,
      items: [],
      httpStatus,
      runId,
      retryAfterSeconds,
      error: `transport_unknown: response body unreadable (${message})`,
    }
  }
  const bodySnippet = truncateBody(redactToken(bodyText, options.token))

  const withBody = { ...base, httpStatus, runId, retryAfterSeconds, bodySnippet }

  // 408 is a server-side deadline: same unknown outcome as our own abort.
  if (httpStatus === 408) {
    return {
      ...withBody,
      kind: 'timeout',
      status: APIFY_STATUS_MAP.timeout,
      items: [],
      error: 'timeout: Apify returned HTTP 408',
    }
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      ...withBody,
      kind: 'auth_error',
      status: APIFY_STATUS_MAP.auth_error,
      items: [],
      error: `auth_error: Apify rejected the credentials (HTTP ${httpStatus})`,
    }
  }
  if (httpStatus === 429) {
    return {
      ...withBody,
      kind: 'rate_limited',
      status: APIFY_STATUS_MAP.rate_limited,
      items: [],
      error: `rate_limit: Apify throttled the request${
        retryAfterSeconds != null ? ` (retry after ${retryAfterSeconds}s)` : ''
      }`,
    }
  }
  if (httpStatus != null && httpStatus >= 500) {
    return {
      ...withBody,
      kind: 'server_error',
      status: APIFY_STATUS_MAP.server_error,
      items: [],
      error: `provider_5xx: Apify returned HTTP ${httpStatus}`,
    }
  }
  if (httpStatus == null || httpStatus < 200 || httpStatus >= 300) {
    return {
      ...withBody,
      kind: 'client_error',
      status: APIFY_STATUS_MAP.client_error,
      items: [],
      error: `provider_error: Apify returned HTTP ${httpStatus ?? 'unknown'}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return {
      ...withBody,
      kind: 'invalid_schema',
      status: APIFY_STATUS_MAP.invalid_schema,
      items: [],
      error: 'invalid_schema: Apify returned a body that is not valid JSON',
    }
  }
  if (!Array.isArray(parsed)) {
    return {
      ...withBody,
      kind: 'invalid_schema',
      status: APIFY_STATUS_MAP.invalid_schema,
      items: [],
      error: 'invalid_schema: Apify dataset payload was not a JSON array',
    }
  }

  if (parsed.length === 0) {
    return {
      ...withBody,
      kind: 'no_result',
      status: APIFY_STATUS_MAP.no_result,
      items: [],
      itemCount: 0,
      error: null,
    }
  }

  return {
    ...withBody,
    kind: 'ok',
    status: APIFY_STATUS_MAP.ok,
    items: parsed,
    itemCount: parsed.length,
    error: null,
  }
}

export type RunActorSyncFn = typeof runActorSync
