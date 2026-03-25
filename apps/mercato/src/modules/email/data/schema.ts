import { Entity, Property, PrimaryKey, Index } from '@mikro-orm/core'
import { v4 as uuid } from 'uuid'

@Entity({ tableName: 'email_accounts' })
export class EmailAccount {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuid()

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'email_address', type: 'text' })
  emailAddress!: string

  @Property({ name: 'display_name', type: 'text', nullable: true })
  displayName?: string | null

  @Property({ type: 'text', default: 'resend' })
  provider: 'resend' | 'smtp' = 'resend'

  @Property({ type: 'jsonb', nullable: true })
  config?: Record<string, any> | null

  @Property({ name: 'is_default', type: 'boolean', default: true })
  isDefault: boolean = true

  @Property({ name: 'sending_domain', type: 'text', nullable: true })
  sendingDomain?: string | null

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'email_messages' })
@Index({ properties: ['organizationId', 'contactId'], name: 'email_messages_org_contact_idx' })
@Index({ properties: ['trackingId'], name: 'email_messages_tracking_idx' })
export class EmailMessage {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuid()

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'account_id', type: 'uuid', nullable: true })
  accountId?: string | null

  @Property({ type: 'text' })
  direction!: 'inbound' | 'outbound'

  @Property({ name: 'from_address', type: 'text' })
  fromAddress!: string

  @Property({ name: 'to_address', type: 'text' })
  toAddress!: string

  @Property({ type: 'text', nullable: true })
  cc?: string | null

  @Property({ type: 'text', nullable: true })
  bcc?: string | null

  @Property({ type: 'text' })
  subject!: string

  @Property({ name: 'body_html', type: 'text' })
  bodyHtml!: string

  @Property({ name: 'body_text', type: 'text', nullable: true })
  bodyText?: string | null

  @Property({ name: 'thread_id', type: 'text', nullable: true })
  threadId?: string | null

  @Property({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: 'draft' | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed' = 'draft'

  @Property({ name: 'tracking_id', type: 'uuid' })
  trackingId: string = uuid()

  @Property({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt?: Date | null

  @Property({ name: 'clicked_at', type: 'timestamptz', nullable: true })
  clickedAt?: Date | null

  @Property({ name: 'bounced_at', type: 'timestamptz', nullable: true })
  bouncedAt?: Date | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()

  @Property({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null
}

@Entity({ tableName: 'email_templates' })
export class EmailTemplate {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuid()

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  subject!: string

  @Property({ name: 'body_html', type: 'text' })
  bodyHtml!: string

  @Property({ type: 'text', default: 'transactional' })
  category: 'transactional' | 'marketing' | 'sequence' = 'transactional'

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'email_campaigns' })
export class EmailCampaign {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuid()

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'template_id', type: 'uuid', nullable: true })
  templateId?: string | null

  @Property({ type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body_html', type: 'text', nullable: true })
  bodyHtml?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' = 'draft'

  @Property({ name: 'segment_filter', type: 'jsonb', nullable: true })
  segmentFilter?: Record<string, any> | null

  @Property({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt?: Date | null

  @Property({ type: 'jsonb', default: '{}' })
  stats: Record<string, any> = {}

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()

  @Property({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'email_campaign_recipients' })
@Index({ properties: ['campaignId', 'contactId'], name: 'email_campaign_recipients_idx' })
export class EmailCampaignRecipient {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuid()

  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  @Property({ name: 'contact_id', type: 'uuid' })
  contactId!: string

  @Property({ type: 'text' })
  email!: string

  @Property({ type: 'text', default: 'pending' })
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'unsubscribed' = 'pending'

  @Property({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null

  @Property({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt?: Date | null

  @Property({ name: 'clicked_at', type: 'timestamptz', nullable: true })
  clickedAt?: Date | null
}

@Entity({ tableName: 'email_unsubscribes' })
@Index({ properties: ['organizationId', 'email'], name: 'email_unsubscribes_org_email_idx' })
export class EmailUnsubscribe {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuid()

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()
}
