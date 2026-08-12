import { Migration } from '@mikro-orm/migrations';

export class Migration20260812070256 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "invoices" add column if not exists "terms_url" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "invoices" drop column if exists "terms_url";`);
  }

}
