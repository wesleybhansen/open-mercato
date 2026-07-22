# SPEC-065: Durable and Secure Public Chat Processing

**Status:** Blocked on product decision
**Owner:** Wesley Hansen
**Created:** 2026-07-22
**Related:** SPEC-061, CRM ecosystem E2E launch-prep review

## TLDR

**Key points:**

- Replace the unsafe reply claim stored inside `chat_messages` with tenant-scoped sidecar state and a durable, idempotent worker contract.
- Commit exactly one ordered reply job with each accepted visitor message. Database state is authoritative; queue deliveries and polling requests are recoverable nudges.
- Keep anonymous visitor identity unverified. A claimed email never links a public visitor to an existing CRM contact and never unlocks private contact context for an AI prompt.
- Store only a SHA-256 digest of the high-entropy visitor possession token, remove request-time DDL, protect typing state with the same token, and fail closed for tokenless legacy conversations.
- Serialize provider work per conversation, persist results before metering/publication, and never automatically replay a provider call whose outcome may be ambiguous.

**Scope:**

- Public chat POST/GET and visitor typing contracts.
- Public widget and hosted-page injection/routing hardening.
- Sidecar session and reply-job entities, generated migrations, snapshot reconciliation, queue worker, recovery schedule, and exact cleanup.
- Exact Customer Service chat result/proposal handling and public-chat-specific allowance ambiguity handling.
- Focused unit, queue, real-Postgres concurrency/recovery, and browser/API regression proof.

**Boundaries:**

- This patch does not migrate or rewrite the unmanaged legacy `chat_widgets`, `chat_conversations`, or `chat_messages` schemas. Greenfield test environments use a clearly test-only legacy-chat fixture.
- This patch does not invent an authenticated user for an anonymous visitor or create a falsely user-bound external GDPR grant.
- This patch does not make ecosystem-wide metering strict. Metering remains intentionally fail-open, but an attempt is awaited and never automatically repeated.
- This patch does not deploy, apply migrations, contact a paid provider, or alter production data as part of verification.

**Concerns:**

- Current customer snapshots omit already-shipped Customer Service entities. Snapshot reconciliation must be separated from the sidecar migration so generated SQL contains no duplicate or unrelated schema churn.
- The GDPR writer trigger is installed by the auth migration only on tables that exist at that moment. The migration runner needs an idempotent post-module reconciliation hook before either sidecar can ship.

## Open Questions

- **Q1:** Must each embeddable widget require an explicit allowed-origin list, with the Noli-hosted page always allowed, or is arbitrary-domain embedding an intentional product requirement? The former is the recommended launch-safe default but can disable existing embeds until an administrator configures their domains. CAPTCHA is a separate optional defense and cannot substitute for server-side spend limits.

This question is a hard specification gate. Durable per-widget and per-organization database budgets will bound provider spend either way, but they do not decide whether a copied widget ID should work on an unrelated website.

## Overview

The public chat surface accepts untrusted, anonymous traffic but currently combines request handling, transcript storage, model orchestration, Customer Service side effects, and retry state in one route. The launch-safe design separates those responsibilities. The route validates and commits local state; the queue wakes an idempotent worker; sidecar rows record exact phase and identity; the worker performs at most one provider attempt and publishes an exact deterministic result.

The target audience is a website visitor who expects a prompt, private response and a CRM operator who needs reliable transcripts, handoff, metering, and deletion behavior. The principal value is not higher throughput. It is a provable contract under duplicate delivery, delayed writers, worker crashes, provider ambiguity, tenant mismatch, GDPR erasure, and hostile browser input.

> **Market reference:** PostgreSQL row locks and `SKIP LOCKED` are the source-of-truth concurrency primitives; PostgreSQL documents `SKIP LOCKED` as suitable for queue-like tables and `clock_timestamp()` as actual advancing database time. BullMQ documents that stalled jobs can be returned to waiting and therefore handlers must be idempotent. Its retry and deduplication options are not exposed by the repository's current queue abstraction, so this design deliberately rejects Redis/BullMQ job state as the correctness boundary. References: <https://www.postgresql.org/docs/current/sql-select.html>, <https://www.postgresql.org/docs/current/functions-datetime.html>, <https://docs.bullmq.io/guide/jobs/stalled>, and <https://docs.bullmq.io/patterns/idempotent-jobs>.

## Problem Statement

The checkpoint commit `56056348232801b56ceb4396f1d08b125a7afe2a` is intentionally unsafe and must not ship. Its public-chat draft:

1. Stores a reply claim as `sender_type='__noli_bot_reply_claim__'` inside `chat_messages`. Authenticated transcript readers, list previews, counts, notifications, summaries, and downstream consumers can expose or ingest that operational row.
2. Uses Next.js `after()` as the only scheduler. A terminated request process can strand work.
3. Deletes a claim after a wall-clock TTL even though the provider request has no matching hard completion boundary. A delayed first worker and replacement worker can both spend and reply.
4. Processes only the newest inbound message and drains a bounded list. Rapid messages can be coalesced, reordered, or stranded.
5. Orders equal timestamps by random UUID, which is deterministic only by accident and does not represent admission order.
6. Lets Customer Service publish a random reply, scans for the newest bot row, copies it into the claim, and deletes the source. A concurrent bot writer can be mistaken for the result and deleted.
7. Infers handoff from `[HANDOFF]` in transcript text and then strips the marker, so later work cannot reliably observe the handoff state.
8. Runs `ALTER TABLE` from anonymous GET/POST requests and accepts tokenless legacy conversations.

The antagonistic surface review also found independent launch blockers:

- An anonymous visitor-provided email is treated as verified identity. The route can reuse a real contact and the drafter can inject that contact's email, phone, and lifecycle state into a response for an impersonator.
- `/chat/typing` lets anonymous callers mutate any conversation and select the agent typing fields without possession proof.
- The embeddable script interpolates tenant-controlled greeting text into `innerHTML`, enabling stored XSS in every embedding site's origin.
- Hosted pages look up a globally ambiguous slug, ignore `public_page_enabled`, and can route a visitor and their PII to the wrong organization.
- Public GET sends the possession token in the query string, increasing exposure through access logs and browser history.
- The repository's greenfield migrations do not create the three legacy chat tables even though routes assume them and additional drifted columns.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|---|---|
| One durable job per inbound message | Preserves ordered semantics and makes rapid messages independently observable instead of silently coalescing them. |
| Conversation sequence allocated by a locked session-row update | Defines admission order independently of timestamps, UUID order, or queue arrival. |
| Sidecar state only | Operational UUIDs and phases never enter transcripts or transcript-derived consumers. |
| Database state is authoritative | Queue duplicates, losses, local JSON limitations, and BullMQ stalled replays cannot alter correctness. |
| One provider-start transition, no automatic replay after it | Paid provider APIs do not provide the end-to-end idempotency receipt required to prove a retry is safe. |
| Persist result before metering and publication | A crash after generation resumes from stored output without a second provider call. |
| Mark metering attempted before the call | Preserves intentional fail-open metering while preventing duplicate charges after an ambiguous metering outcome. |
| Deterministic reply and CS proposal identities | Publication can use insert-or-verify semantics and never scan/delete a "latest" row. |
| Hashed possession token; header preferred | Raw secrets are returned/accepted but not stored, and new GET requests keep them out of URLs. |
| Anonymous email remains unverified metadata | Knowledge of an email address is not authentication and cannot unlock a contact record or prompt context. |
| Exact organization processor lease, no fake user | Anonymous work remains fenced during organization erasure without forging user attribution. |
| Collision-fail-closed hosted slugs | Preserves the stable route while preventing cross-tenant routing; new/updated slugs are globally unique. |
| Post-migration GDPR trigger reconciliation | Entity decorators cannot emit the required trigger and module order creates tables after auth migrations. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Keep claim rows in `chat_messages` and filter every reader | Every present and future consumer would need a perfect denylist; one missed reader exposes state or corrupts behavior. |
| Use BullMQ job ID/deduplication as truth | The repository abstraction generates queue IDs, removes completed jobs, configures no attempts/backoff, and local mode has different semantics. |
| Expire provider claims and retry | A timeout or crash does not prove the provider did not process the request. |
| Reply once to the newest rapid-message batch | Changes product semantics and can discard an earlier visitor question. |
| Link public visitors by claimed email | Enables impersonation, private prompt context disclosure, and contamination of a real contact's history. |
| Add FKs to legacy chat tables | Those tables are absent from greenfield migrations, so the sidecar migration would fail on a clean database. |
| Add or restore DDL in `setup-tables.sql` | Explicitly forbidden; the file is deprecated and not a source of truth. |
| Hand-write the sidecar migration | Violates repository migration rules and leaves snapshots divergent. |
| Change `/chat/page/[slug]` in one release | Route URLs are stable contract surfaces. Collision-fail-closed behavior and global uniqueness harden the existing path without removal. |

## User Stories / Use Cases

- **Website visitor** wants each submitted message accepted once and answered in order, even if the browser retries or a worker restarts.
- **Website visitor** wants a conversation UUID to be insufficient to read, append to, or mutate typing state.
- **Existing customer** wants knowledge of their email address not to let another visitor obtain or influence their CRM data.
- **CRM operator** wants public-chat replies, flagged proposals, handoff, previews, counts, and transcripts to stay exact under concurrency.
- **Operator** wants an ambiguous provider attempt visible for reconciliation and never silently replayed.
- **Privacy operator** wants deletion fences to cover every new table and active/ambiguous work to block erasure until safely resolved.
- **Embedding-site owner** wants tenant-configured chat text rendered as text, never executable HTML.

## Architecture

### Components

1. **Public route** validates a discriminated zod body, authenticates possession, and invokes the public-chat data service.
2. **Public-chat data service** owns raw cross-table SQL inside the customers module data layer. Every tenant query includes organization and tenant scope.
3. **Session sidecar** stores the token digest, sequence counter, and explicit bot/handoff state.
4. **Reply-job sidecar** stores exact identities, phase fence, provider result, metering/publication markers, and bounded CS metadata.
5. **Queue adapter** enqueues either one exact job nudge or one organization sweep nudge on `customers-public-chat-replies`.
6. **Customers worker** validates the payload and calls the reply processor. Worker concurrency is at most five; conversation-row locking provides per-conversation serialization.
7. **Recovery schedule** is idempotently registered per organization when a widget or public session is used. It sweeps only that exact organization and tenant. GET/POST also nudge recoverable work.
8. **Reply processor** acquires the exact organization GDPR processor lease through `withCustomersAiAllowance`, performs state transitions using database time, invokes at most one provider sequence, persists the result, attempts metering once, and publishes exactly.
9. **Post-migration fence hook** reattaches the existing GDPR organization/user guard triggers after each module's generated migrations and is verified on a fresh schema.

### Message Admission Sequence

1. Parse and bound widget ID, conversation ID, message ID, token, name, email, and message.
2. Resolve the widget with exact organization and tenant values from its row; never accept scope from the public caller.
3. For a new session, generate or accept client-generated high-entropy IDs/token, store only `sha256:<hex>`, and leave `contact_id` null.
4. For an existing session, load conversation and session using conversation ID plus organization plus tenant. Compare token digests in constant time. A token-bearing legacy row can bootstrap a sidecar on a successful append; a tokenless row fails closed.
5. Lock/update the exact sidecar session row with `clock_timestamp()`, increment `last_sequence`, and insert the visitor message and reply job in one transaction.
6. A repeated message ID with the exact same scope, sender, and body returns the existing acceptance. A conflicting reuse returns `409` without disclosure.
7. Commit, then update the unified inbox as unverified chat metadata with `contactId: null` and enqueue the exact job. Queue failure leaves the committed job recoverable.

### Worker State Machine

`queued -> leased -> provider_started -> result_ready -> metering_started -> publish_ready -> completed`

Additional terminal states are `failed` and `cancelled`. `reconciliation` is deliberately nonterminal and blocks GDPR erasure.

- Under a session-row lock, select the lowest nonterminal sequence. A later job cannot bypass an earlier leased or provider-started job.
- Claim `queued` or expired pre-provider `leased` work by CAS with a new `claim_token`, incremented attempt count, and `run_after=clock_timestamp()+lease`.
- Every mutation matches job ID, organization ID, tenant ID, widget ID, conversation ID, expected status, and claim token.
- Persist `provider_started` before any provider I/O. A provider call uses a hard abort signal; `run_after` is later than that client timeout.
- A normal provider error or abort stores a deterministic local handoff. A crashed/stale `provider_started` job transitions to reconciliation or the same local handoff without a second provider call. A late original worker loses its claim-token CAS.
- Persist the generated/public text, model, usage, BYOK flag, outcome, and bounded CS metadata before metering.
- CAS to `metering_started` before calling fail-open metering. A recovered `metering_started` job advances without repeating the call.
- Publish the deterministic `reply_message_id` and any deterministic CS proposal rows in one transaction. `ON CONFLICT DO NOTHING` is followed by an exact content/scope verification; mismatch moves to reconciliation.
- For a paused CS result, mark notification attempted before email. An ambiguous notification is not automatically resent. The holding reply and review proposal remain durable.
- Mark the job completed, advance explicit session handoff state when applicable, clear typing state, then enqueue the next exact sequence.

### Customer Service Contract

The current `handleCsChatMessage(): Promise<boolean>` contract is replaced by two explicit phases:

- `generateCsChatPlan(...)` returns a bounded result containing the exact action (`reply` or `pause`), public text, held draft, model/usage, confidence, and validated flag reasons. It performs no transcript or proposal write.
- `publishCsChatPlan(...)` accepts deterministic reply/proposal IDs from the job, writes insert-or-verifies exact rows, and returns the exact reply ID. It never queries or deletes the latest bot row.

When Customer Service is enabled, its provider attempt is the sole provider path. A CS provider failure does not fall through to a second standalone provider call.

### Allowance and GDPR Contract

- `withCustomersAiAllowance` continues to acquire the organization processor lease and, when authenticated, a user lease. Public chat passes no synthetic user.
- Its internal allowance resolver exposes an additional non-breaking resolution signal to the processor scope: `authoritative`, `unlinked`, or `unavailable`. Existing callers continue to receive the same `AllowanceResult` shape and fail-open behavior.
- Public chat spends a platform key only when allowance resolution is authoritative. `unlinked` or `unavailable` resolves to a local handoff. Authoritative BYOK uses only the BYOK credential.
- The queue wrapper may independently acquire an organization lease from the exact payload; nested exact processor leases are allowed and both are released.
- Active job statuses remain nonterminal for the GDPR active-job scanner. No TTL deletes `provider_started` or `reconciliation` rows.

### Commands & Events

Public ingestion and internal phase transitions are not exposed as undoable command-bus mutations. Reversing an accepted visitor message, paid provider call, or sent email would be misleading and cannot restore the external world. The equivalent orchestration boundaries are:

- `customers.public-chat.accept-message`: one atomic local transaction; safe duplicate returns existing state.
- `customers.public-chat.process-reply`: worker-only phase machine; retry resumes by state.
- `customers.public-chat.cancel-widget`: exact scoped transaction that invalidates claims before deletion.

No new workflow event is emitted in this launch patch. Existing inbox synchronization remains a best-effort derived projection and can be rebuilt from transcript state.

## Data Models

### CustomerPublicChatSession (`customer_public_chat_sessions`)

- `id`: UUID primary key, generated by PostgreSQL.
- `organization_id`: UUID, required.
- `tenant_id`: UUID, required.
- `widget_id`: UUID, required scalar reference to unmanaged chat widget.
- `conversation_id`: UUID, required scalar reference to unmanaged chat conversation.
- `visitor_token_hash`: text, required, format `sha256:<64 lowercase hex>`.
- `token_expires_at`: timestamptz, required. New sessions use a bounded 30-day lifetime unless the product policy changes before approval.
- `token_revoked_at`: timestamptz, nullable. Closure blocks writes immediately; revocation blocks reads and writes.
- `last_sequence`: integer, required, default `0`.
- `bot_state`: text, required, default `active`; `active | handed_off | disabled`.
- `handoff_reason`: text, nullable, allow-listed machine code.
- `handoff_message_id`: UUID, nullable.
- `handed_off_at`: timestamptz, nullable.
- `created_at`, `updated_at`: timestamptz, required.

Indexes:

- Unique `customer_public_chat_sessions_conversation_key (conversation_id)` for point lookup and one allocator row.
- `customer_public_chat_sessions_scope_widget_idx (organization_id, tenant_id, widget_id)` for scoped cleanup and GDPR discovery.

The token hash is not indexed. Tokens have high entropy and are compared only after the exact scoped conversation lookup.

### CustomerPublicChatReplyJob (`customer_public_chat_reply_jobs`)

- Identity: `id`, `organization_id`, `tenant_id`, `widget_id`, `conversation_id`, `inbound_message_id`, `reply_message_id` (UUIDs), and `sequence` (integer), all required.
- Phase fence: `status` text default `queued`, `run_after` timestamptz nullable, `claim_token` UUID nullable, `attempt_count` integer default `0`, `phase_started_at` timestamptz nullable.
- Result: `outcome` text nullable (`reply | handoff | cs_pause | no_reply`), `generated_text` text nullable, `public_reply_text` text nullable, `model` text nullable, `tokens_in`/`tokens_out` integer nullable, `byo_key` boolean nullable.
- Exact side effects: `metering_attempted_at`, `published_at`, `notification_attempted_at`, `notification_sent_at` timestamptz nullable.
- Provider accounting: `provider_started_at` timestamptz nullable, used by database-backed per-widget/per-organization admission limits and ambiguity recovery.
- `result_metadata`: bounded jsonb nullable. The zod schema permits only confidence, validated flag reasons, and deterministic CS proposal identities; no secret, raw provider response, or unbounded transcript.
- Diagnostics: `last_error` text nullable, sanitized/truncated machine-safe detail only.
- Audit: `created_at`, `updated_at`, `completed_at` timestamptz.

Statuses are exactly `queued | leased | provider_started | result_ready | metering_started | publish_ready | reconciliation | completed | failed | cancelled`. `completed`, `failed`, and `cancelled` match the existing GDPR terminal-state classifier.

Indexes:

- Unique `customer_public_chat_reply_jobs_inbound_key (inbound_message_id)`.
- Unique `customer_public_chat_reply_jobs_conversation_sequence_key (conversation_id, sequence)`.
- Unique `customer_public_chat_reply_jobs_reply_key (reply_message_id)`.
- `customer_public_chat_reply_jobs_scope_conversation_idx (organization_id, tenant_id, widget_id, conversation_id)`.
- `customer_public_chat_reply_jobs_status_run_after_idx (status, run_after)`.
- `customer_public_chat_reply_jobs_widget_provider_started_idx (organization_id, tenant_id, widget_id, provider_started_at)`.
- `customer_public_chat_reply_jobs_org_provider_started_idx (organization_id, tenant_id, provider_started_at)`.

No ORM relationship or database FK is added to unmanaged chat tables. Both entities are operational and hard-deleted through exact cleanup; they do not use soft-delete columns.

## API Contracts

All bodies and query/path values use zod validators in `apps/mercato/src/modules/customers/data/validators.ts`. All public transcript responses include `Cache-Control: no-store` and minimal errors.

### Start a conversation

- `POST /api/chat/public`
- Metadata remains anonymous with the existing rate limit.
- Preferred request:

```json
{
  "widgetId": "uuid",
  "conversationId": "client-generated uuid",
  "messageId": "client-generated uuid",
  "visitorToken": "43-character base64url secret",
  "visitorName": "optional bounded text",
  "visitorEmail": "optional bounded normalized email",
  "message": "bounded non-empty text"
}
```

- During one compatibility release, omitted IDs/token are server-generated and returned as today. New widget code always supplies them so a lost response can be retried exactly.
- Response `201`: `{ ok: true, data: { conversationId, messageId, visitorToken, greeting } }`.
- The raw token is never persisted. Name/email remain unverified metadata and `contact_id` remains null.

### Append a visitor message

- `POST /api/chat/public`
- Request: `{ conversationId, messageId, visitorToken, message }`.
- Compatibility: `messageId` may be omitted for one release and is server-generated, but that request cannot promise network-retry idempotency.
- Response `201` for new acceptance or `200` for exact duplicate acceptance.
- Missing/wrong token, tokenless legacy row, and wrong scope all return the same `404`.
- Conflicting message-ID reuse returns minimal `409`.

### Poll transcript

- `GET /api/chat/public?conversationId=<uuid>&after=<opaque-cursor>&limit=<1..100>`.
- Preferred token transport: `X-Noli-Chat-Token` request header. `Access-Control-Allow-Headers` includes it.
- Query-string `visitorToken` remains a deprecated one-release bridge for cached widget scripts, then is removed under the deprecation policy.
- Keyset pagination returns at most 100 messages per request. The opaque cursor represents the last stable message ordering key; offset pagination and an unbounded full-transcript response are forbidden.
- Response allow-lists only public message ID, sender role, bounded content, timestamp, next cursor, conversation status, and current agent typing state. It exposes no contact identity, raw/token hash, job, claim, proposal, model metadata, or internal error data. Authenticated transcript detail uses the same message allow-list rather than serializing the conversation entity.
- Every transcript response uses `Cache-Control: no-store`.

### Set visitor/agent typing

- `POST /api/chat/typing`.
- Visitor request: `{ conversationId, isTyping, sender: "visitor" }` plus `X-Noli-Chat-Token`.
- Visitor mutation requires exact possession and exact organization/tenant/conversation update scope.
- Any non-visitor sender requires authenticated cookies and exact auth organization/tenant scope. Anonymous callers cannot set agent typing state.
- Missing/wrong possession returns `404`; invalid body returns `400`.

### Close, deactivate, and delete

- Message admission requires an active widget, an open conversation, an unexpired and unrevoked session token, and exact organization/tenant scope. The worker rechecks widget/conversation/session state before entering `provider_started`.
- Closing a conversation rejects new visitor writes but retains possession-based reads for the token lifetime. Revocation or expiry rejects both reads and writes with the same nondisclosing `404` used for wrong scope/token.
- Widget or conversation deletion first deactivates the public surface in an exact scoped transaction. It cancels only `queued` or pre-provider `leased` jobs. `provider_started`, persisted-result, metering, publication, and reconciliation phases remain fenced until they reach an exact terminal outcome.
- Final cleanup runs only after zero nonterminal jobs. It removes the exact unified-inbox projection, deterministic Customer Service proposals/actions, sidecars, messages, conversation, and widget in dependency order. Historical public-chat `contact_id` values are never used as trusted cleanup scope.

### Worker payload

- Queue: `customers-public-chat-replies`.
- Exact job nudge: `{ mode: "job", jobId, organizationId, tenantId, conversationId }`.
- Sweep nudge: `{ mode: "sweep", organizationId, tenantId, _idempotencyKey? }`.
- Unknown keys other than the scheduler's documented idempotency key are rejected or stripped by zod.

### Widget script and hosted page

- `GET /api/chat/widget/[widgetId]` validates the UUID, serializes server values with `JSON.stringify`, validates colors/position, and renders tenant text only through `textContent`.
- Widget POSTs include client-generated IDs/token and typing/poll requests use the token header.
- `GET /api/chat/page/[slug]` requires `is_active=true` and `public_page_enabled=true`. It reads at most two candidates and returns `404` unless exactly one exists.
- Widget create/update validates and bounds all fields and enforces global slug uniqueness. Existing duplicate slugs remain unavailable until an operator resolves them; no cross-tenant fallback is allowed.
- The allowed-origin behavior is intentionally unresolved pending Q1. If explicit origins are selected, every embeddable request validates the normalized `Origin` against the widget allow-list while the Noli-hosted page remains allowed. If arbitrary embedding is retained, the database provider budgets below remain mandatory but do not establish site ownership.
- All modified routes continue to export `openApi`.

### Authenticated chat authorization

- Conversation lists and transcript reads require `customers.engagement.view` plus exact organization and tenant scope.
- Agent replies, agent typing, status changes, deactivation, and deletion require `customers.engagement.manage` plus exact organization and tenant scope.
- Widget creation and settings changes require `customers.settings.manage` plus exact organization and tenant scope.
- The backend page declares matching feature metadata. Authentication without the matching feature never grants access, and omission of tenant scope is an error rather than an organization-wide fallback.

### Provider admission budgets and bounds

- Paid-provider admission is serialized in PostgreSQL using deterministic organization-then-widget advisory transaction locks. Under those locks, the worker counts exact `provider_started_at` rows against database `clock_timestamp()` and persists its own `provider_started` transition in the same transaction.
- Proposed launch defaults are 60 provider starts per widget per rolling hour and 300 per organization/tenant per rolling hour. They are conservative code/config limits subject to approval and telemetry, not a substitute for the Q1 origin policy.
- Failure to acquire/read the budget or resolve exact scope fails closed to a local handoff without a provider call. The existing process-local per-IP limiter remains defense in depth only; it is not a distributed spend boundary.
- Zod bounds apply to visitor text, names, email, widget configuration, and every CS metadata field. Provider requests use a bounded transcript/context window and provider output tokens are capped. Persisted public/held text is truncated or rejected at the documented bound before publication.

## Internationalization (i18n)

No new backend visual surface is introduced. Existing embedded-widget strings remain unchanged. New API errors are machine-oriented and minimal. If an operator reconciliation UI is added later, its strings must be added to customers locale files; that UI is outside this patch.

## UI/UX

The visual widget contract remains unchanged. Security changes are behavioral:

- a message remains optimistic in the widget while POST is pending;
- client IDs/token survive response loss in session storage;
- a `404` possession failure clears the stale local session instead of retrying tokenless;
- provider ambiguity produces the configured human-handoff text rather than duplicate or indefinite silence;
- a disabled or collision-ambiguous hosted page renders the existing not-found experience.

Tenant-provided strings always enter the DOM through `textContent`. Static trusted SVG/markup may remain in `innerHTML` only when it contains no tenant/user data.

## Configuration

- Production requires `QUEUE_STRATEGY=async`, a valid queue Redis URL, discovered workers enabled, and the scheduler worker running. The literal value is `async`; `redis` is invalid for the current factory.
- Provider timeout and stale-provider reconciliation thresholds are bounded code constants covered by tests. The stale threshold must be greater than the provider abort timeout.
- No new secret is required. Tokens are random client/server secrets, not derived from a deployment secret.
- Missing platform provider credentials, unlinked billing scope, or ambiguous allowance resolution produce local handoff without a provider call.

## Migration & Compatibility

1. Add the two sidecar entities to core customers `data/entities.ts` using scalar IDs only.
2. Before adding them, run a generator-only reconciliation for each reachable snapshot name. The first generated diff may identify already-shipped Customer Service tables missing from snapshots. Verify those tables against their committed migrations, keep the generator-owned snapshot correction, and discard the duplicate generated migration artifact. Do not edit its SQL into a new migration.
3. Add sidecars and run `yarn db:generate` again in an isolated, fully migrated database. Accept only a narrow additive two-table migration plus expected snapshot changes. Reject Customer Service, destructive, or unrelated churn.
4. Keep `.snapshot-crm.json`, `.snapshot-open-mercato.json`, and `.snapshot-openmercato.json` explicitly reconciled or document/prove why a variant is obsolete; do not let database-name selection recreate phantom diffs.
5. Add a migration-runner post-module hook that, when the existing GDPR trigger functions are installed, idempotently attaches the organization/user scope guards to every discovered eligible table. This is not a hand-written sidecar migration. Fresh-schema verification must report zero missing organization writer fences after customers migration.
6. Do not apply the generated migration to production in this task. Deployment remains a separately approved operation with rollback and cleanup evidence.
7. Existing token-bearing conversations remain accessible using the plaintext legacy row only for the compatibility window and bootstrap a hashed sidecar with a 30-day expiry on a successful append. Tokenless legacy conversations fail closed. New sidecars always have an expiry; closure, expiry, and explicit revocation semantics match the API contract above.
8. Stable route URLs and response fields remain. New request fields are additive/optional during the bridge. Query-token support is explicitly deprecated before later removal.
9. Anonymous contact auto-linking is removed immediately as a security correction. Existing `contact_id` values on old public conversations are not trusted for AI context or future public inbox projection.
10. Legacy chat-table migration is tracked separately. The integration suite creates test-only legacy tables and never restores DDL to `setup-tables.sql`.

Rollback before deployment removes the new application paths and generated sidecar migration together. After deployment, schema rollback requires first proving no nonterminal jobs and preserving transcript rows; provider/email side effects cannot be undone.

## Implementation Plan

### Phase 1: Reconcile schema authority

1. Prove current snapshot drift and map every Customer Service entity to committed migration SQL.
2. Reconcile generator-owned snapshot variants without committing duplicate table SQL.
3. Add sidecar entities, generate the narrow migration, and inspect up/down SQL and snapshots.
4. Add and test post-module GDPR writer-fence reconciliation.

### Phase 2: Build durable data/queue boundaries

1. Add zod public/API/worker/result validators.
2. Add the scoped public-chat data service with token hashing, atomic admission, database-time claim/CAS, recovery, publication verification, and cleanup.
3. Add queue adapter, worker metadata/handler, and per-organization recovery schedule registration.
4. Remove transcript sentinels, newest-only admission, bounded drain, request-time DDL, and `after()` provider scheduling.

### Phase 3: Make provider and CS side effects exact

1. Add the non-breaking allowance-resolution signal and public fail-closed platform-spend rule.
2. Split Customer Service generation from deterministic publication and add provider abort propagation.
3. Implement stored-result metering and publication transitions, explicit handoff state, and no-replay ambiguity recovery.
4. Add database-time per-widget/per-organization provider admission budgets, bounded context/output, and lifecycle rechecks.
5. Add deactivate-first widget/conversation deletion, pre-provider-only cancellation, in-flight reconciliation, and exact downstream cleanup.

### Phase 4: Harden the browser/public surface

1. Protect typing with possession/auth and exact scope.
2. Remove anonymous contact linking/context.
3. Encode widget script data and render tenant text safely.
4. Enforce hosted-page enablement, global new-slug uniqueness, and existing-collision fail-closed behavior.
5. Upgrade the widget to client IDs/token headers while retaining the bounded compatibility bridge.
6. Implement the approved Q1 origin policy and its compatibility/operator path; do not infer that decision from CORS defaults.

### Phase 5: Verify and review

1. Run focused Jest route/service/CS/worker/queue suites with provider and external systems mocked.
2. Run real PostgreSQL 16 delayed-writer, concurrency, database-time, tenant-isolation, crash-boundary, reader-leak, and cleanup cases in a fresh ephemeral environment.
3. Run local and mocked async queue-strategy tests, typecheck, generate/forbidden-pattern checks, and app/core builds.
4. Run independent adversarial code review and resolve every P0/P1/P2 finding.
5. Update the ecosystem handoff and master tracker with exact evidence and remaining live-browser/deployment gates.

### File Manifest

| File or area | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/customers/data/entities.ts` | Modify | Add sidecar entities. |
| `packages/core/src/modules/customers/migrations/` | Generate/reconcile | Narrow additive migration and generator-owned snapshots. |
| `packages/cli/src/lib/db/commands.ts` | Modify | Post-module GDPR guard reconciliation. |
| `apps/mercato/src/modules/customers/data/` | Create | Zod contracts and scoped raw-SQL data layer. |
| `apps/mercato/src/modules/customers/lib/public-chat-*` | Create/modify | Queue, processor, exact CS plan/publication. |
| `apps/mercato/src/modules/customers/workers/public-chat-reply.ts` | Create | Auto-discovered idempotent worker. |
| `apps/mercato/src/modules/customers/api/chat/public/route.ts` | Rewrite | Thin validated admission/poll endpoint. |
| `apps/mercato/src/modules/customers/api/chat/typing/route.ts` | Modify | Possession/auth scope. |
| Widget, hosted-page, and widget-management routes | Modify | XSS, slug, enablement, validation, cleanup. |
| Focused Jest and integration files | Create | Crash, concurrency, identity, queue, and browser/API proof. |
| Handoff and ecosystem master tracker | Modify | Current restart authority and evidence. |

### Testing Strategy

- Route tests: raw token returned once, hash-only persistence, exact/legacy/tokenless/expired/revoked behavior, atomic job, post-commit enqueue, queue failure recovery, no contact linking, keyset cap, response allow-list, `no-store`, and transcript-only reads.
- Auth/lifecycle tests: exact feature and org/tenant gates for every authenticated route; closed/inactive admission rejection; pre-provider cancellation; post-provider reconciliation; delete-versus-worker race; exact inbox/proposal/action cleanup.
- Processor tests: BYOK selection, authoritative platform gate, no key/provider avoidance, exact org lease, persist-before-meter, awaited fail-open meter, exact IDs, database-backed widget/org budgets, database-time windows, limiter failure closed, input/output bounds, and fault injection after every phase.
- CS tests: auto-answer/auto-send/pause plans, deterministic proposal/holding IDs, no latest-row scan/delete, ambiguous alert no-resend.
- Worker tests: metadata, exact scope, duplicate delivery, stale pre-provider reclaim, provider ambiguity no replay, terminal no-op.
- Queue tests: local and mocked async selection, exact payload, duplicate nudge tolerance, temporary local queue round trip.
- Real Postgres tests: one claim winner, contiguous sequences, deliberately delayed writer, equal timestamps irrelevant, `clock_timestamp()` decisions, tenant mismatch, GDPR trigger coverage, reader/count/summary absence, exact cleanup.
- Public security regressions: email impersonation cannot bind contact/context, typing IDOR fails, greeting XSS remains inert, duplicate hosted slug and disabled page return not found, copied-widget behavior matches the approved Q1 policy, and authenticated detail cannot leak a token or internal entity fields.
- Full verification uses no paid provider and no production Redis/database. A true Redis transport test, production browser/log/database proof, migration application, push, and deploy require separate approval.

## Risks & Impact Review

### Data Integrity Failures

#### Duplicate or out-of-order reply
- **Scenario**: Rapid visitor POSTs, duplicate queue deliveries, or delayed workers process the same conversation concurrently.
- **Severity**: High
- **Affected area**: Public transcript, provider spend, Customer Service proposals.
- **Mitigation**: Session-row sequence allocation, lowest-nonterminal selection, exact claim-token CAS, unique inbound/conversation-sequence/reply IDs, and insert-or-verify publication.
- **Residual risk**: A database outage delays replies; committed jobs remain recoverable and ordering is preserved.

#### Provider outcome is ambiguous
- **Scenario**: The worker times out or crashes after the provider accepted a request but before the result is persisted.
- **Severity**: High
- **Affected area**: Provider cost, visitor reply, GDPR active work.
- **Mitigation**: Persist `provider_started`, impose an abort timeout, forbid automatic provider replay, invalidate the old claim token, and install deterministic local handoff or reconciliation.
- **Residual risk**: The provider may bill an attempt whose result is discarded; avoiding a duplicate charge/reply is safer than speculative replay.

#### Partial Customer Service publication
- **Scenario**: Proposal, action, holding message, or job completion fails mid-flow.
- **Severity**: High
- **Affected area**: Review queue and visitor handoff.
- **Mitigation**: Deterministic IDs and one transaction for local publication, exact conflict verification, stored plan, and resumable job state.
- **Residual risk**: Alert email can be ambiguous; it is not automatically resent, while the durable proposal remains visible.

### Cascading Failures & Side Effects

#### Queue or scheduler unavailable
- **Scenario**: Redis enqueue or scheduler synchronization fails after message commit.
- **Severity**: Medium
- **Affected area**: Reply latency.
- **Mitigation**: Database job is authoritative; POST/GET nudge it, per-org schedule persists independently, worker completion nudges the next sequence, and operators can sweep exact scope.
- **Residual risk**: If queue, scheduler, and all visitor traffic stop simultaneously, processing waits for recovery instead of running in request memory.

#### Metering or notification ambiguity
- **Scenario**: External usage logging or email returns ambiguously and the worker crashes.
- **Severity**: Medium
- **Affected area**: Billing telemetry or operator alerting.
- **Mitigation**: Mark attempt before call, await within the processor lease, never auto-repeat an ambiguous attempt, and retain durable local result/proposal.
- **Residual risk**: Fail-open policy permits a missed meter or alert. That is the existing ecosystem tradeoff and is preferable to duplicate usage/notifications.

### Tenant & Data Isolation Risks

#### Email impersonation exposes CRM context
- **Scenario**: An attacker submits a known customer email and prompts the model to reveal linked contact fields.
- **Severity**: Critical
- **Affected area**: CRM PII, AI prompt, timeline, unified inbox.
- **Mitigation**: Public identity is always unverified; no contact lookup/create/link, no contact context, `contactId: null` projections, and regression tests.
- **Residual risk**: A visitor can still type someone else's email as unverified metadata; operators must verify it out of band.

#### Cross-tenant ID or slug confusion
- **Scenario**: A caller guesses a conversation ID or a common hosted-page slug resolves to another tenant.
- **Severity**: Critical
- **Affected area**: Transcript/PII routing and typing state.
- **Mitigation**: Possession token plus organization and tenant on every query/CAS; globally unique new slugs; duplicate legacy slug fails closed; public-page flag enforced.
- **Residual risk**: Existing duplicate hosted slugs require operator remediation and remain unavailable meanwhile.

#### Noisy tenant starves worker
- **Scenario**: One organization creates a large pending backlog.
- **Severity**: Medium
- **Affected area**: Shared worker latency.
- **Mitigation**: Database-backed provider budgets, per-conversation serialization, bounded scope sweeps, status/deadline index, worker concurrency cap, and one-job nudges.
- **Residual risk**: Queue fairness remains transport-dependent; metrics must reveal lag by organization without logging message content.

#### Copied widget ID drives victim spend
- **Scenario**: An attacker copies a public widget ID or distributes requests across source IPs and attempts to consume another organization's provider allowance.
- **Severity**: High
- **Affected area**: Provider cost, shared worker capacity, visitor availability.
- **Mitigation**: Exact database-time widget and organization budgets fail closed before `provider_started`; the selected Q1 origin policy adds a site-ownership boundary if explicit origins are required.
- **Residual risk**: Browser origin is not proof against non-browser callers. Even with an allow-list, the durable server-side budgets remain the correctness boundary; CAPTCHA is only optional abuse friction.

### Migration & Deployment Risks

#### Generated migration contains phantom Customer Service tables
- **Scenario**: Stale snapshots cause `db:generate` to emit existing CS tables alongside sidecars.
- **Severity**: High
- **Affected area**: CRM deploy/migration safety.
- **Mitigation**: Reconcile snapshots in a separate generator-only step, map existing tables to committed migrations, then generate and accept only a narrow sidecar diff.
- **Residual risk**: Database-name-specific snapshots can diverge again; all reachable names remain an explicit verification gate.

#### New tables miss GDPR writer fences
- **Scenario**: Auth migrations run before customers migrations and the trigger scan never sees sidecars.
- **Severity**: Critical
- **Affected area**: GDPR erasure race and proof.
- **Mitigation**: Post-module migration reconciliation attaches existing exact guard triggers; fresh-schema proof requires zero missing fences.
- **Residual risk**: Tables created outside the mandated migration runner remain unsafe; repository policy already forbids that path.

#### Legacy chat schema absent on greenfield
- **Scenario**: A clean install has sidecars but no transcript/widget tables.
- **Severity**: High
- **Affected area**: New CRM installations.
- **Mitigation**: No FK dependency; test-only schema fixture for this patch; separate tracked migration of unmanaged chat tables before declaring general greenfield chat support.
- **Residual risk**: Public chat remains deployment-specific until that follow-up lands; the Noli launch deployment must prove its live schema before rollout.

### Operational Risks

#### Reconciliation job blocks deletion indefinitely
- **Scenario**: An ambiguous provider phase remains unresolved.
- **Severity**: High
- **Affected area**: Organization GDPR erasure and public chat.
- **Mitigation**: Operator-visible status, exact identity/error code, no TTL deletion, explicit resolution/cancellation procedure, and active-job proof.
- **Residual risk**: Human intervention may be required. Silent replay or deletion would violate stronger guarantees.

#### Delete races active provider work
- **Scenario**: An operator deletes a widget or conversation while a worker is before, during, or after an external call.
- **Severity**: High
- **Affected area**: Transcript consistency, provider cost, downstream proposals/inbox state, GDPR proof.
- **Mitigation**: Deactivate first, cancel only pre-provider phases, retain post-provider/reconciliation rows, require zero nonterminal jobs, then remove exact deterministic downstream identities transactionally.
- **Residual risk**: Ambiguous external work can delay deletion until operator adjudication; reporting completion early is forbidden.

#### Stored XSS in embedded origin
- **Scenario**: Tenant-controlled greeting/config breaks out of generated JS/HTML.
- **Severity**: Critical
- **Affected area**: Every website embedding the widget.
- **Mitigation**: Zod bounds/allow-lists, `JSON.stringify` for JS literals, `textContent` for all tenant text, strict color validation, and executable-payload regression tests.
- **Residual risk**: The trusted static widget bundle still runs with host-page privileges by design; it must contain no untrusted markup sinks.

#### Sidecar storage growth
- **Scenario**: Completed operational rows grow without bound.
- **Severity**: Low
- **Affected area**: Database size and sweep indexes.
- **Mitigation**: Compact scalar rows, bounded JSON metadata, indexed active scans, exact hard cleanup with widget/GDPR deletion, and future terminal-retention job.
- **Residual risk**: This launch patch does not introduce TTL deletion; retention policy requires separate approval and proof.

## Explicitly Deferred Follow-ups

- Migrate the legacy chat widget/conversation/message tables into generated ORM schema authority. This patch supplies only a test fixture and launch-deployment schema proof.
- Consider iframe isolation and a dedicated content-security policy for the embeddable widget. The current compatibility contract executes the trusted bundle in the host page.
- Introduce dedicated chat feature identifiers only through an additive entitlement rollout; this patch uses existing engagement/settings features to avoid silently locking out current roles.
- Replace polling with SSE or another resumable stream only after the durable cursor contract is proven. Polling remains the compatible launch transport.
- Broader chat UI convention cleanup is out of scope unless required to close a security, accessibility, or correctness regression touched here.

## Final Compliance Report — 2026-07-22

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/customers/data/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/cli/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root | No direct ORM relationships between modules | Compliant | Sidecars use scalar IDs and no FK to unmanaged tables. |
| Root | Every tenant query filters organization and tenant | Compliant | Exact scope is part of every load, CAS, cleanup, and test. |
| Root | Validate inputs with zod in data validators | Compliant | Public, typing, worker, and result metadata schemas are specified. |
| Root | No `setup-tables.sql` additions | Compliant | Legacy tables use test-only fixtures; new state is entity-owned. |
| Root / CLI | Never hand-write migrations | Compliant | Snapshot reconciliation and sidecar migration are generator-owned; trigger attachment is a migration-runner post-hook. |
| Root | Raw cross-entity SQL belongs in module data layer | Compliant | A focused customers data service owns it; routes remain thin. |
| Core | API routes export `openApi` | Compliant | Every modified route retains/gets OpenAPI export. |
| Core customers | Use commands/undo for CRUD | N/A | Anonymous ingestion/internal job phases and irreversible external calls are non-CRUD orchestration; exact transaction/recovery semantics are documented. |
| Queue | Use package queue and idempotent workers | Compliant | One discovered worker, validated payload, DB-authoritative idempotency, both strategy tests. |
| Queue | Concurrency no greater than 20 | Compliant | At most five; per-conversation row lock serializes provider work. |
| Backward compatibility | API/data changes additive with bridge | Compliant | Stable URLs/responses, optional new fields, legacy token/query bridge, generated additive tables. |
| GDPR checkpoint contract | Exact scope, leases, active-job proof | Compliant | Exact org/tenant identities, organization processor lease, terminal classifier, post-migration triggers. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | API IDs map to exact session/job fields; raw token never maps to a stored raw column. |
| API contracts match UI/UX section | Pass | Widget generates IDs/token, uses header, and handles fail-closed session loss. |
| Risks cover all write operations | Pass | Admission, provider, meter, publication, notification, cleanup, migration, and hosted routing are covered. |
| Commands defined for all mutations | Pass | Non-undoable orchestrations and cancellation boundary are explicit; no new CRUD surface. |
| Cache strategy covers all read APIs | Pass | Transcript/token endpoints are `no-store`; widget script keeps bounded public caching; no tenant data cache is introduced. |

### Non-Compliant Items

- Q1 is unresolved. The design cannot claim a complete embedding trust policy until the product owner chooses explicit per-widget allowed origins or intentionally retains arbitrary-domain embedding.
- Implementation is not approved until that decision is recorded and generated migration/snapshot evidence, fresh-schema GDPR trigger proof, focused tests, builds, and final independent adversarial review all match this specification.

### Verdict

- **Blocked on product decision:** Do not begin implementation until Q1 is answered. The recommended launch-safe choice is explicit per-widget allowed origins with the Noli-hosted page always allowed, plus the mandatory database provider budgets.

## Changelog

### 2026-07-22

- Initial skeleton after read-only checkpoint audit and public-chat claim review.
- Expanded scope after queue, data-model, migration, test-harness, and antagonistic public-surface reviews found contact impersonation, typing IDOR, stored XSS, hosted-page ambiguity, stale snapshots, and missing future-table GDPR fences.
- Added exact token lifecycle, authenticated RBAC, bounded transcript reads, database-backed provider admission, deactivate-first cleanup, and an explicit Q1 embedding-origin gate after the complete public-surface audit.

### Review — 2026-07-22

- **Reviewer:** Three independent read-only audits completed: entity/migration design, test harness, and full public surface.
- **Security:** Critical anonymous-email impersonation, typing IDOR, stored XSS, hosted routing, token leakage, lifecycle, RBAC, and spend-abuse findings are addressed in the proposed contract; Q1 remains open.
- **Performance:** Durable queue ordering, bounded polling/context/output, worker fairness, and indexed database budgets are specified; implementation evidence is pending.
- **Cache:** Transcript/session responses are `no-store`; widget caching remains bounded; implementation evidence is pending.
- **Commands:** External/irreversible orchestration and exact cancellation boundaries are specified; implementation evidence is pending.
- **Risks:** Admission, provider, metering, publication, notification, deletion, migration, routing, and copied-widget abuse are covered.
- **Verdict:** Blocked on Q1; no code or migration implementation is approved yet.
