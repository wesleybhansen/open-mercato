#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/crm-gdpr-postgres.XXXXXX")"
PGDATA="$TMP_DIR/data"
SOCKET_DIR="$TMP_DIR/socket"
PORT="$((43000 + RANDOM % 1000))"

cleanup() {
  if [[ -d "$PGDATA" ]]; then
    pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$SOCKET_DIR"
initdb -D "$PGDATA" -A trust -U postgres >/dev/null
pg_ctl -D "$PGDATA" -o "-F -k '$SOCKET_DIR' -p $PORT" -w start >/dev/null
createdb -h "$SOCKET_DIR" -p "$PORT" -U postgres gdpr_test

PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d gdpr_test)

"${PSQL[@]}" >/dev/null <<'SQL'
create table public.organizations (
  id uuid primary key,
  noli_org_id text unique,
  tenant_id uuid
);
create table public.users (
  id uuid primary key,
  organization_id uuid references public.organizations(id),
  tenant_id uuid,
  email text,
  email_hash text,
  clerk_user_id text,
  deleted_at timestamptz
);
create table public.org_content (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  body text not null
);
create table public.attachment_partitions (
  code text primary key
);
create table public.attachments (
  id uuid primary key,
  organization_id uuid references public.organizations(id),
  tenant_id uuid,
  entity_id text,
  record_id text,
  partition_code text not null references public.attachment_partitions(code),
  storage_path text not null,
  storage_driver text
);
create table public.contact_attachments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null,
  filename text not null,
  uploaded_by uuid
);
create table public.user_content (
  id uuid primary key,
  organization_id uuid references public.organizations(id),
  tenant_id uuid,
  created_by_user_id uuid not null,
  body text not null
);
create table public.user_assignments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  tenant_id uuid not null,
  assigned_to uuid,
  body text not null
);
create table public.user_owned_resources (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  tenant_id uuid not null,
  owner_id uuid not null references public.users(id),
  body text not null
);
create table public.vector_search (
  id uuid primary key,
  organization_id uuid,
  tenant_id uuid,
  record_id text not null
);
create table public.entity_indexes (
  id uuid primary key,
  organization_id uuid,
  tenant_id uuid,
  entity_id text not null,
  doc jsonb not null
);
create table public.search_tokens (
  id uuid primary key,
  organization_id uuid,
  tenant_id uuid,
  entity_id text not null,
  field text not null,
  token_hash text not null,
  token text
);
create table public.indexer_error_logs (
  id uuid primary key,
  organization_id uuid,
  tenant_id uuid,
  record_id text,
  payload jsonb
);
create table public.indexer_status_logs (
  id uuid primary key,
  organization_id uuid,
  tenant_id uuid,
  record_id text,
  details jsonb
);
create table public.gdpr_user_search_subjects (
  operation_id uuid not null,
  noli_user_id text not null,
  tenant_id uuid not null,
  organization_id uuid,
  record_id text not null,
  created_at timestamptz not null default now(),
  primary key (operation_id, tenant_id, record_id)
);
insert into public.gdpr_user_search_subjects (
  operation_id,
  noli_user_id,
  tenant_id,
  organization_id,
  record_id
) values (
  '60000000-0000-4000-8000-000000000050',
  '50000000-0000-4000-8000-000000000050',
  '30000000-0000-4000-8000-000000000050',
  null,
  '90000000-0000-4000-8000-000000000050'
);
create table public.progress_jobs (
  id uuid primary key,
  organization_id uuid references public.organizations(id),
  status text not null
);
SQL

emit_migration() {
  (
    cd "$ROOT_DIR"
    node --import tsx --input-type=module -e '
      import { Migration20260722030000 } from "./packages/core/src/modules/auth/migrations/Migration20260722030000.ts";
      const migration = Object.create(Migration20260722030000.prototype);
      migration.addSql = (sql) => process.stdout.write(`${sql}\n`);
      await migration.up();
    '
  )
}

emit_migration_down() {
  (
    cd "$ROOT_DIR"
    node --import tsx --input-type=module -e '
      import { Migration20260722030000 } from "./packages/core/src/modules/auth/migrations/Migration20260722030000.ts";
      const migration = Object.create(Migration20260722030000.prototype);
      migration.addSql = (sql) => process.stdout.write(`${sql}\n`);
      await migration.down();
    '
  )
}

emit_migration | "${PSQL[@]}" >/dev/null
emit_migration | "${PSQL[@]}" >/dev/null

"${PSQL[@]}" >/dev/null <<'SQL'
do $$
begin
  if (
    select tenant_scope
      from public.gdpr_user_search_subjects
     where operation_id = '60000000-0000-4000-8000-000000000050'
  ) <> '30000000-0000-4000-8000-000000000050' then
    raise exception 'legacy search tombstone tenant scope was not backfilled';
  end if;
  if (
    select is_nullable
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'gdpr_user_search_subjects'
       and column_name = 'tenant_id'
  ) <> 'YES' then
    raise exception 'search tombstone tenant id did not become nullable';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_constraint as constraints
      join pg_catalog.pg_attribute as attributes
        on attributes.attrelid = constraints.conrelid
       and attributes.attnum = any(constraints.conkey)
     where constraints.conrelid = 'public.gdpr_user_search_subjects'::regclass
       and constraints.contype = 'p'
       and attributes.attname = 'tenant_scope'
  ) then
    raise exception 'search tombstone primary key did not adopt tenant scope';
  end if;
end;
$$;
SQL

"${PSQL[@]}" >/dev/null <<'SQL'
insert into public.organizations (id, noli_org_id, tenant_id) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003');

insert into public.users (
  id, organization_id, email, email_hash, clerk_user_id
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  ' person@example.com ',
  'email-hash-one',
  'clerk-one'
);

select public.crm_gdpr_begin_user_erasure(
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'email-hash-one',
  'clerk-one'
);
select public.crm_gdpr_begin_user_erasure(
  '40000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'email-hash-one',
  'clerk-one'
);
select public.crm_gdpr_record_user_subject(
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

do $$
begin
  begin
    insert into public.users (
      id, organization_id, email, email_hash, clerk_user_id
    ) values (
      '40000000-0000-4000-8000-000000000009',
      '10000000-0000-4000-8000-000000000001',
      'person@example.com',
      'email-hash-one',
      'clerk-other'
    );
    raise exception 'identity fence accepted a replacement user';
  exception when others then
    if sqlerrm = 'identity fence accepted a replacement user' then raise; end if;
  end;
end;
$$;

do $$
declare bound_count bigint;
begin
  select count(*) into bound_count
    from public.crm_gdpr_user_subjects(
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001'
    );
  if bound_count <> 1 then raise exception 'durable user subject proof failed'; end if;
end;
$$;

insert into public.users (
  id, organization_id, tenant_id, email, email_hash, clerk_user_id
) values (
  '40000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'lease-holder@example.com',
  'lease-holder-hash',
  'clerk-lease-holder'
);

do $$
declare acquired boolean;
begin
  select public.crm_gdpr_acquire_user_write_lease(
    '40000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000010',
    'processor'
  ) into acquired;
  if acquired is not true then raise exception 'user processor lease was not acquired'; end if;
end;
$$;

select public.crm_gdpr_begin_user_erasure(
  '40000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000002',
  null,
  null
);
update public.gdpr_user_write_leases
   set created_at = '2000-01-01T00:00:00Z'
 where lease_id = '70000000-0000-4000-8000-000000000010';

do $$
declare active_count bigint;
declare blocked boolean;
begin
  select public.crm_gdpr_active_user_write_leases(
    '40000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',
    array['40000000-0000-4000-8000-000000000002']::uuid[]
  ) into active_count;
  if active_count <> 1 then
    raise exception 'old but unreleased user lease stopped blocking completion';
  end if;
  select public.crm_gdpr_acquire_user_write_lease(
    '40000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000011',
    'processor'
  ) into blocked;
  if blocked is not false then raise exception 'deleting user accepted a processor lease'; end if;
end;
$$;

select public.crm_gdpr_release_user_write_lease(
  '40000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000010',
  'processor'
);

insert into public.users (
  id, organization_id, tenant_id, email, email_hash, clerk_user_id
) values (
  '40000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000003',
  'realtime-holder@example.com',
  'realtime-holder-hash',
  'clerk-realtime-holder'
);

select public.crm_gdpr_acquire_local_write_lease(
  '10000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000030',
  'processor'
);
select public.crm_gdpr_acquire_user_write_lease(
  '40000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000031',
  'processor'
);

do $$
declare receipt jsonb;
begin
  select public.crm_gdpr_create_external_processor_grant(
    '10000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000030',
    '70000000-0000-4000-8000-000000000031',
    '71000000-0000-4000-8000-000000000030',
    'openai',
    'realtime-voice',
    '71000000-0000-4000-8000-000000000030',
    3900
  ) into receipt;
  if receipt->>'grantId' <> '71000000-0000-4000-8000-000000000030'
     or receipt->>'organizationId' <> '10000000-0000-4000-8000-000000000003'
     or receipt->>'localUserId' <> '40000000-0000-4000-8000-000000000003'
     or receipt->>'noliOrgId' <> '20000000-0000-4000-8000-000000000003'
     or receipt->>'provider' <> 'openai'
     or receipt->>'purpose' <> 'realtime-voice' then
    raise exception 'external processor grant receipt was not exact';
  end if;
  if (
    select external_binding_sha256
      from public.gdpr_external_processor_grants
     where grant_id = '71000000-0000-4000-8000-000000000030'
  ) <> encode(sha256(convert_to('71000000-0000-4000-8000-000000000030', 'UTF8')), 'hex') then
    raise exception 'external processor grant did not hash its provider binding';
  end if;
end;
$$;

select public.crm_gdpr_release_user_write_lease(
  '40000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000031',
  'processor'
);
select public.crm_gdpr_release_local_write_lease(
  '10000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000030',
  'processor'
);
select public.crm_gdpr_begin_user_erasure(
  '40000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000030',
  null,
  null
);
select public.crm_gdpr_begin_erasure(
  'organization',
  '20000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000030'
);

do $$
declare user_count bigint;
declare organization_count bigint;
begin
  select public.crm_gdpr_active_user_write_leases(
    '40000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000030',
    array['40000000-0000-4000-8000-000000000003']::uuid[]
  ) into user_count;
  select public.crm_gdpr_active_local_write_leases(
    '20000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000030'
  ) into organization_count;
  if user_count <> 1 or organization_count <> 1 then
    raise exception 'live external processor grant did not block both erasure scopes';
  end if;
end;
$$;

begin;
select set_config('noli.gdpr_operation_id', '61000000-0000-4000-8000-000000000030', true);
update public.gdpr_external_processor_grants
   set created_at = '2000-01-01T00:00:00Z',
       expires_at = '2000-01-01T01:05:00Z'
 where grant_id = '71000000-0000-4000-8000-000000000030';
commit;

do $$
declare user_count bigint;
declare organization_count bigint;
begin
  select public.crm_gdpr_active_user_write_leases(
    '40000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000030',
    array['40000000-0000-4000-8000-000000000003']::uuid[]
  ) into user_count;
  select public.crm_gdpr_active_local_write_leases(
    '20000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000030'
  ) into organization_count;
  if user_count <> 0 or organization_count <> 0 then
    raise exception 'expired external processor grant remained active';
  end if;
end;
$$;

begin;
select set_config('noli.gdpr_operation_id', '61000000-0000-4000-8000-000000000030', true);
delete from public.gdpr_external_processor_grants
 where grant_id = '71000000-0000-4000-8000-000000000030'
   and expires_at <= now();
commit;

do $$
begin
  if exists (
    select 1 from public.gdpr_external_processor_grants
     where grant_id = '71000000-0000-4000-8000-000000000030'
  ) then
    raise exception 'expired external processor grant was not physically cleaned';
  end if;
end;
$$;

do $$
declare acquired text;
begin
  select public.crm_gdpr_acquire_local_write_lease(
    '10000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    'storage'
  ) into acquired;
  if acquired <> '20000000-0000-4000-8000-000000000002' then
    raise exception 'local-write lease binding failed';
  end if;
end;
$$;

select public.crm_gdpr_begin_erasure(
  'organization',
  '20000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000001'
);
update public.gdpr_local_write_leases
   set created_at = '2000-01-01T00:00:00Z'
 where lease_id = '70000000-0000-4000-8000-000000000001';

do $$
declare active_count bigint;
declare blocked text;
begin
  select public.crm_gdpr_active_local_write_leases(
    '20000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000001'
  ) into active_count;
  if active_count <> 1 then raise exception 'active lease was not drained'; end if;

  select public.crm_gdpr_acquire_local_write_lease(
    '10000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002',
    'storage'
  ) into blocked;
  if blocked is not null then raise exception 'deleting organization accepted a new lease'; end if;

  begin
    insert into public.org_content (id, organization_id, body) values (
      '90000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'late write'
    );
    raise exception 'deleting organization accepted an ordinary write';
  exception when others then
    if sqlerrm = 'deleting organization accepted an ordinary write' then raise; end if;
  end;
end;
$$;

do $$
declare released boolean;
declare active_count bigint;
begin
  select public.crm_gdpr_release_local_write_lease(
    '10000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'storage'
  ) into released;
  if released is not false then raise exception 'mismatched organization release was acknowledged'; end if;
  select public.crm_gdpr_active_local_write_leases(
    '20000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000001'
  ) into active_count;
  if active_count <> 1 then raise exception 'old or mismatched organization lease stopped blocking'; end if;
end;
$$;

select public.crm_gdpr_release_local_write_lease(
  '10000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  'storage'
);

do $$
declare active_count bigint;
begin
  select public.crm_gdpr_active_local_write_leases(
    '20000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000001'
  ) into active_count;
  if active_count <> 0 then raise exception 'released lease remained active'; end if;
end;
$$;

begin;
select set_config('noli.gdpr_operation_id', '80000000-0000-4000-8000-000000000001', true);
insert into public.org_content (id, organization_id, body) values (
  '90000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'operation-bound cleanup'
);
delete from public.org_content
 where organization_id = '10000000-0000-4000-8000-000000000002';
commit;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger as triggers
      join pg_catalog.pg_class as classes on classes.oid = triggers.tgrelid
     where classes.relname = 'org_content'
       and triggers.tgname = 'crm_gdpr_guard_org_scoped_write'
       and triggers.tgenabled <> 'D'
  ) then
    raise exception 'organization writer trigger coverage failed';
  end if;
end;
$$;
SQL

(
cd "$ROOT_DIR"
CRM_GDPR_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/gdpr_test" \
CRM_GDPR_RUNTIME_ROOT="$TMP_DIR/runtime" \
  node --import tsx --input-type=module >/dev/null <<'NODE'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'node:crypto'
import knexFactory from 'knex'
import {
  deleteOrganizationPhase,
  deleteUserPhase,
} from './apps/mercato/src/modules/integrations_api/api/internal/gdpr-delete/route.ts'
import { withGdprQueueExecutionLeases } from './packages/cli/src/mercato.ts'
import { tryWithGdprUserSearchWriteLease } from './packages/search/src/lib/gdpr-local-write-lease.ts'

const database = knexFactory({
  client: 'pg',
  connection: {
    connectionString: process.env.CRM_GDPR_DATABASE_URL,
    application_name: 'crm_gdpr_eraser',
  },
})
const writerDatabase = knexFactory({
  client: 'pg',
  connection: {
    connectionString: process.env.CRM_GDPR_DATABASE_URL,
    application_name: 'crm_gdpr_delayed_writer',
  },
})
const runtimeRoot = process.env.CRM_GDPR_RUNTIME_ROOT
if (!runtimeRoot) throw new Error('missing runtime root')
await fs.mkdir(runtimeRoot, { recursive: true })
process.chdir(runtimeRoot)
delete process.env.MEILISEARCH_HOST
process.env.CRM_GDPR_MEILISEARCH_DISABLED = 'true'

let releaseConcurrentWriter
let concurrentWriterStarted
const concurrentWriterReady = new Promise((resolve) => { concurrentWriterStarted = resolve })
const concurrentWriterRelease = new Promise((resolve) => { releaseConcurrentWriter = resolve })
const heldWriter = writerDatabase.transaction(async (transaction) => {
  await transaction('org_content').insert({
    id: '90000000-0000-4000-8000-000000000051',
    organization_id: '10000000-0000-4000-8000-000000000001',
    body: 'shared writer one',
  })
  concurrentWriterStarted()
  await concurrentWriterRelease
})
await concurrentWriterReady
const parallelWriter = database('org_content').insert({
  id: '90000000-0000-4000-8000-000000000052',
  organization_id: '10000000-0000-4000-8000-000000000001',
  body: 'shared writer two',
}).then(() => undefined)
const writersRemainConcurrent = await Promise.race([
  parallelWriter.then(() => true),
  new Promise((resolve) => setTimeout(() => resolve(false), 500)),
])
releaseConcurrentWriter()
await heldWriter
await parallelWriter
if (!writersRemainConcurrent) {
  throw new Error('ordinary organization writes were serialized by the GDPR fence')
}
await database('org_content')
  .whereIn('id', [
    '90000000-0000-4000-8000-000000000051',
    '90000000-0000-4000-8000-000000000052',
  ])
  .del()

const externalSearchRaceRecordId = '90000000-0000-4000-8000-000000000057'
let releaseExternalSearchResolve
const releaseExternalSearch = new Promise((resolve) => {
  releaseExternalSearchResolve = resolve
})
let externalSearchStartedResolve
const externalSearchStarted = new Promise((resolve) => {
  externalSearchStartedResolve = resolve
})
const heldExternalSearch = tryWithGdprUserSearchWriteLease(
  writerDatabase,
  '30000000-0000-4000-8000-000000000001',
  externalSearchRaceRecordId,
  async () => {
    externalSearchStartedResolve()
    await releaseExternalSearch
  },
)
await externalSearchStarted
const externalSearchTombstoneInsert = database('gdpr_user_search_subjects')
  .insert({
    operation_id: '60000000-0000-4000-8000-000000000057',
    noli_user_id: '50000000-0000-4000-8000-000000000057',
    tenant_id: '30000000-0000-4000-8000-000000000001',
    tenant_scope: '30000000-0000-4000-8000-000000000001',
    organization_id: '10000000-0000-4000-8000-000000000001',
    record_id: externalSearchRaceRecordId,
  })
  .then(
    () => ({ completed: true, error: null }),
    (error) => ({ completed: true, error }),
  )
const externalSearchTombstoneWaited = await Promise.race([
  externalSearchTombstoneInsert.then(() => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 300)),
])
if (!externalSearchTombstoneWaited) {
  releaseExternalSearchResolve()
  await heldExternalSearch
  throw new Error('user search tombstone did not wait for an in-flight external index write')
}
releaseExternalSearchResolve()
const heldExternalSearchResult = await heldExternalSearch
if (!heldExternalSearchResult.executed) {
  throw new Error('unfenced external search write was unexpectedly suppressed')
}
const externalSearchTombstoneResult = await externalSearchTombstoneInsert
if (externalSearchTombstoneResult.error) throw externalSearchTombstoneResult.error

const searchRaceRecordId = '90000000-0000-4000-8000-000000000053'
let releaseSearchWriterResolve
const releaseSearchWriter = new Promise((resolve) => { releaseSearchWriterResolve = resolve })
let searchWriterStartedResolve
const searchWriterStarted = new Promise((resolve) => { searchWriterStartedResolve = resolve })
const heldSearchWriter = writerDatabase.transaction(async (transaction) => {
  await transaction('entity_indexes').insert({
    id: '90000000-0000-4000-8000-000000000054',
    organization_id: '10000000-0000-4000-8000-000000000001',
    tenant_id: '30000000-0000-4000-8000-000000000001',
    entity_id: searchRaceRecordId,
    doc: { personal: 'in-flight index write' },
  })
  searchWriterStartedResolve()
  await releaseSearchWriter
})
await searchWriterStarted
const searchTombstoneInsert = database('gdpr_user_search_subjects')
  .insert({
    operation_id: '60000000-0000-4000-8000-000000000053',
    noli_user_id: '50000000-0000-4000-8000-000000000053',
    tenant_id: '30000000-0000-4000-8000-000000000001',
    tenant_scope: '30000000-0000-4000-8000-000000000001',
    organization_id: '10000000-0000-4000-8000-000000000001',
    record_id: searchRaceRecordId,
  })
  .then(
    () => ({ completed: true, error: null }),
    (error) => ({ completed: true, error }),
  )
const searchTombstoneWaited = await Promise.race([
  searchTombstoneInsert.then(() => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 300)),
])
if (!searchTombstoneWaited) {
  releaseSearchWriterResolve()
  await heldSearchWriter
  throw new Error('user search tombstone did not wait for an in-flight index writer')
}
releaseSearchWriterResolve()
await heldSearchWriter
const searchTombstoneResult = await searchTombstoneInsert
if (searchTombstoneResult.error) throw searchTombstoneResult.error

const unscopedRaceRecordId = '90000000-0000-4000-8000-000000000055'
let releaseUnscopedSearchWriterResolve
const releaseUnscopedSearchWriter = new Promise((resolve) => {
  releaseUnscopedSearchWriterResolve = resolve
})
let unscopedSearchWriterStartedResolve
const unscopedSearchWriterStarted = new Promise((resolve) => {
  unscopedSearchWriterStartedResolve = resolve
})
const heldUnscopedSearchWriter = writerDatabase.transaction(async (transaction) => {
  await transaction('entity_indexes').insert({
    id: '90000000-0000-4000-8000-000000000056',
    organization_id: null,
    tenant_id: null,
    entity_id: unscopedRaceRecordId,
    doc: { personal: 'in-flight unscoped index write' },
  })
  unscopedSearchWriterStartedResolve()
  await releaseUnscopedSearchWriter
})
await unscopedSearchWriterStarted
const unscopedSearchTombstoneInsert = database('gdpr_user_search_subjects')
  .insert({
    operation_id: '60000000-0000-4000-8000-000000000055',
    noli_user_id: '50000000-0000-4000-8000-000000000055',
    tenant_id: null,
    tenant_scope: '*',
    organization_id: null,
    record_id: unscopedRaceRecordId,
  })
  .then(
    () => ({ completed: true, error: null }),
    (error) => ({ completed: true, error }),
  )
const unscopedSearchTombstoneWaited = await Promise.race([
  unscopedSearchTombstoneInsert.then(() => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 300)),
])
if (!unscopedSearchTombstoneWaited) {
  releaseUnscopedSearchWriterResolve()
  await heldUnscopedSearchWriter
  throw new Error('unscoped search tombstone did not wait for an in-flight index writer')
}
releaseUnscopedSearchWriterResolve()
await heldUnscopedSearchWriter
const unscopedSearchTombstoneResult = await unscopedSearchTombstoneInsert
if (unscopedSearchTombstoneResult.error) throw unscopedSearchTombstoneResult.error

const missingOrganizationRequest = {
  contract: 'noli-gdpr-delete-v2',
  operationId: '80000000-0000-4000-8000-000000000099',
  app: 'crm',
  phase: 'organization',
  noliUserId: '50000000-0000-4000-8000-000000000099',
  noliOrgId: '20000000-0000-4000-8000-000000000099',
  email: null,
  clerkUserId: null,
}
const missingOrganizationResponse = await deleteOrganizationPhase(
  database,
  missingOrganizationRequest,
)
const missingOrganizationResult = await missingOrganizationResponse.json()
if (
  missingOrganizationResponse.status !== 409
  || !missingOrganizationResult.failures.includes('organization_receipt_missing')
) {
  throw new Error('an unbound organization incorrectly acknowledged completion')
}

const missingUserRequest = {
  contract: 'noli-gdpr-delete-v2',
  operationId: '60000000-0000-4000-8000-000000000099',
  app: 'crm',
  phase: 'user',
  noliUserId: '50000000-0000-4000-8000-000000000099',
  noliOrgId: null,
  email: 'never-provisioned@example.com',
  clerkUserId: null,
}
const missingUserResponse = await deleteUserPhase(database, missingUserRequest)
const missingUserResult = await missingUserResponse.json()
if (
  missingUserResponse.status !== 409
  || missingUserResult.complete !== false
  || !missingUserResult.failures.includes('user_subject_receipt_missing')
) {
  throw new Error('an unbound user incorrectly acknowledged completion')
}

const userOrganizationId = '10000000-0000-4000-8000-000000000004'
const userNoliOrgId = '20000000-0000-4000-8000-000000000004'
const userTenantId = '30000000-0000-4000-8000-000000000004'
const userId = '40000000-0000-4000-8000-000000000004'
const userOperationId = '60000000-0000-4000-8000-000000000004'
const userEmail = 'person-four@example.com'
const userClerkId = 'clerk-person-four'
const legacyUnscopedUserId = '40000000-0000-4000-8000-000000000049'
const legacyOrganizationTenantUserId = '40000000-0000-4000-8000-00000000004a'
const userAttachmentId = '90000000-0000-4000-8000-000000000041'
const sharedAttachmentId = '90000000-0000-4000-8000-000000000040'
const collaboratorId = '40000000-0000-4000-8000-000000000040'
const contactAttachmentId = '90000000-0000-4000-8000-000000000042'
const contactId = '90000000-0000-4000-8000-000000000043'
const contentId = '90000000-0000-4000-8000-000000000044'
const unscopedContentId = '90000000-0000-4000-8000-000000000049'
const assignmentId = '90000000-0000-4000-8000-000000000045'
const delayedContentId = '90000000-0000-4000-8000-000000000046'
const ownedResourceId = '90000000-0000-4000-8000-000000000048'
const userLandingFileId = '90000000-0000-4000-8000-00000000004a'
const collaboratorLandingFileId = '90000000-0000-4000-8000-00000000004b'
const userStoragePath = `org_${userOrganizationId}/tenant_${userTenantId}/user-proof.txt`
const sharedStoragePath = `org_${userOrganizationId}/tenant_${userTenantId}/shared-proof.txt`
const userLandingRelativePath = path.join(
  'uploads',
  'page-images',
  userOrganizationId,
  '90000000-0000-4000-8000-00000000004c',
  'user-image.png',
)
const collaboratorLandingRelativePath = path.join(
  'uploads',
  'page-images',
  userOrganizationId,
  '90000000-0000-4000-8000-00000000004d',
  'collaborator-image.png',
)

await database('organizations').insert({
  id: userOrganizationId,
  noli_org_id: userNoliOrgId,
  tenant_id: userTenantId,
})
await database('users').insert({
  id: userId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  email: userEmail,
  email_hash: crypto.createHash('sha256').update(userEmail).digest('hex'),
  clerk_user_id: userClerkId,
})
await database('users').insert({
  id: legacyUnscopedUserId,
  organization_id: null,
  tenant_id: null,
  email: userEmail,
  email_hash: crypto.createHash('sha256').update(userEmail).digest('hex'),
  clerk_user_id: null,
})
await database('users').insert({
  id: legacyOrganizationTenantUserId,
  organization_id: userOrganizationId,
  tenant_id: null,
  email: userEmail,
  email_hash: crypto.createHash('sha256').update(userEmail).digest('hex'),
  clerk_user_id: null,
})
await database('users').insert({
  id: collaboratorId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  email: 'collaborator@example.com',
  email_hash: crypto.createHash('sha256').update('collaborator@example.com').digest('hex'),
  clerk_user_id: 'clerk-collaborator',
})
await database('attachment_partitions').insert({ code: 'test' }).onConflict('code').ignore()
await database('user_content').insert({
  id: contentId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  created_by_user_id: userId,
  body: 'erase authored content',
})
await database('user_content').insert({
  id: unscopedContentId,
  organization_id: null,
  tenant_id: null,
  created_by_user_id: userId,
  body: 'erase unscoped authored content',
})
await database('user_assignments').insert({
  id: assignmentId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  assigned_to: userId,
  body: 'retain after redaction',
})
await database('user_owned_resources').insert({
  id: ownedResourceId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  owner_id: userId,
  body: 'erase foreign-key-discovered ownership',
})
await database('attachments').insert({
  id: userAttachmentId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  entity_id: 'messages:message',
  record_id: contentId,
  partition_code: 'test',
  storage_path: userStoragePath,
  storage_driver: 'local',
  uploaded_by_user_id: userId,
})
await database('attachments').insert({
  id: sharedAttachmentId,
  organization_id: userOrganizationId,
  tenant_id: userTenantId,
  entity_id: 'customers:user-content',
  record_id: contentId,
  partition_code: 'test',
  storage_path: sharedStoragePath,
  storage_driver: 'local',
  uploaded_by_user_id: collaboratorId,
})
await database('contact_attachments').insert({
  id: contactAttachmentId,
  organization_id: userOrganizationId,
  contact_id: contactId,
  filename: 'private.txt',
  uploaded_by: userId,
})
await database('gdpr_user_local_files').insert([
  {
    id: userLandingFileId,
    local_user_id: userId,
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    relative_path: userLandingRelativePath,
  },
  {
    id: collaboratorLandingFileId,
    local_user_id: collaboratorId,
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    relative_path: collaboratorLandingRelativePath,
  },
])
for (const recordId of [
  userId,
  legacyOrganizationTenantUserId,
  contentId,
  assignmentId,
  userAttachmentId,
  sharedAttachmentId,
]) {
  await database('vector_search').insert({
    id: crypto.randomUUID(),
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    record_id: recordId,
  })
  await database('entity_indexes').insert({
    id: crypto.randomUUID(),
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    entity_id: recordId,
    doc: { personal: `indexed ${recordId}` },
  })
  await database('search_tokens').insert({
    id: crypto.randomUUID(),
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    entity_id: recordId,
    field: 'name',
    token_hash: crypto.createHash('sha256').update(recordId).digest('hex'),
    token: `token-${recordId}`,
  })
  await database('indexer_error_logs').insert({
    id: crypto.randomUUID(),
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    record_id: recordId,
    payload: { personal: `failed ${recordId}` },
  })
  await database('indexer_status_logs').insert({
    id: crypto.randomUUID(),
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    record_id: recordId,
    details: { personal: `status ${recordId}` },
  })
}
await database('vector_search').insert({
  id: crypto.randomUUID(),
  organization_id: null,
  tenant_id: null,
  record_id: unscopedContentId,
})
await database('entity_indexes').insert({
  id: crypto.randomUUID(),
  organization_id: null,
  tenant_id: null,
  entity_id: unscopedContentId,
  doc: { personal: 'unscoped index residue' },
})
await database('search_tokens').insert({
  id: crypto.randomUUID(),
  organization_id: null,
  tenant_id: null,
  entity_id: unscopedContentId,
  field: 'name',
  token_hash: crypto.createHash('sha256').update(unscopedContentId).digest('hex'),
  token: 'unscoped-token',
})
await database('indexer_error_logs').insert({
  id: crypto.randomUUID(),
  organization_id: null,
  tenant_id: null,
  record_id: unscopedContentId,
  payload: { personal: 'unscoped failed index' },
})
await database('indexer_status_logs').insert({
  id: crypto.randomUUID(),
  organization_id: null,
  tenant_id: null,
  record_id: unscopedContentId,
  details: { personal: 'unscoped index status' },
})
for (const [tableName, recordColumn, extra] of [
  ['vector_search', 'record_id', {}],
  ['entity_indexes', 'entity_id', { doc: { personal: 'legacy unscoped user index' } }],
  [
    'search_tokens',
    'entity_id',
    {
      field: 'name',
      token_hash: crypto.createHash('sha256').update(legacyUnscopedUserId).digest('hex'),
      token: 'legacy-unscoped-user-token',
    },
  ],
  ['indexer_error_logs', 'record_id', { payload: { personal: 'legacy unscoped user error' } }],
  ['indexer_status_logs', 'record_id', { details: { personal: 'legacy unscoped user status' } }],
]) {
  await database(tableName).insert({
    id: crypto.randomUUID(),
    organization_id: null,
    tenant_id: null,
    [recordColumn]: legacyUnscopedUserId,
    ...extra,
  })
}

const userStorageFile = path.join(
  runtimeRoot,
  'storage',
  'attachments',
  'test',
  userStoragePath,
)
const userContactFile = path.join(
  runtimeRoot,
  'uploads',
  'attachments',
  userOrganizationId,
  contactId,
  `${contactAttachmentId}-private.txt`,
)
const sharedStorageFile = path.join(
  runtimeRoot,
  'storage',
  'attachments',
  'test',
  sharedStoragePath,
)
const userLandingFile = path.join(runtimeRoot, userLandingRelativePath)
const collaboratorLandingFile = path.join(runtimeRoot, collaboratorLandingRelativePath)
for (const file of [
  userStorageFile,
  sharedStorageFile,
  userContactFile,
  userLandingFile,
  collaboratorLandingFile,
]) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'user personal data')
}
const userQueueFile = path.join(runtimeRoot, '.mercato', 'queue', 'user-proof', 'queue.json')
await fs.mkdir(path.dirname(userQueueFile), { recursive: true })
await fs.writeFile(userQueueFile, JSON.stringify([{
  id: 'queued-user-proof',
  payload: { userId },
}]))

let processorStartedResolve
const processorStarted = new Promise((resolve) => { processorStartedResolve = resolve })
let releaseProcessorResolve
const releaseProcessor = new Promise((resolve) => { releaseProcessorResolve = resolve })
const processor = withGdprQueueExecutionLeases(
  { resolve: () => ({ getKnex: () => database }) },
  { payload: { organizationId: userOrganizationId, userId } },
  async () => {
    processorStartedResolve()
    await releaseProcessor
  },
)
await processorStarted

let writerInsertedResolve
const writerInserted = new Promise((resolve) => { writerInsertedResolve = resolve })
let releaseWriterResolve
const releaseWriter = new Promise((resolve) => { releaseWriterResolve = resolve })
const writerTransaction = writerDatabase.transaction(async (transaction) => {
  await transaction('user_content').insert({
    id: delayedContentId,
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    created_by_user_id: userId,
    body: 'committed after delete began waiting',
  })
  writerInsertedResolve()
  await releaseWriter
})
await writerInserted

const userRequest = {
  contract: 'noli-gdpr-delete-v2',
  operationId: userOperationId,
  app: 'crm',
  phase: 'user',
  noliUserId: userId,
  noliOrgId: userNoliOrgId,
  email: userEmail,
  clerkUserId: userClerkId,
}
const firstUserDelete = deleteUserPhase(database, userRequest)
let observedLock = false
for (let attempt = 0; attempt < 100; attempt += 1) {
  const lock = await database('pg_catalog.pg_stat_activity')
    .where({ application_name: 'crm_gdpr_eraser', wait_event_type: 'Lock' })
    .count({ count: '*' })
    .first()
  if (Number(lock?.count ?? 0) > 0) {
    observedLock = true
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
}
if (!observedLock) throw new Error('user erasure did not wait for the delayed writer lock')
releaseWriterResolve()
await writerTransaction
const firstUserResponse = await firstUserDelete
const firstUserResult = await firstUserResponse.json()
if (
  firstUserResponse.status !== 409
  || !firstUserResult.failures.includes('user_writes_in_flight')
) {
  throw new Error(`active user processor did not block purge: ${JSON.stringify(firstUserResult)}`)
}
for (const file of [
  userStorageFile,
  sharedStorageFile,
  userContactFile,
  userLandingFile,
  collaboratorLandingFile,
]) await fs.lstat(file)
releaseProcessorResolve()
await processor

const queuedUserResponse = await deleteUserPhase(database, userRequest)
const queuedUserResult = await queuedUserResponse.json()
if (
  queuedUserResponse.status !== 409
  || !queuedUserResult.failures.includes('local_queue_job:user-proof')
) {
  throw new Error(`queued user work did not block purge: ${JSON.stringify(queuedUserResult)}`)
}
for (const file of [
  userStorageFile,
  sharedStorageFile,
  userContactFile,
  userLandingFile,
  collaboratorLandingFile,
]) await fs.lstat(file)
await fs.writeFile(userQueueFile, '[]')

const untrackedLandingFile = path.join(
  runtimeRoot,
  'uploads',
  'page-images',
  userOrganizationId,
  'legacy-page',
  'untracked.png',
)
await fs.mkdir(path.dirname(untrackedLandingFile), { recursive: true })
await fs.writeFile(untrackedLandingFile, 'legacy image without uploader attribution')
try {
  await deleteUserPhase(database, userRequest)
  throw new Error('untracked landing image ownership was acknowledged')
} catch (error) {
  if (
    !(error instanceof Error)
    || !error.message.includes('landing image ownership proof found untracked files')
  ) throw error
}
await fs.rm(untrackedLandingFile, { force: true })

const userResponse = await deleteUserPhase(database, userRequest)
const userResult = await userResponse.json()
if (userResponse.status !== 200 || userResult.complete !== true) {
  throw new Error(`user purge did not complete: ${JSON.stringify(userResult)}`)
}
for (const file of [userStorageFile, sharedStorageFile, userContactFile, userLandingFile]) {
  try {
    await fs.lstat(file)
    throw new Error(`local file survived user purge: ${file}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('local file survived')) throw error
  }
}
await fs.lstat(collaboratorLandingFile)
const userCount = await database('users').where('id', userId).count({ count: '*' }).first()
if (Number(userCount?.count ?? 0) !== 0) throw new Error('users retained the target row')
const legacyUnscopedUserCount = await database('users')
  .where('id', legacyUnscopedUserId)
  .count({ count: '*' })
  .first()
if (Number(legacyUnscopedUserCount?.count ?? 0) !== 0) {
  throw new Error('users retained the legacy unscoped identity row')
}
const legacyOrganizationTenantUserCount = await database('users')
  .where('id', legacyOrganizationTenantUserId)
  .count({ count: '*' })
  .first()
if (Number(legacyOrganizationTenantUserCount?.count ?? 0) !== 0) {
  throw new Error('users retained the legacy organization-tenant identity row')
}
const collaboratorCount = await database('users')
  .where('id', collaboratorId)
  .count({ count: '*' })
  .first()
if (Number(collaboratorCount?.count ?? 0) !== 1) {
  throw new Error('user purge removed an unrelated collaborator')
}
const sharedAttachmentCount = await database('attachments')
  .where('id', sharedAttachmentId)
  .count({ count: '*' })
  .first()
if (Number(sharedAttachmentCount?.count ?? 0) !== 0) {
  throw new Error('attachment to deleted user content survived purge')
}
const contentCount = await database('user_content')
  .whereIn('id', [contentId, delayedContentId, unscopedContentId])
  .count({ count: '*' })
  .first()
if (Number(contentCount?.count ?? 0) !== 0) throw new Error('authored rows survived user purge')
const assignment = await database('user_assignments').where('id', assignmentId).first()
if (!assignment || assignment.assigned_to !== null) {
  throw new Error('nullable user assignment was not retained and redacted')
}
const ownedResourceCount = await database('user_owned_resources')
  .where('id', ownedResourceId)
  .count({ count: '*' })
  .first()
if (Number(ownedResourceCount?.count ?? 0) !== 0) {
  throw new Error('foreign-key-discovered user ownership survived purge')
}
const vectorCount = await database('vector_search')
  .where('tenant_id', userTenantId)
  .whereIn('record_id', [
    userId,
    contentId,
    assignmentId,
    userAttachmentId,
    sharedAttachmentId,
    delayedContentId,
  ])
  .count({ count: '*' })
  .first()
if (Number(vectorCount?.count ?? 0) !== 0) throw new Error('vector user documents survived purge')
for (const [tableName, recordColumn] of [
  ['entity_indexes', 'entity_id'],
  ['search_tokens', 'entity_id'],
  ['indexer_error_logs', 'record_id'],
  ['indexer_status_logs', 'record_id'],
]) {
  const retained = await database(tableName)
    .where('tenant_id', userTenantId)
    .whereIn(recordColumn, [
      userId,
      legacyOrganizationTenantUserId,
      contentId,
      assignmentId,
      userAttachmentId,
      sharedAttachmentId,
      delayedContentId,
    ])
    .count({ count: '*' })
    .first()
  if (Number(retained?.count ?? 0) !== 0) {
    throw new Error(`${tableName} retained user search material`)
  }
}
for (const [tableName, recordColumn] of [
  ['vector_search', 'record_id'],
  ['entity_indexes', 'entity_id'],
  ['search_tokens', 'entity_id'],
  ['indexer_error_logs', 'record_id'],
  ['indexer_status_logs', 'record_id'],
]) {
  const retained = await database(tableName)
    .whereNull('tenant_id')
    .whereIn(recordColumn, [unscopedContentId, legacyUnscopedUserId])
    .count({ count: '*' })
    .first()
  if (Number(retained?.count ?? 0) !== 0) {
    throw new Error(`${tableName} retained unscoped user search material`)
  }
}
const userLandingManifestCount = await database('gdpr_user_local_files')
  .where('id', userLandingFileId)
  .count({ count: '*' })
  .first()
if (Number(userLandingManifestCount?.count ?? 0) !== 0) {
  throw new Error('user landing image manifest survived purge')
}
const collaboratorLandingManifestCount = await database('gdpr_user_local_files')
  .where('id', collaboratorLandingFileId)
  .count({ count: '*' })
  .first()
if (Number(collaboratorLandingManifestCount?.count ?? 0) !== 1) {
  throw new Error('user purge removed a collaborator landing image manifest')
}
const userReceipt = await database('gdpr_user_receipts')
  .where({ operation_id: userOperationId, noli_user_id: userId })
  .first()
if (
  !userReceipt?.completed_at
  || !userReceipt.storage_proven_at
  || !userReceipt.search_proven_at
  || !userReceipt.queue_proven_at
  || !userReceipt.database_proven_at
) {
  throw new Error('durable user completion receipt was incomplete')
}
const userReplay = await deleteUserPhase(database, userRequest)
const userReplayResult = await userReplay.json()
if (userReplay.status !== 200 || userReplayResult.complete !== true) {
  throw new Error('user purge replay was not complete')
}
const mismatchedOrgReplay = await deleteUserPhase(database, {
  ...userRequest,
  noliOrgId: '20000000-0000-4000-8000-000000000099',
})
const mismatchedOrgReplayResult = await mismatchedOrgReplay.json()
if (
  mismatchedOrgReplay.status !== 409
  || !mismatchedOrgReplayResult.failures.includes('user_receipt_mismatch')
) {
  throw new Error('completed user receipt accepted a different organization binding')
}
try {
  await writerDatabase('entity_indexes').insert({
    id: crypto.randomUUID(),
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    entity_id: contentId,
    doc: { personal: 'late indexed resurrection' },
  })
  throw new Error('user search fence accepted a post-completion resurrection')
} catch (error) {
  if (
    error instanceof Error
    && error.message === 'user search fence accepted a post-completion resurrection'
  ) throw error
}
try {
  await writerDatabase('entity_indexes').insert({
    id: crypto.randomUUID(),
    organization_id: null,
    tenant_id: null,
    entity_id: unscopedContentId,
    doc: { personal: 'late unscoped indexed resurrection' },
  })
  throw new Error('unscoped user search fence accepted a post-completion resurrection')
} catch (error) {
  if (
    error instanceof Error
    && error.message === 'unscoped user search fence accepted a post-completion resurrection'
  ) throw error
}
try {
  await writerDatabase('user_content').insert({
    id: '90000000-0000-4000-8000-000000000047',
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    created_by_user_id: userId,
    body: 'late resurrection',
  })
  throw new Error('user writer fence accepted a post-completion resurrection')
} catch (error) {
  if (
    error instanceof Error
    && error.message === 'user writer fence accepted a post-completion resurrection'
  ) throw error
}
try {
  await writerDatabase('user_owned_resources').insert({
    id: '90000000-0000-4000-8000-000000000049',
    organization_id: userOrganizationId,
    tenant_id: userTenantId,
    owner_id: userId,
    body: 'late foreign-key resurrection',
  })
  throw new Error('foreign-key user writer fence accepted a post-completion resurrection')
} catch (error) {
  if (
    error instanceof Error
    && error.message === 'foreign-key user writer fence accepted a post-completion resurrection'
  ) throw error
}

const organizationId = '10000000-0000-4000-8000-000000000007'
const noliOrgId = '20000000-0000-4000-8000-000000000007'
const tenantId = '30000000-0000-4000-8000-000000000007'
const operationId = '80000000-0000-4000-8000-000000000007'
const attachmentId = '90000000-0000-4000-8000-000000000007'
const storagePath = `org_${organizationId}/tenant_${tenantId}/proof.txt`

await database('organizations').insert({
  id: organizationId,
  noli_org_id: noliOrgId,
  tenant_id: tenantId,
})
await database('org_content').insert({
  id: '90000000-0000-4000-8000-000000000004',
  organization_id: organizationId,
  body: 'erase me',
})
await database('attachment_partitions').insert({ code: 'test' }).onConflict('code').ignore()
await database('attachments').insert({
  id: attachmentId,
  organization_id: organizationId,
  partition_code: 'test',
  storage_path: storagePath,
  storage_driver: 'local',
})
await database('progress_jobs').insert({
  id: '90000000-0000-4000-8000-000000000005',
  organization_id: organizationId,
  status: 'running',
})

const storageFile = path.join(runtimeRoot, 'storage', 'attachments', 'test', storagePath)
const thumbnailFile = path.join(
  runtimeRoot,
  'storage',
  'attachments',
  'test',
  '.cache',
  'thumbnails',
  attachmentId,
  'w10-h10-ccover',
)
const contactFile = path.join(runtimeRoot, 'uploads', 'attachments', organizationId, 'contact', 'a.txt')
const landingFile = path.join(runtimeRoot, 'uploads', 'page-images', organizationId, 'page', 'image.png')
for (const file of [storageFile, thumbnailFile, contactFile, landingFile]) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'personal data')
}
const localQueueFile = path.join(runtimeRoot, '.mercato', 'queue', 'proof', 'queue.json')
await fs.mkdir(path.dirname(localQueueFile), { recursive: true })
await fs.writeFile(localQueueFile, JSON.stringify([{
  id: 'queued-proof',
  payload: { organizationId },
}]))

const request = {
  contract: 'noli-gdpr-delete-v2',
  operationId,
  app: 'crm',
  phase: 'organization',
  noliUserId: '50000000-0000-4000-8000-000000000003',
  noliOrgId,
  email: null,
  clerkUserId: null,
}
const blockedResponse = await deleteOrganizationPhase(database, request)
const blockedResult = await blockedResponse.json()
if (
  blockedResponse.status !== 409
  || !blockedResult.failures.includes('active_job:progress_jobs')
  || !blockedResult.failures.includes('local_queue_job:proof')
) {
  throw new Error(`active work did not block purge: ${JSON.stringify(blockedResult)}`)
}
for (const file of [storageFile, thumbnailFile, contactFile, landingFile]) {
  await fs.lstat(file)
}
await database.transaction(async (transaction) => {
  await transaction.raw("select set_config('noli.gdpr_operation_id', ?, true)", [operationId])
  await transaction('progress_jobs').where('organization_id', organizationId).del()
})
await fs.writeFile(localQueueFile, '[]')

const response = await deleteOrganizationPhase(database, request)
const result = await response.json()
if (response.status !== 200 || result.complete !== true) {
  throw new Error(`organization purge did not complete: ${JSON.stringify(result)}`)
}
for (const file of [storageFile, thumbnailFile, contactFile, landingFile]) {
  try {
    await fs.lstat(file)
    throw new Error(`local file survived organization purge: ${file}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('local file survived')) throw error
  }
}
const [{ count: organizationCount }] = await database('organizations')
  .where('id', organizationId)
  .count({ count: '*' })
if (Number(organizationCount) !== 0) throw new Error('organizations retained the target row')
for (const table of ['org_content', 'attachments']) {
  const [{ count }] = await database(table)
    .where('organization_id', organizationId)
    .count({ count: '*' })
  if (Number(count) !== 0) throw new Error(`${table} retained target organization rows`)
}
const receipt = await database('gdpr_org_subjects').where({ operation_id: operationId }).first()
if (!receipt?.completed_at || !receipt.storage_proven_at || !receipt.search_proven_at || !receipt.queue_proven_at || !receipt.database_proven_at) {
  throw new Error('durable organization completion receipt was incomplete')
}
const replay = await deleteOrganizationPhase(database, request)
const replayResult = await replay.json()
if (replay.status !== 200 || replayResult.complete !== true) {
  throw new Error('organization purge replay was not complete')
}
await database.destroy()
await writerDatabase.destroy()
NODE
)

emit_migration_down | "${PSQL[@]}" >/dev/null
"${PSQL[@]}" >/dev/null <<'SQL'
do $$
begin
  if to_regclass('public.gdpr_erasure_fences') is not null then
    raise exception 'GDPR migration rollback retained internal tables';
  end if;
  if to_regclass('public.gdpr_user_local_files') is not null then
    raise exception 'GDPR migration rollback retained local-file manifests';
  end if;
  if to_regprocedure('public.crm_gdpr_guard_user_search_write()') is not null then
    raise exception 'GDPR migration rollback retained search writer fence';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'attachments'
       and column_name = 'uploaded_by_user_id'
  ) then
    raise exception 'GDPR migration rollback retained attachment ownership column';
  end if;
end;
$$;
SQL

echo "CRM GDPR user/org identity, delayed-writer, queue, lease, storage/search, replay, rollback, and absence regression passed"
