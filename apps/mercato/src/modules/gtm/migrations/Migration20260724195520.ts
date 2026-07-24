import { Migration } from '@mikro-orm/migrations';

export class Migration20260724195520 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "gtm_chat_messages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "thread_id" uuid not null, "role" text not null, "content" jsonb not null, "tool_ref" text null, "seq" int not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "gtm_chat_messages_pkey" primary key ("id"));`);
    this.addSql(`create index "gtm_chat_messages_org_tenant_thread_idx" on "gtm_chat_messages" ("organization_id", "tenant_id", "thread_id");`);
    this.addSql(`create index "gtm_chat_messages_org_tenant_idx" on "gtm_chat_messages" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "gtm_chat_messages" add constraint "gtm_chat_messages_thread_seq_unique" unique ("thread_id", "seq");`);

    this.addSql(`create table "gtm_chat_threads" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "workspace_id" uuid not null, "title" text null, "status" text not null default 'active', "last_message_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "gtm_chat_threads_pkey" primary key ("id"));`);
    this.addSql(`create index "gtm_chat_threads_org_tenant_workspace_idx" on "gtm_chat_threads" ("organization_id", "tenant_id", "workspace_id");`);
    this.addSql(`create index "gtm_chat_threads_org_tenant_idx" on "gtm_chat_threads" ("organization_id", "tenant_id");`);
  }

}
