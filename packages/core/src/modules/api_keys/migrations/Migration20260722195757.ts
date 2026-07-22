import { Migration } from '@mikro-orm/migrations';

export class Migration20260722195757 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "api_keys" add column "opencode_session_id" text null, add column "rate_limit_tier" text null, add column "scopes" jsonb null;`);
    this.addSql(`alter table "api_keys" add constraint "api_keys_opencode_session_id_unique" unique ("opencode_session_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "api_keys" drop constraint "api_keys_opencode_session_id_unique";`);
    this.addSql(`alter table "api_keys" drop column "opencode_session_id", drop column "rate_limit_tier", drop column "scopes";`);
  }

}
