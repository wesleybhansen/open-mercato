/**
 * Pre-made Automation Templates
 *
 * Ready-to-use workflow templates for common CRM use cases.
 * Each template can be instantiated as a workflow definition via the template gallery.
 */

export interface AutomationTemplateTrigger {
  type: string
  config?: Record<string, unknown>
}

export interface AutomationTemplateCondition {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists' | 'notExists' | 'in' | 'notIn'
  value?: unknown
}

export interface AutomationTemplateAction {
  type: 'send_email' | 'update_entity' | 'call_api' | 'emit_event' | 'call_webhook' | 'create_task' | 'wait' | 'execute_function'
  config: Record<string, unknown>
}

export interface AutomationTemplate {
  id: string
  name: string
  category: 'Sales' | 'Marketing' | 'Customer Success' | 'Operations' | 'Notifications'
  icon: string
  description: string
  trigger: AutomationTemplateTrigger
  conditions?: AutomationTemplateCondition[]
  actions: AutomationTemplateAction[]
  popular?: boolean
  tags?: string[]
}

// ---------------------------------------------------------------------------
// Sales Templates (12)
// ---------------------------------------------------------------------------

const salesTemplates: AutomationTemplate[] = [
  {
    id: 'sales-new-lead-welcome',
    name: 'Welcome New Leads',
    category: 'Sales',
    icon: 'UserPlus',
    description: 'Send a personalized welcome email when a new contact is created from a form submission.',
    trigger: { type: 'customers.person.created', config: { source: 'form' } },
    conditions: [{ field: 'primary_email', operator: 'exists' }],
    actions: [
      { type: 'send_email', config: { templateId: 'lead-welcome', subject: 'Welcome — here is what to expect' } },
    ],
    popular: true,
    tags: ['lead', 'email', 'onboarding'],
  },
  {
    id: 'sales-lead-assignment',
    name: 'Auto-Assign Leads by Region',
    category: 'Sales',
    icon: 'MapPin',
    description: 'Automatically assign new leads to the sales rep responsible for their region or territory.',
    trigger: { type: 'customers.person.created' },
    conditions: [{ field: 'country', operator: 'exists' }],
    actions: [
      { type: 'execute_function', config: { functionId: 'assign-lead-by-region', mapping: { country: '{{entity.country}}', state: '{{entity.state}}' } } },
    ],
    tags: ['lead', 'assignment', 'routing'],
  },
  {
    id: 'sales-deal-stage-notification',
    name: 'Notify on Deal Stage Change',
    category: 'Sales',
    icon: 'ArrowRightCircle',
    description: 'Send an internal notification to the deal owner whenever a deal moves to a new pipeline stage.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'changed_fields', operator: 'contains', value: 'stage' }],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.deal_stage_changed', payload: { dealId: '{{entity.id}}', newStage: '{{entity.stage}}', ownerId: '{{entity.owner_id}}' } } },
    ],
    popular: true,
    tags: ['deal', 'notification', 'pipeline'],
  },
  {
    id: 'sales-deal-won-followup',
    name: 'Deal Won Follow-Up',
    category: 'Sales',
    icon: 'Trophy',
    description: 'When a deal is marked as won, send a congratulations email to the customer and create an onboarding task.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'stage', operator: 'eq', value: 'won' }],
    actions: [
      { type: 'send_email', config: { templateId: 'deal-won-customer', subject: 'Welcome aboard!' } },
      { type: 'create_task', config: { title: 'Onboarding kickoff for {{entity.title}}', assignTo: '{{entity.owner_id}}', dueInDays: 3 } },
    ],
    popular: true,
    tags: ['deal', 'won', 'onboarding'],
  },
  {
    id: 'sales-deal-lost-feedback',
    name: 'Deal Lost Feedback Request',
    category: 'Sales',
    icon: 'MessageSquare',
    description: 'When a deal is lost, send a feedback survey to the contact and log a follow-up activity for the rep.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'stage', operator: 'eq', value: 'lost' }],
    actions: [
      { type: 'send_email', config: { templateId: 'deal-lost-feedback', subject: 'We would love your feedback' } },
      { type: 'create_task', config: { title: 'Log loss reason for {{entity.title}}', assignTo: '{{entity.owner_id}}', dueInDays: 1 } },
    ],
    tags: ['deal', 'lost', 'feedback'],
  },
  {
    id: 'sales-stale-deal-alert',
    name: 'Stale Deal Alert',
    category: 'Sales',
    icon: 'Clock',
    description: 'Alert the deal owner when a deal has not been updated in 14 days, preventing pipeline stagnation.',
    trigger: { type: 'schedule', config: { cron: '0 9 * * 1', description: 'Every Monday at 9 AM' } },
    conditions: [{ field: 'updated_at', operator: 'lt', value: '{{now-14d}}' }],
    actions: [
      { type: 'send_email', config: { templateId: 'stale-deal-reminder', subject: 'Your deal "{{entity.title}}" needs attention' } },
    ],
    popular: true,
    tags: ['deal', 'stale', 'reminder'],
  },
  {
    id: 'sales-quote-expiry-reminder',
    name: 'Quote Expiry Reminder',
    category: 'Sales',
    icon: 'FileText',
    description: 'Send a reminder to the customer 3 days before their quote expires so they can act in time.',
    trigger: { type: 'schedule', config: { cron: '0 8 * * *', description: 'Daily at 8 AM' } },
    conditions: [{ field: 'valid_until', operator: 'eq', value: '{{now+3d}}' }],
    actions: [
      { type: 'send_email', config: { templateId: 'quote-expiry-reminder', subject: 'Your quote expires in 3 days' } },
    ],
    tags: ['quote', 'reminder', 'expiry'],
  },
  {
    id: 'sales-high-value-deal-alert',
    name: 'High-Value Deal Alert',
    category: 'Sales',
    icon: 'DollarSign',
    description: 'Notify the sales manager immediately when a deal exceeding a configurable threshold is created.',
    trigger: { type: 'customers.deal.created' },
    conditions: [{ field: 'value', operator: 'gte', value: 10000 }],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.high_value_deal', payload: { dealId: '{{entity.id}}', value: '{{entity.value}}' } } },
    ],
    tags: ['deal', 'high-value', 'alert'],
  },
  {
    id: 'sales-order-confirmation',
    name: 'Order Confirmation Email',
    category: 'Sales',
    icon: 'ShoppingCart',
    description: 'Send an order confirmation email to the customer immediately after an order is created.',
    trigger: { type: 'sales.order.created' },
    conditions: [{ field: 'customer_email', operator: 'exists' }],
    actions: [
      { type: 'send_email', config: { templateId: 'order-confirmation', subject: 'Order #{{entity.order_number}} confirmed' } },
    ],
    tags: ['order', 'email', 'confirmation'],
  },
  {
    id: 'sales-invoice-overdue',
    name: 'Invoice Overdue Reminder',
    category: 'Sales',
    icon: 'AlertTriangle',
    description: 'Send payment reminders when an invoice is past due, with escalating urgency at 7, 14, and 30 days.',
    trigger: { type: 'schedule', config: { cron: '0 9 * * *', description: 'Daily at 9 AM' } },
    conditions: [{ field: 'status', operator: 'eq', value: 'sent' }, { field: 'due_date', operator: 'lt', value: '{{now}}' }],
    actions: [
      { type: 'send_email', config: { templateId: 'invoice-overdue', subject: 'Payment reminder: Invoice #{{entity.invoice_number}}' } },
    ],
    tags: ['invoice', 'overdue', 'payment'],
  },
  {
    id: 'sales-deal-activity-log',
    name: 'Auto-Log Deal Activity',
    category: 'Sales',
    icon: 'Activity',
    description: 'Automatically create an activity record whenever a deal stage changes, building a timeline without manual effort.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'changed_fields', operator: 'contains', value: 'stage' }],
    actions: [
      { type: 'call_api', config: { method: 'POST', path: '/api/activities', body: { type: 'stage_change', entityType: 'deal', entityId: '{{entity.id}}', description: 'Stage changed to {{entity.stage}}' } } },
    ],
    tags: ['deal', 'activity', 'logging'],
  },
  {
    id: 'sales-payment-received',
    name: 'Payment Received Notification',
    category: 'Sales',
    icon: 'CreditCard',
    description: 'Notify the sales rep and send a receipt to the customer when a payment is recorded against an invoice.',
    trigger: { type: 'sales.payment.created' },
    actions: [
      { type: 'send_email', config: { templateId: 'payment-receipt', subject: 'Payment received — thank you!' } },
      { type: 'emit_event', config: { eventId: 'notification.payment_received', payload: { invoiceId: '{{entity.invoice_id}}', amount: '{{entity.amount}}' } } },
    ],
    tags: ['payment', 'receipt', 'notification'],
  },
]

// ---------------------------------------------------------------------------
// Marketing Templates (10)
// ---------------------------------------------------------------------------

const marketingTemplates: AutomationTemplate[] = [
  {
    id: 'marketing-form-followup',
    name: 'Form Submission Follow-Up',
    category: 'Marketing',
    icon: 'FileInput',
    description: 'Send a follow-up email with a relevant resource immediately after a prospect fills out a form.',
    trigger: { type: 'customers.person.created', config: { source: 'form' } },
    conditions: [{ field: 'primary_email', operator: 'exists' }],
    actions: [
      { type: 'send_email', config: { templateId: 'form-followup', subject: 'Thanks for reaching out — here is what you asked for' } },
    ],
    tags: ['form', 'email', 'followup'],
  },
  {
    id: 'marketing-lead-scoring-update',
    name: 'Lead Score Update on Activity',
    category: 'Marketing',
    icon: 'TrendingUp',
    description: 'Increment a lead score when activities such as email opens, link clicks, or page visits are logged.',
    trigger: { type: 'customers.activity.created' },
    conditions: [{ field: 'type', operator: 'in', value: ['email_open', 'link_click', 'page_visit'] }],
    actions: [
      { type: 'execute_function', config: { functionId: 'update-lead-score', increment: 5 } },
    ],
    tags: ['lead-score', 'engagement', 'tracking'],
  },
  {
    id: 'marketing-hot-lead-notify',
    name: 'Hot Lead Sales Alert',
    category: 'Marketing',
    icon: 'Flame',
    description: 'Alert the assigned sales rep when a lead score crosses a threshold, indicating high buying intent.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'lead_score', operator: 'gte', value: 80 }],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.hot_lead', payload: { contactId: '{{entity.id}}', score: '{{entity.lead_score}}' } } },
      { type: 'create_task', config: { title: 'Follow up with hot lead: {{entity.first_name}} {{entity.last_name}}', dueInDays: 1 } },
    ],
    popular: true,
    tags: ['lead-score', 'hot-lead', 'alert'],
  },
  {
    id: 'marketing-tag-on-source',
    name: 'Auto-Tag by Lead Source',
    category: 'Marketing',
    icon: 'Tag',
    description: 'Automatically tag new contacts based on their acquisition source (e.g., "webinar", "referral", "ads").',
    trigger: { type: 'customers.person.created' },
    conditions: [{ field: 'source', operator: 'exists' }],
    actions: [
      { type: 'call_api', config: { method: 'POST', path: '/api/tags/assign', body: { entityId: '{{entity.id}}', entityType: 'person', tag: '{{entity.source}}' } } },
    ],
    tags: ['tag', 'source', 'segmentation'],
  },
  {
    id: 'marketing-re-engagement',
    name: 'Re-Engage Inactive Contacts',
    category: 'Marketing',
    icon: 'RefreshCw',
    description: 'Send a re-engagement email to contacts who have not interacted in 60 days.',
    trigger: { type: 'schedule', config: { cron: '0 10 * * 1', description: 'Every Monday at 10 AM' } },
    conditions: [{ field: 'last_activity_at', operator: 'lt', value: '{{now-60d}}' }],
    actions: [
      { type: 'send_email', config: { templateId: 're-engagement', subject: 'We miss you — here is what is new' } },
    ],
    tags: ['re-engagement', 'inactive', 'email'],
  },
  {
    id: 'marketing-company-enrichment',
    name: 'Enrich New Company Records',
    category: 'Marketing',
    icon: 'Building',
    description: 'Trigger a data enrichment webhook when a new company is added to populate industry, size, and revenue.',
    trigger: { type: 'customers.company.created' },
    actions: [
      { type: 'call_webhook', config: { url: '{{env.ENRICHMENT_WEBHOOK_URL}}', method: 'POST', body: { companyName: '{{entity.name}}', domain: '{{entity.website}}' } } },
    ],
    tags: ['enrichment', 'company', 'data'],
  },
  {
    id: 'marketing-new-deal-notify-marketing',
    name: 'Notify Marketing on New Deals',
    category: 'Marketing',
    icon: 'Bell',
    description: 'Keep marketing in the loop by notifying the team channel when a new deal is created from a marketing-sourced lead.',
    trigger: { type: 'customers.deal.created' },
    conditions: [{ field: 'source', operator: 'in', value: ['website', 'campaign', 'webinar', 'ads'] }],
    actions: [
      { type: 'call_webhook', config: { url: '{{env.MARKETING_SLACK_WEBHOOK}}', method: 'POST', body: { text: 'New deal from marketing: {{entity.title}} ({{entity.value}})' } } },
    ],
    tags: ['deal', 'marketing', 'slack'],
  },
  {
    id: 'marketing-product-interest-tag',
    name: 'Tag Contact on Product View',
    category: 'Marketing',
    icon: 'Eye',
    description: 'When a contact views a specific product page, tag them with the product interest for targeted follow-up.',
    trigger: { type: 'customers.activity.created', config: { activityType: 'page_visit' } },
    conditions: [{ field: 'metadata.url', operator: 'contains', value: '/products/' }],
    actions: [
      { type: 'call_api', config: { method: 'POST', path: '/api/tags/assign', body: { entityId: '{{entity.contact_id}}', entityType: 'person', tag: 'interested:{{entity.metadata.product_slug}}' } } },
    ],
    tags: ['product', 'interest', 'tracking'],
  },
  {
    id: 'marketing-duplicate-detection',
    name: 'Flag Potential Duplicate Contacts',
    category: 'Marketing',
    icon: 'Copy',
    description: 'Check for duplicate contacts by email when a new record is created and tag matches for manual review.',
    trigger: { type: 'customers.person.created' },
    conditions: [{ field: 'primary_email', operator: 'exists' }],
    actions: [
      { type: 'execute_function', config: { functionId: 'check-duplicate-contact', matchField: 'primary_email' } },
    ],
    tags: ['duplicate', 'data-quality', 'hygiene'],
  },
  {
    id: 'marketing-webinar-reminder',
    name: 'Webinar Reminder Sequence',
    category: 'Marketing',
    icon: 'Video',
    description: 'Send reminder emails at 24 hours, 1 hour, and 15 minutes before a scheduled webinar or event.',
    trigger: { type: 'customers.activity.created', config: { activityType: 'event_registration' } },
    actions: [
      { type: 'send_email', config: { templateId: 'webinar-reminder-24h', subject: 'Reminder: Your webinar is tomorrow', delayMinutes: 0 } },
      { type: 'wait', config: { durationMinutes: 1380 } },
      { type: 'send_email', config: { templateId: 'webinar-reminder-1h', subject: 'Starting in 1 hour: {{entity.metadata.event_name}}' } },
    ],
    tags: ['webinar', 'reminder', 'event'],
  },
]

// ---------------------------------------------------------------------------
// Customer Success Templates (9)
// ---------------------------------------------------------------------------

const customerSuccessTemplates: AutomationTemplate[] = [
  {
    id: 'cs-welcome-onboarding',
    name: 'Customer Welcome Sequence',
    category: 'Customer Success',
    icon: 'Heart',
    description: 'Send a multi-step welcome sequence when a deal is won: day-0 welcome, day-3 tips, day-7 check-in.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'stage', operator: 'eq', value: 'won' }],
    actions: [
      { type: 'send_email', config: { templateId: 'welcome-day0', subject: 'Welcome to the team!' } },
      { type: 'wait', config: { durationMinutes: 4320 } },
      { type: 'send_email', config: { templateId: 'welcome-day3', subject: 'Getting started — 3 tips for success' } },
      { type: 'wait', config: { durationMinutes: 5760 } },
      { type: 'send_email', config: { templateId: 'welcome-day7', subject: 'How is everything going?' } },
    ],
    popular: true,
    tags: ['onboarding', 'welcome', 'sequence'],
  },
  {
    id: 'cs-quarterly-checkin',
    name: 'Quarterly Check-In Reminder',
    category: 'Customer Success',
    icon: 'Calendar',
    description: 'Create a task for the account owner to schedule a quarterly business review with each active customer.',
    trigger: { type: 'schedule', config: { cron: '0 9 1 1,4,7,10 *', description: 'First day of each quarter at 9 AM' } },
    actions: [
      { type: 'create_task', config: { title: 'Quarterly check-in with {{entity.name}}', assignTo: '{{entity.owner_id}}', dueInDays: 14 } },
    ],
    tags: ['check-in', 'quarterly', 'task'],
  },
  {
    id: 'cs-nps-followup',
    name: 'NPS Response Follow-Up',
    category: 'Customer Success',
    icon: 'ThumbsUp',
    description: 'Route NPS responses: thank promoters, create urgent tasks for detractors, and send surveys to passives.',
    trigger: { type: 'customers.activity.created', config: { activityType: 'nps_response' } },
    conditions: [{ field: 'metadata.score', operator: 'exists' }],
    actions: [
      { type: 'execute_function', config: { functionId: 'route-nps-response', scoreField: 'metadata.score' } },
    ],
    tags: ['nps', 'feedback', 'satisfaction'],
  },
  {
    id: 'cs-renewal-reminder-60d',
    name: 'Renewal Reminder (60 Days)',
    category: 'Customer Success',
    icon: 'RotateCcw',
    description: 'Alert the account manager and send a customer email 60 days before a contract or subscription renews.',
    trigger: { type: 'schedule', config: { cron: '0 8 * * *', description: 'Daily at 8 AM' } },
    conditions: [{ field: 'renewal_date', operator: 'eq', value: '{{now+60d}}' }],
    actions: [
      { type: 'send_email', config: { templateId: 'renewal-reminder', subject: 'Your renewal is coming up in 60 days' } },
      { type: 'create_task', config: { title: 'Prepare renewal for {{entity.name}}', assignTo: '{{entity.owner_id}}', dueInDays: 30 } },
    ],
    tags: ['renewal', 'reminder', 'subscription'],
  },
  {
    id: 'cs-upsell-trigger',
    name: 'Upsell Opportunity Detection',
    category: 'Customer Success',
    icon: 'TrendingUp',
    description: 'Notify the account manager when a customer hits a usage threshold that suggests they may benefit from upgrading.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'usage_count', operator: 'gte', value: 1000 }],
    actions: [
      { type: 'create_task', config: { title: 'Upsell opportunity: {{entity.name}} hit usage threshold', assignTo: '{{entity.owner_id}}', dueInDays: 5 } },
      { type: 'emit_event', config: { eventId: 'notification.upsell_opportunity', payload: { contactId: '{{entity.id}}', usage: '{{entity.usage_count}}' } } },
    ],
    tags: ['upsell', 'usage', 'growth'],
  },
  {
    id: 'cs-churn-risk-alert',
    name: 'Churn Risk Detection',
    category: 'Customer Success',
    icon: 'AlertOctagon',
    description: 'Flag accounts showing churn signals (no login in 30 days, support tickets up, engagement down) and alert the CSM.',
    trigger: { type: 'schedule', config: { cron: '0 8 * * 1', description: 'Every Monday at 8 AM' } },
    conditions: [{ field: 'last_login_at', operator: 'lt', value: '{{now-30d}}' }],
    actions: [
      { type: 'create_task', config: { title: 'Churn risk: {{entity.name}} — reach out ASAP', assignTo: '{{entity.owner_id}}', dueInDays: 2, priority: 'high' } },
      { type: 'update_entity', config: { entityType: 'person', field: 'tags', operation: 'add', value: 'churn-risk' } },
    ],
    tags: ['churn', 'risk', 'retention'],
  },
  {
    id: 'cs-support-ticket-escalation',
    name: 'Support Ticket Escalation',
    category: 'Customer Success',
    icon: 'ArrowUpCircle',
    description: 'Escalate a support-related activity to the customer success manager if it remains unresolved after 48 hours.',
    trigger: { type: 'customers.activity.updated' },
    conditions: [
      { field: 'type', operator: 'eq', value: 'support_ticket' },
      { field: 'status', operator: 'neq', value: 'resolved' },
      { field: 'created_at', operator: 'lt', value: '{{now-48h}}' },
    ],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.ticket_escalation', payload: { activityId: '{{entity.id}}', contactId: '{{entity.contact_id}}' } } },
    ],
    tags: ['support', 'escalation', 'sla'],
  },
  {
    id: 'cs-onboarding-completion',
    name: 'Onboarding Completion Check',
    category: 'Customer Success',
    icon: 'CheckCircle',
    description: 'Check if a customer has completed onboarding steps within 14 days and send a nudge if not.',
    trigger: { type: 'schedule', config: { cron: '0 9 * * *', description: 'Daily at 9 AM' } },
    conditions: [
      { field: 'onboarding_completed', operator: 'eq', value: false },
      { field: 'created_at', operator: 'lt', value: '{{now-14d}}' },
    ],
    actions: [
      { type: 'send_email', config: { templateId: 'onboarding-nudge', subject: 'Need help getting started?' } },
      { type: 'create_task', config: { title: 'Onboarding incomplete: {{entity.name}} — assist customer', assignTo: '{{entity.owner_id}}', dueInDays: 3 } },
    ],
    tags: ['onboarding', 'completion', 'nudge'],
  },
  {
    id: 'cs-anniversary-email',
    name: 'Customer Anniversary Email',
    category: 'Customer Success',
    icon: 'Gift',
    description: 'Send a personalized anniversary email on the yearly anniversary of becoming a customer.',
    trigger: { type: 'schedule', config: { cron: '0 9 * * *', description: 'Daily at 9 AM' } },
    conditions: [{ field: 'customer_since', operator: 'eq', value: '{{now-anniversary}}' }],
    actions: [
      { type: 'send_email', config: { templateId: 'customer-anniversary', subject: 'Happy anniversary! Thank you for {{years}} years' } },
    ],
    tags: ['anniversary', 'retention', 'loyalty'],
  },
]

// ---------------------------------------------------------------------------
// Operations Templates (9)
// ---------------------------------------------------------------------------

const operationsTemplates: AutomationTemplate[] = [
  {
    id: 'ops-task-from-comment',
    name: 'Create Task from Comment',
    category: 'Operations',
    icon: 'MessageCircle',
    description: 'Automatically create a follow-up task when a comment containing "TODO" or "ACTION" is added to any record.',
    trigger: { type: 'customers.comment.created' },
    conditions: [{ field: 'body', operator: 'contains', value: 'TODO' }],
    actions: [
      { type: 'create_task', config: { title: 'Follow up: {{entity.body}}', assignTo: '{{entity.author_id}}', dueInDays: 3 } },
    ],
    tags: ['task', 'comment', 'productivity'],
  },
  {
    id: 'ops-missing-email-flag',
    name: 'Flag Contacts Missing Email',
    category: 'Operations',
    icon: 'AlertCircle',
    description: 'Tag contacts that are missing an email address so the team can prioritize data cleanup.',
    trigger: { type: 'customers.person.created' },
    conditions: [{ field: 'primary_email', operator: 'notExists' }],
    actions: [
      { type: 'call_api', config: { method: 'POST', path: '/api/tags/assign', body: { entityId: '{{entity.id}}', entityType: 'person', tag: 'missing-email' } } },
    ],
    tags: ['data-quality', 'hygiene', 'email'],
  },
  {
    id: 'ops-incomplete-company-alert',
    name: 'Incomplete Company Profile Alert',
    category: 'Operations',
    icon: 'Building2',
    description: 'Alert the owner when a company record is created without key fields like industry, phone, or website.',
    trigger: { type: 'customers.company.created' },
    conditions: [{ field: 'industry', operator: 'notExists' }],
    actions: [
      { type: 'create_task', config: { title: 'Complete company profile: {{entity.name}}', assignTo: '{{entity.owner_id}}', dueInDays: 5 } },
    ],
    tags: ['data-quality', 'company', 'completeness'],
  },
  {
    id: 'ops-daily-pipeline-summary',
    name: 'Daily Pipeline Summary',
    category: 'Operations',
    icon: 'BarChart3',
    description: 'Send a daily digest email to sales managers summarizing new deals, stage changes, and total pipeline value.',
    trigger: { type: 'schedule', config: { cron: '0 8 * * 1-5', description: 'Weekdays at 8 AM' } },
    actions: [
      { type: 'execute_function', config: { functionId: 'generate-pipeline-summary' } },
      { type: 'send_email', config: { templateId: 'daily-pipeline-summary', subject: 'Pipeline Summary — {{date}}' } },
    ],
    tags: ['reporting', 'pipeline', 'summary'],
  },
  {
    id: 'ops-weekly-activity-report',
    name: 'Weekly Activity Report',
    category: 'Operations',
    icon: 'FileBarChart',
    description: 'Generate and email a weekly activity report showing calls, emails, meetings, and tasks per rep.',
    trigger: { type: 'schedule', config: { cron: '0 9 * * 5', description: 'Every Friday at 9 AM' } },
    actions: [
      { type: 'execute_function', config: { functionId: 'generate-activity-report', period: 'weekly' } },
      { type: 'send_email', config: { templateId: 'weekly-activity-report', subject: 'Weekly Activity Report — Week of {{date}}' } },
    ],
    tags: ['reporting', 'activity', 'weekly'],
  },
  {
    id: 'ops-order-status-sync',
    name: 'Sync Order Status to External System',
    category: 'Operations',
    icon: 'RefreshCw',
    description: 'Push order status changes to an external ERP or fulfillment system via webhook.',
    trigger: { type: 'sales.order.updated' },
    conditions: [{ field: 'changed_fields', operator: 'contains', value: 'status' }],
    actions: [
      { type: 'call_webhook', config: { url: '{{env.ERP_WEBHOOK_URL}}', method: 'POST', body: { orderId: '{{entity.id}}', orderNumber: '{{entity.order_number}}', status: '{{entity.status}}' } } },
    ],
    tags: ['integration', 'erp', 'sync'],
  },
  {
    id: 'ops-shipment-tracking-update',
    name: 'Shipment Status Customer Update',
    category: 'Operations',
    icon: 'Truck',
    description: 'Notify the customer by email whenever a shipment status changes (dispatched, in transit, delivered).',
    trigger: { type: 'sales.shipment.updated' },
    conditions: [{ field: 'changed_fields', operator: 'contains', value: 'status' }],
    actions: [
      { type: 'send_email', config: { templateId: 'shipment-status-update', subject: 'Shipment update: {{entity.status}}' } },
    ],
    tags: ['shipment', 'tracking', 'notification'],
  },
  {
    id: 'ops-return-processing',
    name: 'Return Request Processing',
    category: 'Operations',
    icon: 'CornerUpLeft',
    description: 'When a return is created, notify the warehouse team and create a task for quality review.',
    trigger: { type: 'sales.return.created' },
    actions: [
      { type: 'call_webhook', config: { url: '{{env.WAREHOUSE_WEBHOOK_URL}}', method: 'POST', body: { returnId: '{{entity.id}}', orderId: '{{entity.order_id}}' } } },
      { type: 'create_task', config: { title: 'Quality review for return #{{entity.id}}', dueInDays: 3 } },
    ],
    tags: ['return', 'warehouse', 'processing'],
  },
  {
    id: 'ops-product-low-stock',
    name: 'Low Stock Alert',
    category: 'Operations',
    icon: 'Package',
    description: 'Alert operations when a product stock level drops below a minimum threshold after an order is placed.',
    trigger: { type: 'catalog.product.updated' },
    conditions: [{ field: 'stock_quantity', operator: 'lte', value: 10 }],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.low_stock', payload: { productId: '{{entity.id}}', productName: '{{entity.name}}', stock: '{{entity.stock_quantity}}' } } },
      { type: 'call_webhook', config: { url: '{{env.INVENTORY_WEBHOOK_URL}}', method: 'POST', body: { productId: '{{entity.id}}', action: 'reorder_alert' } } },
    ],
    tags: ['inventory', 'low-stock', 'alert'],
  },
]

// ---------------------------------------------------------------------------
// Notification Templates (6)
// ---------------------------------------------------------------------------

const notificationTemplates: AutomationTemplate[] = [
  {
    id: 'notify-new-deal-team',
    name: 'New Deal Team Notification',
    category: 'Notifications',
    icon: 'Users',
    description: 'Send an in-app and Slack notification to the whole sales team when any new deal is created.',
    trigger: { type: 'customers.deal.created' },
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.new_deal', payload: { dealId: '{{entity.id}}', title: '{{entity.title}}', value: '{{entity.value}}' } } },
      { type: 'call_webhook', config: { url: '{{env.SALES_SLACK_WEBHOOK}}', method: 'POST', body: { text: 'New deal: {{entity.title}} (${{entity.value}})' } } },
    ],
    tags: ['deal', 'team', 'slack'],
  },
  {
    id: 'notify-manager-large-discount',
    name: 'Manager Alert on Large Discounts',
    category: 'Notifications',
    icon: 'Shield',
    description: 'Require manager attention when a quote or order has a discount exceeding 20%, flagging potential margin erosion.',
    trigger: { type: 'sales.quote.created' },
    conditions: [{ field: 'discount_percent', operator: 'gt', value: 20 }],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.large_discount', payload: { documentId: '{{entity.id}}', discount: '{{entity.discount_percent}}' } } },
      { type: 'create_task', config: { title: 'Review discount on quote #{{entity.document_number}}: {{entity.discount_percent}}% off', assignTo: '{{entity.manager_id}}', dueInDays: 1, priority: 'high' } },
    ],
    tags: ['discount', 'approval', 'manager'],
  },
  {
    id: 'notify-customer-order-shipped',
    name: 'Customer Shipment Notification',
    category: 'Notifications',
    icon: 'Send',
    description: 'Email the customer with tracking details as soon as their order is marked as shipped.',
    trigger: { type: 'sales.shipment.created' },
    conditions: [{ field: 'tracking_number', operator: 'exists' }],
    actions: [
      { type: 'send_email', config: { templateId: 'order-shipped', subject: 'Your order has shipped! Track it here.' } },
    ],
    tags: ['shipment', 'customer', 'tracking'],
  },
  {
    id: 'notify-escalation-sla-breach',
    name: 'SLA Breach Escalation',
    category: 'Notifications',
    icon: 'Siren',
    description: 'Escalate to management when a user task or activity breaches its SLA (e.g., task overdue by 24 hours).',
    trigger: { type: 'schedule', config: { cron: '0 */2 * * *', description: 'Every 2 hours' } },
    conditions: [
      { field: 'status', operator: 'neq', value: 'completed' },
      { field: 'due_date', operator: 'lt', value: '{{now-24h}}' },
    ],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.sla_breach', payload: { taskId: '{{entity.id}}', assignee: '{{entity.assigned_to}}' } } },
      { type: 'update_entity', config: { entityType: 'task', field: 'priority', value: 'critical' } },
    ],
    tags: ['sla', 'escalation', 'overdue'],
  },
  {
    id: 'notify-daily-task-digest',
    name: 'Daily Task Digest',
    category: 'Notifications',
    icon: 'ListChecks',
    description: 'Send each user an email summary of their open tasks and upcoming deadlines every morning.',
    trigger: { type: 'schedule', config: { cron: '0 7 * * 1-5', description: 'Weekdays at 7 AM' } },
    actions: [
      { type: 'execute_function', config: { functionId: 'generate-task-digest' } },
      { type: 'send_email', config: { templateId: 'daily-task-digest', subject: 'Your tasks for today — {{date}}' } },
    ],
    tags: ['digest', 'tasks', 'daily'],
  },
  {
    id: 'notify-contact-assigned',
    name: 'Contact Assignment Notification',
    category: 'Notifications',
    icon: 'UserCheck',
    description: 'Notify a team member when a contact or company is assigned to them, with context about the record.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'changed_fields', operator: 'contains', value: 'owner_id' }],
    actions: [
      { type: 'emit_event', config: { eventId: 'notification.contact_assigned', payload: { contactId: '{{entity.id}}', newOwnerId: '{{entity.owner_id}}' } } },
    ],
    tags: ['assignment', 'notification', 'contact'],
  },
]

// ---------------------------------------------------------------------------
// All Templates
// ---------------------------------------------------------------------------

export const automationTemplates: AutomationTemplate[] = [
  ...salesTemplates,
  ...marketingTemplates,
  ...customerSuccessTemplates,
  ...operationsTemplates,
  ...notificationTemplates,
]

// ---------------------------------------------------------------------------
// Recommended / Most Popular (shown first in the gallery)
// ---------------------------------------------------------------------------

export const recommendedTemplateIds: string[] = [
  'sales-new-lead-welcome',
  'sales-deal-won-followup',
  'sales-stale-deal-alert',
  'sales-deal-stage-notification',
  'marketing-hot-lead-notify',
  'cs-welcome-onboarding',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getTemplateById(id: string): AutomationTemplate | undefined {
  return automationTemplates.find((t) => t.id === id)
}

export function getTemplatesByCategory(category: AutomationTemplate['category']): AutomationTemplate[] {
  return automationTemplates.filter((t) => t.category === category)
}

export function getRecommendedTemplates(): AutomationTemplate[] {
  return recommendedTemplateIds
    .map((id) => automationTemplates.find((t) => t.id === id))
    .filter((t): t is AutomationTemplate => t !== undefined)
}

export function getPopularTemplates(): AutomationTemplate[] {
  return automationTemplates.filter((t) => t.popular)
}

export function searchTemplates(query: string): AutomationTemplate[] {
  const lower = query.toLowerCase()
  return automationTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(lower)),
  )
}
