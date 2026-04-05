/**
 * Log an event to a contact's timeline.
 * Call this whenever a significant change happens to a contact.
 */
export async function logTimelineEvent(
  knex: any,
  params: {
    tenantId: string
    organizationId: string
    contactId: string
    eventType: string
    title: string
    description?: string
    metadata?: Record<string, any>
  }
) {
  const crypto = require('crypto')
  await knex('contact_timeline_events').insert({
    id: crypto.randomUUID(),
    tenant_id: params.tenantId,
    organization_id: params.organizationId,
    contact_id: params.contactId,
    event_type: params.eventType,
    title: params.title,
    description: params.description || null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    created_at: new Date(),
  }).catch((err: any) => console.error('[timeline] Failed to log event:', err?.message))
}
