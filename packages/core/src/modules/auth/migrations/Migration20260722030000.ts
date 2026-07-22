import { Migration } from '@mikro-orm/migrations'

/** Linearizable local provision fences for the ecosystem GDPR contract. */
export class Migration20260722030000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gdpr_erasure_fences" (
        "scope" text not null check ("scope" in ('user', 'organization')),
        "subject_id" text not null,
        "state" text not null check ("state" in ('active', 'deleting')),
        "operation_id" uuid,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        primary key ("scope", "subject_id"),
        check (
          ("state" = 'active' and "operation_id" is null)
          or ("state" = 'deleting' and "operation_id" is not null)
        )
      );
    `)
    this.addSql(`
      create table if not exists "gdpr_identity_fences" (
        "identity_key" text primary key,
        "noli_user_id" text not null,
        "operation_id" uuid not null,
        "created_at" timestamptz not null default now()
      );
      create table if not exists "gdpr_user_subjects" (
        "operation_id" uuid not null,
        "noli_user_id" text not null,
        "local_user_id" uuid not null,
        "organization_id" uuid,
        "tenant_id" uuid,
        "created_at" timestamptz not null default now(),
        primary key ("operation_id", "local_user_id")
      );
      create table if not exists "gdpr_user_receipts" (
        "operation_id" uuid primary key,
        "noli_user_id" text not null unique,
        "noli_org_id" text,
        "email_hash" text,
        "clerk_hash" text,
        "storage_proven_at" timestamptz,
        "search_proven_at" timestamptz,
        "queue_proven_at" timestamptz,
        "database_proven_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz not null default now()
      );
      create table if not exists "gdpr_user_search_subjects" (
        "operation_id" uuid not null,
        "noli_user_id" text not null,
        "tenant_id" uuid,
        "tenant_scope" text not null,
        "organization_id" uuid,
        "record_id" text not null,
        "created_at" timestamptz not null default now(),
        primary key ("operation_id", "tenant_scope", "record_id"),
        check ("tenant_scope" = coalesce("tenant_id"::text, '*'))
      );
      create table if not exists "gdpr_user_local_files" (
        "id" uuid primary key default gen_random_uuid(),
        "local_user_id" uuid not null,
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "relative_path" text not null unique,
        "created_at" timestamptz not null default now(),
        check ("relative_path" like 'uploads/page-images/%')
      );
      create table if not exists "gdpr_local_write_leases" (
        "lease_id" uuid primary key,
        "organization_id" uuid not null,
        "noli_org_id" text not null,
        "kind" text not null check ("kind" in ('processor', 'storage', 'search')),
        "created_at" timestamptz not null default now()
      );
      create table if not exists "gdpr_user_write_leases" (
        "lease_id" uuid primary key,
        "local_user_id" uuid not null,
        "kind" text not null check ("kind" in ('processor', 'storage', 'search')),
        "created_at" timestamptz not null default now()
      );
      create table if not exists "gdpr_external_processor_grants" (
        "grant_id" uuid primary key,
        "organization_id" uuid not null references "organizations" ("id") on delete cascade,
        "local_user_id" uuid not null references "users" ("id") on delete cascade,
        "noli_org_id" text not null,
        "provider" text not null check (nullif(btrim("provider"), '') is not null),
        "purpose" text not null check (nullif(btrim("purpose"), '') is not null),
        "external_binding_sha256" text not null
          check ("external_binding_sha256" ~ '^[0-9a-f]{64}$'),
        "expires_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        check ("expires_at" > "created_at")
      );
      create table if not exists "gdpr_org_subjects" (
        "operation_id" uuid not null,
        "noli_org_id" text not null,
        "organization_id" uuid not null,
        "tenant_id" uuid,
        "storage_proven_at" timestamptz,
        "search_proven_at" timestamptz,
        "queue_proven_at" timestamptz,
        "database_proven_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz not null default now(),
        primary key ("operation_id", "noli_org_id"),
        unique ("noli_org_id")
      );
      alter table public.gdpr_user_search_subjects
        add column if not exists tenant_scope text;
      update public.gdpr_user_search_subjects
         set tenant_scope = coalesce(tenant_id::text, '*')
       where tenant_scope is null;
      alter table public.gdpr_user_search_subjects
        alter column tenant_scope set not null;
      do $$
      declare
        primary_key_name text;
        primary_key_has_scope boolean;
      begin
        select constraints.conname,
               attributes.attnum = any(constraints.conkey)
          into primary_key_name, primary_key_has_scope
          from pg_catalog.pg_constraint as constraints
          join pg_catalog.pg_attribute as attributes
            on attributes.attrelid = constraints.conrelid
           and attributes.attname = 'tenant_scope'
         where constraints.conrelid = 'public.gdpr_user_search_subjects'::regclass
           and constraints.contype = 'p';
        if primary_key_name is not null and not primary_key_has_scope then
          execute format(
            'alter table public.gdpr_user_search_subjects drop constraint %I',
            primary_key_name
          );
          primary_key_name := null;
        end if;
        alter table public.gdpr_user_search_subjects
          alter column tenant_id drop not null;
        if primary_key_name is null then
          alter table public.gdpr_user_search_subjects
            add constraint gdpr_user_search_subjects_pkey
            primary key (operation_id, tenant_scope, record_id);
        end if;
        if not exists (
          select 1
            from pg_catalog.pg_constraint as constraints
           where constraints.conrelid = 'public.gdpr_user_search_subjects'::regclass
             and constraints.contype = 'c'
             and pg_catalog.pg_get_constraintdef(constraints.oid) like '%tenant_scope%'
        ) then
          alter table public.gdpr_user_search_subjects
            add constraint gdpr_user_search_subjects_tenant_scope_check
            check (tenant_scope = coalesce(tenant_id::text, '*'));
        end if;
      end;
      $$;
      create index if not exists "gdpr_local_write_leases_noli_org_idx"
        on "gdpr_local_write_leases" ("noli_org_id", "kind");
      create index if not exists "gdpr_user_write_leases_user_idx"
        on "gdpr_user_write_leases" ("local_user_id", "kind");
      create index if not exists "gdpr_external_processor_grants_org_idx"
        on "gdpr_external_processor_grants" ("noli_org_id", "expires_at");
      create index if not exists "gdpr_external_processor_grants_user_idx"
        on "gdpr_external_processor_grants" ("local_user_id", "expires_at");
      create index if not exists "gdpr_user_subjects_local_user_idx"
        on "gdpr_user_subjects" ("local_user_id");
      create index if not exists "gdpr_user_search_subjects_record_tenant_idx"
        on "gdpr_user_search_subjects" ("record_id", "tenant_id");
      create index if not exists "gdpr_user_local_files_user_idx"
        on "gdpr_user_local_files" ("local_user_id");
      create index if not exists "gdpr_user_local_files_org_idx"
        on "gdpr_user_local_files" ("organization_id");
      create unique index if not exists "gdpr_org_subjects_organization_idx"
        on "gdpr_org_subjects" ("organization_id");
      alter table public.gdpr_erasure_fences enable row level security;
      alter table public.gdpr_identity_fences enable row level security;
      alter table public.gdpr_user_subjects enable row level security;
      alter table public.gdpr_user_receipts enable row level security;
      alter table public.gdpr_user_search_subjects enable row level security;
      alter table public.gdpr_user_local_files enable row level security;
      alter table public.gdpr_local_write_leases enable row level security;
      alter table public.gdpr_user_write_leases enable row level security;
      alter table public.gdpr_org_subjects enable row level security;
      revoke all on table public.gdpr_erasure_fences,
        public.gdpr_identity_fences,
        public.gdpr_user_subjects,
        public.gdpr_user_receipts,
        public.gdpr_user_search_subjects,
        public.gdpr_user_local_files,
        public.gdpr_local_write_leases,
        public.gdpr_user_write_leases,
        public.gdpr_org_subjects
        from public;
      alter table public.gdpr_user_receipts
        add column if not exists noli_org_id text;
      alter table if exists public.attachments
        add column if not exists uploaded_by_user_id uuid;
      do $$
      begin
        if to_regclass('public.attachments') is not null then
          create index if not exists "attachments_uploaded_by_user_idx"
            on public.attachments (uploaded_by_user_id);
        end if;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_lock_active(
        p_scope text,
        p_subject_id text
      ) returns void
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        fence_state text;
      begin
        if p_scope not in ('user', 'organization') or nullif(p_subject_id, '') is null then
          raise exception 'CRM GDPR provision identity is required';
        end if;
        perform pg_catalog.pg_advisory_xact_lock_shared(
          pg_catalog.hashtextextended(
            'crm-gdpr-fence:' || p_scope || ':' || p_subject_id,
            0
          )
        );
        insert into public.gdpr_erasure_fences (scope, subject_id, state)
        values (p_scope, p_subject_id, 'active')
        on conflict (scope, subject_id) do nothing;
        select state into fence_state
          from public.gdpr_erasure_fences
         where scope = p_scope and subject_id = p_subject_id;
        if fence_state <> 'active' then
          raise exception 'CRM identity is frozen for GDPR erasure';
        end if;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_guard_org_scoped_write()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        local_org_id uuid;
        noli_org_id_value text;
        internal_operation uuid;
      begin
        begin
          internal_operation := nullif(current_setting('noli.gdpr_operation_id', true), '')::uuid;
        exception when invalid_text_representation then
          raise exception 'invalid internal GDPR operation binding';
        end;

        for local_org_id in
          select distinct candidate
            from unnest(array[
              case when tg_op in ('UPDATE', 'DELETE') then old.organization_id end,
              case when tg_op in ('INSERT', 'UPDATE') then new.organization_id end
            ]) as candidate
           where candidate is not null
           order by candidate
        loop
          select organizations.noli_org_id into noli_org_id_value
            from public.organizations as organizations
           where organizations.id = local_org_id
           for key share;
          if noli_org_id_value is null then
            raise exception 'CRM organization-scoped write has no exact Noli organization';
          end if;
          if internal_operation is not null and exists (
            select 1 from public.gdpr_erasure_fences
             where scope = 'organization'
               and subject_id = noli_org_id_value
               and state = 'deleting'
               and operation_id = internal_operation
          ) then
            continue;
          end if;
          perform public.crm_gdpr_lock_active('organization', noli_org_id_value);
        end loop;
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_guard_user_insert()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        noli_org_id_value text;
        subject text;
        identity_key_value text;
        internal_operation uuid;
      begin
        begin
          internal_operation := nullif(current_setting('noli.gdpr_operation_id', true), '')::uuid;
        exception when invalid_text_representation then
          raise exception 'invalid internal GDPR operation binding';
        end;
        if tg_op = 'UPDATE' and internal_operation is not null and exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'user'
             and subject_id = old.id::text
             and state = 'deleting'
             and operation_id = internal_operation
        ) then
          return new;
        end if;

        for identity_key_value in
          select distinct candidate from unnest(array[
            case when tg_op = 'UPDATE' and old.email_hash is not null
              then 'email:' || lower(old.email_hash) end,
            case when new.email_hash is not null then 'email:' || lower(new.email_hash) end,
            case when tg_op = 'UPDATE' and old.clerk_user_id is not null
              then 'clerk:' || encode(sha256(convert_to(old.clerk_user_id, 'UTF8')), 'hex') end,
            case when new.clerk_user_id is not null
              then 'clerk:' || encode(sha256(convert_to(new.clerk_user_id, 'UTF8')), 'hex') end
          ]) as candidate where candidate is not null order by candidate
        loop
          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(identity_key_value, 0)
          );
          if exists (
            select 1 from public.gdpr_identity_fences
             where identity_key = identity_key_value
          ) then
            raise exception 'CRM identity is frozen for GDPR erasure';
          end if;
        end loop;

        for subject in
          select distinct candidate from unnest(array[
            case when tg_op = 'UPDATE' then old.id::text end,
            new.id::text
          ]) as candidate where candidate is not null order by candidate
        loop
          perform public.crm_gdpr_lock_active('user', subject);
        end loop;

        for subject in
          select distinct candidate from unnest(array[
            case when tg_op = 'UPDATE' then old.organization_id::text end,
            new.organization_id::text
          ]) as candidate where candidate is not null order by candidate
        loop
          select organizations.noli_org_id into noli_org_id_value
            from public.organizations as organizations
           where organizations.id = subject::uuid
           for key share;
          if noli_org_id_value is not null then
            perform public.crm_gdpr_lock_active('organization', noli_org_id_value);
          end if;
        end loop;
        return new;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_guard_user_scoped_write()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        argument_index integer;
        column_name_value text;
        old_subject text;
        new_subject text;
        subject text;
        subjects text[] := array[]::text[];
        internal_operation uuid;
      begin
        begin
          internal_operation := nullif(current_setting('noli.gdpr_operation_id', true), '')::uuid;
        exception when invalid_text_representation then
          raise exception 'invalid internal GDPR operation binding';
        end;

        if tg_nargs = 0 then
          raise exception 'CRM user-scoped writer trigger has no identity columns';
        end if;
        for argument_index in 0..tg_nargs - 1 loop
          column_name_value := tg_argv[argument_index];
          old_subject := case when tg_op in ('UPDATE', 'DELETE')
            then to_jsonb(old) ->> column_name_value end;
          new_subject := case when tg_op in ('INSERT', 'UPDATE')
            then to_jsonb(new) ->> column_name_value end;
          subjects := subjects || array[old_subject, new_subject];
        end loop;
        for subject in
          select distinct candidate
            from unnest(subjects) as candidate
           where candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           order by candidate
        loop
          if not exists (
            select 1 from public.users where id = subject::uuid
          ) and not exists (
            select 1 from public.gdpr_erasure_fences
             where scope = 'user' and subject_id = subject
          ) then
            continue;
          end if;
          if internal_operation is not null and exists (
            select 1 from public.gdpr_erasure_fences
             where scope = 'user'
               and subject_id = subject
               and state = 'deleting'
               and operation_id = internal_operation
          ) then
            continue;
          end if;
          perform public.crm_gdpr_lock_active('user', subject);
        end loop;
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_lock_user_search_subject()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        lock_key text;
      begin
        for lock_key in
          select candidate
            from unnest(array[
              'crm-gdpr-user-search:*:' || new.record_id,
              'crm-gdpr-user-search:' || new.tenant_id::text || ':' || new.record_id
            ]) as candidate
           where candidate is not null
           order by candidate
        loop
          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(lock_key, 0)
          );
        end loop;
        return new;
      end;
      $$;

      create or replace function public.crm_gdpr_guard_user_search_write()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        candidate record;
        candidates jsonb := '[]'::jsonb;
        lock_key text;
        record_column text;
      begin
        if tg_nargs <> 1 then
          raise exception 'CRM user-search writer trigger has no record column';
        end if;
        record_column := tg_argv[0];
        if tg_op = 'UPDATE' then
          candidates := candidates || jsonb_build_array(jsonb_build_object(
            'tenant_id', to_jsonb(old) ->> 'tenant_id',
            'record_id', to_jsonb(old) ->> record_column
          ));
        end if;
        candidates := candidates || jsonb_build_array(jsonb_build_object(
          'tenant_id', to_jsonb(new) ->> 'tenant_id',
          'record_id', to_jsonb(new) ->> record_column
        ));

        for lock_key in
          with normalized as (
            select distinct
                   value ->> 'tenant_id' as tenant_id,
                   value ->> 'record_id' as record_id
              from jsonb_array_elements(candidates)
             where nullif(value ->> 'record_id', '') is not null
          )
          select distinct candidate_key
            from normalized
            cross join lateral unnest(array[
              'crm-gdpr-user-search:*:' || normalized.record_id,
              case when normalized.tenant_id is not null then
                'crm-gdpr-user-search:' || normalized.tenant_id || ':' || normalized.record_id
              end
            ]) as candidate_key
           where candidate_key is not null
           order by candidate_key
        loop
          perform pg_catalog.pg_advisory_xact_lock_shared(
            pg_catalog.hashtextextended(lock_key, 0)
          );
        end loop;

        for candidate in
          select distinct
                 value ->> 'tenant_id' as tenant_id,
                 value ->> 'record_id' as record_id
            from jsonb_array_elements(candidates)
           where nullif(value ->> 'record_id', '') is not null
           order by tenant_id nulls first, record_id
        loop
          if exists (
            select 1
              from public.gdpr_user_search_subjects as subjects
             where subjects.record_id = candidate.record_id
               and (
                 subjects.tenant_id is null
                 or candidate.tenant_id is null
                 or subjects.tenant_id = candidate.tenant_id::uuid
               )
          ) then
            raise exception 'CRM search subject is frozen for GDPR erasure';
          end if;
        end loop;
        return new;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_guard_organization_write()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        subject text;
        internal_operation uuid;
      begin
        begin
          internal_operation := nullif(current_setting('noli.gdpr_operation_id', true), '')::uuid;
        exception when invalid_text_representation then
          raise exception 'invalid internal GDPR operation binding';
        end;
        if tg_op in ('UPDATE', 'DELETE') and internal_operation is not null and exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'organization'
             and subject_id = old.noli_org_id
             and state = 'deleting'
             and operation_id = internal_operation
        ) then
          if tg_op = 'DELETE' then return old; end if;
          return new;
        end if;

        for subject in
          select distinct candidate from unnest(array[
            case when tg_op in ('UPDATE', 'DELETE') then old.noli_org_id end,
            case when tg_op in ('INSERT', 'UPDATE') then new.noli_org_id end
          ]) as candidate where candidate is not null order by candidate
        loop
          perform public.crm_gdpr_lock_active('organization', subject);
        end loop;
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $$;
    `)
    this.addSql(`drop trigger if exists crm_gdpr_guard_user_insert on "users";`)
    this.addSql(`
      create trigger crm_gdpr_guard_user_insert
      before insert or update on "users"
      for each row execute function public.crm_gdpr_guard_user_insert();
    `)
    this.addSql(`drop trigger if exists crm_gdpr_guard_organization_write on "organizations";`)
    this.addSql(`
      create trigger crm_gdpr_guard_organization_write
      before insert or update or delete on "organizations"
      for each row execute function public.crm_gdpr_guard_organization_write();
    `)
    this.addSql(`
      do $$
      declare table_row record;
      begin
        for table_row in
          select distinct columns.table_name
            from information_schema.columns as columns
            join information_schema.tables as tables
              on tables.table_schema = columns.table_schema
             and tables.table_name = columns.table_name
           where columns.table_schema = 'public'
             and columns.column_name = 'organization_id'
             and tables.table_type = 'BASE TABLE'
             and columns.table_name not in (
               'organizations',
               'gdpr_user_subjects',
               'gdpr_local_write_leases',
               'gdpr_org_subjects'
             )
           order by columns.table_name
        loop
          execute format(
            'drop trigger if exists crm_gdpr_guard_org_scoped_write on public.%I',
            table_row.table_name
          );
          execute format(
            'create trigger crm_gdpr_guard_org_scoped_write before insert or update or delete on public.%I for each row execute function public.crm_gdpr_guard_org_scoped_write()',
            table_row.table_name
          );
        end loop;
      end;
      $$;
    `)
    this.addSql(`
      do $$
      declare table_row record;
      declare trigger_arguments text;
      begin
        for table_row in
          select columns.table_name,
                 array_agg(columns.column_name order by columns.column_name) as user_columns
            from information_schema.columns as columns
            join information_schema.tables as tables
              on tables.table_schema = columns.table_schema
             and tables.table_name = columns.table_name
           where columns.table_schema = 'public'
             and tables.table_type = 'BASE TABLE'
             and (
               lower(columns.column_name) = 'user_id'
               or lower(columns.column_name) like '%\\_user\\_id' escape '\\'
               or lower(columns.column_name) in (
                 'assigned_to', 'claimed_by', 'completed_by', 'created_by',
                 'updated_by', 'uploaded_by'
               )
               or exists (
                 select 1
                   from pg_catalog.pg_constraint as foreign_keys
                   join pg_catalog.pg_class as child_tables
                     on child_tables.oid = foreign_keys.conrelid
                   join pg_catalog.pg_namespace as child_namespaces
                     on child_namespaces.oid = child_tables.relnamespace
                   join pg_catalog.pg_attribute as child_columns
                     on child_columns.attrelid = foreign_keys.conrelid
                    and child_columns.attnum = any(foreign_keys.conkey)
                   join pg_catalog.pg_class as parent_tables
                     on parent_tables.oid = foreign_keys.confrelid
                   join pg_catalog.pg_namespace as parent_namespaces
                     on parent_namespaces.oid = parent_tables.relnamespace
                   join pg_catalog.pg_attribute as parent_columns
                     on parent_columns.attrelid = foreign_keys.confrelid
                    and parent_columns.attnum = any(foreign_keys.confkey)
                  where foreign_keys.contype = 'f'
                    and child_namespaces.nspname = columns.table_schema
                    and child_tables.relname = columns.table_name
                    and child_columns.attname = columns.column_name
                    and parent_namespaces.nspname = 'public'
                    and parent_tables.relname = 'users'
                    and parent_columns.attname = 'id'
               )
             )
             and columns.table_name not in (
               'users', 'gdpr_identity_fences', 'gdpr_user_subjects', 'gdpr_user_receipts',
               'gdpr_user_search_subjects', 'gdpr_user_write_leases'
             )
           group by columns.table_name
           order by columns.table_name
        loop
          select string_agg(quote_literal(column_name), ', ' order by column_name)
            into trigger_arguments
            from unnest(table_row.user_columns) as column_name;
          execute format(
            'drop trigger if exists crm_gdpr_guard_user_scoped_write on public.%I',
            table_row.table_name
          );
          execute format(
            'create trigger crm_gdpr_guard_user_scoped_write before insert or update or delete on public.%I for each row execute function public.crm_gdpr_guard_user_scoped_write(%s)',
            table_row.table_name,
            trigger_arguments
          );
        end loop;
      end;
      $$;
    `)
    this.addSql(`drop trigger if exists crm_gdpr_lock_user_search_subject on "gdpr_user_search_subjects";`)
    this.addSql(`
      create trigger crm_gdpr_lock_user_search_subject
      before insert or update on "gdpr_user_search_subjects"
      for each row execute function public.crm_gdpr_lock_user_search_subject();
    `)
    this.addSql(`
      do $$
      declare table_row record;
      begin
        for table_row in
          select * from (values
            ('entity_indexes', 'entity_id'),
            ('search_tokens', 'entity_id'),
            ('vector_search', 'record_id'),
            ('indexer_error_logs', 'record_id'),
            ('indexer_status_logs', 'record_id')
          ) as expected(table_name, record_column)
         where exists (
           select 1
             from information_schema.columns
            where table_schema = 'public'
              and table_name = expected.table_name
              and column_name = expected.record_column
         )
           and exists (
             select 1
               from information_schema.columns
              where table_schema = 'public'
                and table_name = expected.table_name
                and column_name = 'tenant_id'
           )
         order by expected.table_name
        loop
          execute format(
            'drop trigger if exists crm_gdpr_guard_user_search_write on public.%I',
            table_row.table_name
          );
          execute format(
            'create trigger crm_gdpr_guard_user_search_write before insert or update on public.%I for each row execute function public.crm_gdpr_guard_user_search_write(%L)',
            table_row.table_name,
            table_row.record_column
          );
        end loop;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_begin_erasure(
        p_scope text,
        p_subject_id text,
        p_operation_id uuid
      ) returns text
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        fence_row public.gdpr_erasure_fences%rowtype;
      begin
        if p_scope not in ('user', 'organization')
           or nullif(p_subject_id, '') is null
           or p_operation_id is null then
          raise exception 'CRM GDPR erasure identity is required';
        end if;
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            'crm-gdpr-fence:' || p_scope || ':' || p_subject_id,
            0
          )
        );
        insert into public.gdpr_erasure_fences (scope, subject_id, state, operation_id)
        values (p_scope, p_subject_id, 'deleting', p_operation_id)
        on conflict (scope, subject_id) do nothing;
        select * into fence_row
          from public.gdpr_erasure_fences
         where scope = p_scope and subject_id = p_subject_id
         for update;
        if fence_row.state = 'active' then
          update public.gdpr_erasure_fences
             set state = 'deleting', operation_id = p_operation_id, updated_at = now()
           where scope = p_scope and subject_id = p_subject_id;
        elsif fence_row.operation_id is distinct from p_operation_id then
          raise exception 'CRM GDPR erasure operation mismatch';
        end if;
        return 'deleting';
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_acquire_local_write_lease(
        p_organization_id uuid,
        p_lease_id uuid,
        p_kind text
      ) returns text
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        noli_org_id_value text;
        fence_state text;
      begin
        if p_organization_id is null or p_lease_id is null or p_kind not in ('processor', 'storage', 'search') then
          raise exception 'CRM local-write lease identity is required';
        end if;
        select organizations.noli_org_id into noli_org_id_value
          from public.organizations as organizations
         where organizations.id = p_organization_id
         for key share;
        if noli_org_id_value is null then return null; end if;
        perform pg_catalog.pg_advisory_xact_lock_shared(
          pg_catalog.hashtextextended(
            'crm-gdpr-fence:organization:' || noli_org_id_value,
            0
          )
        );
        insert into public.gdpr_erasure_fences (scope, subject_id, state)
        values ('organization', noli_org_id_value, 'active')
        on conflict (scope, subject_id) do nothing;
        select state into fence_state
          from public.gdpr_erasure_fences
         where scope = 'organization' and subject_id = noli_org_id_value;
        if fence_state <> 'active' then return null; end if;
        insert into public.gdpr_local_write_leases (
          lease_id, organization_id, noli_org_id, kind
        ) values (
          p_lease_id, p_organization_id, noli_org_id_value, p_kind
        ) on conflict (lease_id) do nothing;
        if not exists (
          select 1 from public.gdpr_local_write_leases
           where lease_id = p_lease_id
             and organization_id = p_organization_id
             and noli_org_id = noli_org_id_value
             and kind = p_kind
        ) then
          raise exception 'CRM local-write lease binding mismatch';
        end if;
        return noli_org_id_value;
      end;
      $$;

      create or replace function public.crm_gdpr_release_local_write_lease(
        p_organization_id uuid,
        p_lease_id uuid,
        p_kind text
      ) returns boolean
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        delete from public.gdpr_local_write_leases
         where lease_id = p_lease_id
           and organization_id = p_organization_id
           and kind = p_kind;
        return found;
      end;
      $$;

      create or replace function public.crm_gdpr_active_local_write_leases(
        p_noli_org_id text,
        p_operation_id uuid
      ) returns bigint
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare lease_count bigint;
      begin
        if not exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'organization'
             and subject_id = p_noli_org_id
             and state = 'deleting'
             and operation_id = p_operation_id
        ) then
          raise exception 'CRM local-write lease inventory fence mismatch';
        end if;
        select
          (select count(*)
             from public.gdpr_local_write_leases
            where noli_org_id = p_noli_org_id)
          +
          (select count(*)
             from public.gdpr_external_processor_grants
            where noli_org_id = p_noli_org_id
              and expires_at > now())
          into lease_count;
        return lease_count;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_acquire_user_write_lease(
        p_local_user_id uuid,
        p_lease_id uuid,
        p_kind text
      ) returns boolean
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare fence_state text;
      begin
        if p_local_user_id is null or p_lease_id is null or p_kind not in ('processor', 'storage', 'search') then
          raise exception 'CRM user-write lease identity is required';
        end if;
        if not exists (
          select 1 from public.users where id = p_local_user_id
        ) and not exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'user' and subject_id = p_local_user_id::text
        ) then
          return false;
        end if;
        perform pg_catalog.pg_advisory_xact_lock_shared(
          pg_catalog.hashtextextended(
            'crm-gdpr-fence:user:' || p_local_user_id::text,
            0
          )
        );
        insert into public.gdpr_erasure_fences (scope, subject_id, state)
        values ('user', p_local_user_id::text, 'active')
        on conflict (scope, subject_id) do nothing;
        select state into fence_state
          from public.gdpr_erasure_fences
         where scope = 'user' and subject_id = p_local_user_id::text;
        if fence_state <> 'active' then return false; end if;
        insert into public.gdpr_user_write_leases (lease_id, local_user_id, kind)
        values (p_lease_id, p_local_user_id, p_kind)
        on conflict (lease_id) do nothing;
        if not exists (
          select 1 from public.gdpr_user_write_leases
           where lease_id = p_lease_id
             and local_user_id = p_local_user_id
             and kind = p_kind
        ) then
          raise exception 'CRM user-write lease binding mismatch';
        end if;
        return true;
      end;
      $$;

      create or replace function public.crm_gdpr_release_user_write_lease(
        p_local_user_id uuid,
        p_lease_id uuid,
        p_kind text
      ) returns boolean
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        delete from public.gdpr_user_write_leases
         where lease_id = p_lease_id
           and local_user_id = p_local_user_id
           and kind = p_kind;
        return found;
      end;
      $$;

      create or replace function public.crm_gdpr_active_user_write_leases(
        p_noli_user_id text,
        p_operation_id uuid,
        p_local_user_ids uuid[]
      ) returns bigint
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare lease_count bigint;
      begin
        if not exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'user'
             and subject_id = p_noli_user_id
             and state = 'deleting'
             and operation_id = p_operation_id
        ) then
          raise exception 'CRM user-write lease inventory fence mismatch';
        end if;
        select
          (select count(*)
             from public.gdpr_user_write_leases
            where local_user_id = any(coalesce(p_local_user_ids, array[]::uuid[])))
          +
          (select count(*)
             from public.gdpr_external_processor_grants
            where local_user_id = any(coalesce(p_local_user_ids, array[]::uuid[]))
              and expires_at > now())
          into lease_count;
        return lease_count;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_create_external_processor_grant(
        p_organization_id uuid,
        p_local_user_id uuid,
        p_organization_lease_id uuid,
        p_user_lease_id uuid,
        p_grant_id uuid,
        p_provider text,
        p_purpose text,
        p_external_binding text,
        p_lifetime_seconds integer
      ) returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        noli_org_id_value text;
        organization_fence_state text;
        user_fence_state text;
        expires_at_value timestamptz;
      begin
        if p_organization_id is null
           or p_local_user_id is null
           or p_organization_lease_id is null
           or p_user_lease_id is null
           or p_grant_id is null
           or nullif(btrim(p_provider), '') is null
           or nullif(btrim(p_purpose), '') is null
           or nullif(p_external_binding, '') is null
           or p_lifetime_seconds is null
           or p_lifetime_seconds < 1
           or p_lifetime_seconds > 4200 then
          raise exception 'CRM external processor grant binding is required';
        end if;

        select leases.noli_org_id
          into noli_org_id_value
          from public.gdpr_local_write_leases as leases
          join public.organizations as organizations
            on organizations.id = leases.organization_id
           and organizations.noli_org_id = leases.noli_org_id
         where leases.lease_id = p_organization_lease_id
           and leases.organization_id = p_organization_id
           and leases.kind = 'processor'
         for key share of leases, organizations;
        if not found then
          raise exception 'CRM external grant lacks its organization processor lease';
        end if;
        if not exists (
          select 1
            from public.gdpr_user_write_leases as leases
           where leases.lease_id = p_user_lease_id
             and leases.local_user_id = p_local_user_id
             and leases.kind = 'processor'
           for key share
        ) then
          raise exception 'CRM external grant lacks its user processor lease';
        end if;

        perform pg_catalog.pg_advisory_xact_lock_shared(
          pg_catalog.hashtextextended(
            'crm-gdpr-fence:organization:' || noli_org_id_value,
            0
          )
        );
        perform pg_catalog.pg_advisory_xact_lock_shared(
          pg_catalog.hashtextextended(
            'crm-gdpr-fence:user:' || p_local_user_id::text,
            0
          )
        );
        select state into organization_fence_state
          from public.gdpr_erasure_fences
         where scope = 'organization' and subject_id = noli_org_id_value;
        select state into user_fence_state
          from public.gdpr_erasure_fences
         where scope = 'user' and subject_id = p_local_user_id::text;
        if organization_fence_state <> 'active' or user_fence_state <> 'active' then
          raise exception 'CRM external processor grant was rejected by an erasure fence';
        end if;

        expires_at_value := now() + make_interval(secs => p_lifetime_seconds);
        insert into public.gdpr_external_processor_grants (
          grant_id,
          organization_id,
          local_user_id,
          noli_org_id,
          provider,
          purpose,
          external_binding_sha256,
          expires_at
        ) values (
          p_grant_id,
          p_organization_id,
          p_local_user_id,
          noli_org_id_value,
          btrim(p_provider),
          btrim(p_purpose),
          encode(sha256(convert_to(p_external_binding, 'UTF8')), 'hex'),
          expires_at_value
        );
        return jsonb_build_object(
          'grantId', p_grant_id::text,
          'organizationId', p_organization_id::text,
          'localUserId', p_local_user_id::text,
          'noliOrgId', noli_org_id_value,
          'provider', btrim(p_provider),
          'purpose', btrim(p_purpose),
          'expiresAt', expires_at_value
        );
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_begin_user_erasure(
        p_noli_user_id text,
        p_operation_id uuid,
        p_email_hash text,
        p_clerk_user_id text
      ) returns text
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare identity_key_value text;
      begin
        if nullif(p_noli_user_id, '') is null or p_operation_id is null then
          raise exception 'CRM GDPR user erasure identity is required';
        end if;
        for identity_key_value in
          select distinct candidate from unnest(array[
            case when p_email_hash is not null then 'email:' || lower(p_email_hash) end,
            case when p_clerk_user_id is not null then
              'clerk:' || encode(sha256(convert_to(p_clerk_user_id, 'UTF8')), 'hex') end
          ]) as candidate where candidate is not null order by candidate
        loop
          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(identity_key_value, 0)
          );
          insert into public.gdpr_identity_fences (
            identity_key, noli_user_id, operation_id
          ) values (
            identity_key_value, p_noli_user_id, p_operation_id
          ) on conflict (identity_key) do nothing;
          if not exists (
            select 1 from public.gdpr_identity_fences
             where identity_key = identity_key_value
               and operation_id = p_operation_id
          ) then
            raise exception 'CRM GDPR identity operation mismatch';
          end if;
        end loop;
        return public.crm_gdpr_begin_erasure('user', p_noli_user_id, p_operation_id);
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_record_user_subject(
        p_noli_user_id text,
        p_operation_id uuid,
        p_local_user_id uuid,
        p_organization_id uuid,
        p_tenant_id uuid
      ) returns boolean
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        if not exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'user'
             and subject_id = p_noli_user_id
             and state = 'deleting'
             and operation_id = p_operation_id
        ) or not exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'user'
             and subject_id = p_local_user_id::text
             and state = 'deleting'
             and operation_id = p_operation_id
        ) then
          raise exception 'CRM GDPR subject fence mismatch';
        end if;
        insert into public.gdpr_user_subjects (
          operation_id, noli_user_id, local_user_id, organization_id, tenant_id
        ) values (
          p_operation_id, p_noli_user_id, p_local_user_id, p_organization_id, p_tenant_id
        ) on conflict (operation_id, local_user_id) do nothing;
        if not exists (
          select 1 from public.gdpr_user_subjects
           where operation_id = p_operation_id
             and noli_user_id = p_noli_user_id
             and local_user_id = p_local_user_id
             and organization_id is not distinct from p_organization_id
             and tenant_id is not distinct from p_tenant_id
        ) then
          raise exception 'CRM GDPR subject binding mismatch';
        end if;
        return true;
      end;
      $$;
    `)
    this.addSql(`
      create or replace function public.crm_gdpr_user_subjects(
        p_noli_user_id text,
        p_operation_id uuid
      ) returns table (local_user_id uuid, organization_id uuid, tenant_id uuid)
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        if not exists (
          select 1 from public.gdpr_erasure_fences
           where scope = 'user'
             and subject_id = p_noli_user_id
             and state = 'deleting'
             and operation_id = p_operation_id
        ) then
          raise exception 'CRM GDPR subject inventory fence mismatch';
        end if;
        return query
          select subjects.local_user_id, subjects.organization_id, subjects.tenant_id
            from public.gdpr_user_subjects as subjects
           where subjects.noli_user_id = p_noli_user_id
             and subjects.operation_id = p_operation_id
           order by subjects.local_user_id;
      end;
      $$;
    `)
    this.addSql(`
      revoke execute on function public.crm_gdpr_lock_active(text, text) from public;
      revoke execute on function public.crm_gdpr_guard_user_insert() from public;
      revoke execute on function public.crm_gdpr_guard_user_scoped_write() from public;
      revoke execute on function public.crm_gdpr_lock_user_search_subject() from public;
      revoke execute on function public.crm_gdpr_guard_user_search_write() from public;
      revoke execute on function public.crm_gdpr_guard_organization_write() from public;
      revoke execute on function public.crm_gdpr_guard_org_scoped_write() from public;
      revoke execute on function public.crm_gdpr_begin_erasure(text, text, uuid) from public;
      revoke execute on function public.crm_gdpr_begin_user_erasure(text, uuid, text, text) from public;
      revoke execute on function public.crm_gdpr_record_user_subject(text, uuid, uuid, uuid, uuid) from public;
      revoke execute on function public.crm_gdpr_user_subjects(text, uuid) from public;
      revoke execute on function public.crm_gdpr_acquire_local_write_lease(uuid, uuid, text) from public;
      revoke execute on function public.crm_gdpr_release_local_write_lease(uuid, uuid, text) from public;
      revoke execute on function public.crm_gdpr_active_local_write_leases(text, uuid) from public;
      revoke execute on function public.crm_gdpr_acquire_user_write_lease(uuid, uuid, text) from public;
      revoke execute on function public.crm_gdpr_release_user_write_lease(uuid, uuid, text) from public;
      revoke execute on function public.crm_gdpr_active_user_write_leases(text, uuid, uuid[]) from public;
      revoke execute on function public.crm_gdpr_create_external_processor_grant(uuid, uuid, uuid, uuid, uuid, text, text, text, integer) from public;
      revoke all on table public.gdpr_external_processor_grants from public;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists crm_gdpr_guard_user_insert on "users";`)
    this.addSql(`drop trigger if exists crm_gdpr_lock_user_search_subject on "gdpr_user_search_subjects";`)
    this.addSql(`
      do $$
      declare table_row record;
      begin
        for table_row in
          select classes.relname as table_name
            from pg_catalog.pg_trigger as triggers
            join pg_catalog.pg_class as classes on classes.oid = triggers.tgrelid
            join pg_catalog.pg_namespace as namespaces on namespaces.oid = classes.relnamespace
           where namespaces.nspname = 'public'
             and triggers.tgname = 'crm_gdpr_guard_user_search_write'
        loop
          execute format(
            'drop trigger if exists crm_gdpr_guard_user_search_write on public.%I',
            table_row.table_name
          );
        end loop;
      end;
      $$;
    `)
    this.addSql(`drop trigger if exists crm_gdpr_guard_organization_write on "organizations";`)
    this.addSql(`
      do $$
      declare table_row record;
      begin
        for table_row in
          select classes.relname as table_name
            from pg_catalog.pg_trigger as triggers
            join pg_catalog.pg_class as classes on classes.oid = triggers.tgrelid
            join pg_catalog.pg_namespace as namespaces on namespaces.oid = classes.relnamespace
           where namespaces.nspname = 'public'
             and triggers.tgname = 'crm_gdpr_guard_user_scoped_write'
        loop
          execute format(
            'drop trigger if exists crm_gdpr_guard_user_scoped_write on public.%I',
            table_row.table_name
          );
        end loop;
      end;
      $$;
    `)
    this.addSql(`
      do $$
      declare table_row record;
      begin
        for table_row in
          select distinct columns.table_name
            from information_schema.columns as columns
            join information_schema.tables as tables
              on tables.table_schema = columns.table_schema
             and tables.table_name = columns.table_name
           where columns.table_schema = 'public'
             and columns.column_name = 'organization_id'
             and tables.table_type = 'BASE TABLE'
        loop
          execute format(
            'drop trigger if exists crm_gdpr_guard_org_scoped_write on public.%I',
            table_row.table_name
          );
        end loop;
      end;
      $$;
    `)
    this.addSql(`drop function if exists public.crm_gdpr_guard_user_insert();`)
    this.addSql(`drop function if exists public.crm_gdpr_guard_user_scoped_write();`)
    this.addSql(`drop function if exists public.crm_gdpr_lock_user_search_subject();`)
    this.addSql(`drop function if exists public.crm_gdpr_guard_user_search_write();`)
    this.addSql(`drop function if exists public.crm_gdpr_guard_organization_write();`)
    this.addSql(`drop function if exists public.crm_gdpr_guard_org_scoped_write();`)
    this.addSql(`drop function if exists public.crm_gdpr_begin_erasure(text, text, uuid);`)
    this.addSql(
      `drop function if exists public.crm_gdpr_begin_user_erasure(text, uuid, text, text);`,
    )
    this.addSql(
      `drop function if exists public.crm_gdpr_record_user_subject(text, uuid, uuid, uuid, uuid);`,
    )
    this.addSql(`drop function if exists public.crm_gdpr_user_subjects(text, uuid);`)
    this.addSql(
      `drop function if exists public.crm_gdpr_acquire_local_write_lease(uuid, uuid, text);`,
    )
    this.addSql(
      `drop function if exists public.crm_gdpr_release_local_write_lease(uuid, uuid, text);`,
    )
    this.addSql(`drop function if exists public.crm_gdpr_active_local_write_leases(text, uuid);`)
    this.addSql(
      `drop function if exists public.crm_gdpr_acquire_user_write_lease(uuid, uuid, text);`,
    )
    this.addSql(
      `drop function if exists public.crm_gdpr_release_user_write_lease(uuid, uuid, text);`,
    )
    this.addSql(
      `drop function if exists public.crm_gdpr_active_user_write_leases(text, uuid, uuid[]);`,
    )
    this.addSql(
      `drop function if exists public.crm_gdpr_create_external_processor_grant(uuid, uuid, uuid, uuid, uuid, text, text, text, integer);`,
    )
    this.addSql(`drop function if exists public.crm_gdpr_lock_active(text, text);`)
    this.addSql(`drop table if exists "gdpr_erasure_fences";`)
    this.addSql(`drop table if exists "gdpr_identity_fences";`)
    this.addSql(`drop table if exists "gdpr_user_subjects";`)
    this.addSql(`drop table if exists "gdpr_user_receipts";`)
    this.addSql(`drop table if exists "gdpr_user_search_subjects";`)
    this.addSql(`drop table if exists "gdpr_user_local_files";`)
    this.addSql(`drop table if exists "gdpr_local_write_leases";`)
    this.addSql(`drop table if exists "gdpr_user_write_leases";`)
    this.addSql(`drop table if exists "gdpr_external_processor_grants";`)
    this.addSql(`drop table if exists "gdpr_org_subjects";`)
    this.addSql(`drop index if exists public.attachments_uploaded_by_user_idx;`)
    this.addSql(
      `alter table if exists public.attachments drop column if exists uploaded_by_user_id;`,
    )
  }
}
