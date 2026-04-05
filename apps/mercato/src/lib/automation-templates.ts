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
  type: 'send_email' | 'update_entity' | 'call_api' | 'emit_event' | 'call_webhook' | 'create_task' | 'wait' | 'execute_function' | 'add_tag' | 'remove_tag' | 'move_to_stage' | 'enroll_in_sequence' | 'add_to_list'
  config: Record<string, unknown>
}

export interface AutomationTemplate {
  id: string
  name: string
  category: 'Sales' | 'Marketing' | 'Customer Success' | 'Operations' | 'Notifications' | 'Solopreneur'
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
      { type: 'add_tag', config: { tagName: '{{entity.source}}' } },
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
      { type: 'add_tag', config: { tagName: 'product-interest' } },
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
      { type: 'add_tag', config: { tagName: 'missing-email' } },
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
// Solopreneur & Small Biz Templates (15)
// ---------------------------------------------------------------------------

const solopreneurTemplates: AutomationTemplate[] = [
  {
    id: 'solo-quick-inquiry-response',
    name: 'Quick Response to New Inquiry',
    category: 'Solopreneur',
    icon: 'Zap',
    description: 'Instantly send a friendly "thanks for reaching out" email when someone fills out your contact form, so they know you got their message.',
    trigger: { type: 'customers.person.created' },
    conditions: [{ field: 'primary_email', operator: 'exists' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Got your message! I will be in touch soon',
          body: 'Hi {{entity.first_name}},\n\nThanks so much for reaching out! I wanted to let you know I received your message and I will get back to you within 24 hours.\n\nIn the meantime, feel free to reply to this email if you have any additional details to share.\n\nTalk soon!\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['inquiry', 'response', 'lead', 'intake'],
  },
  {
    id: 'solo-post-consultation-followup',
    name: 'Post-Consultation Follow-Up',
    category: 'Solopreneur',
    icon: 'MessageSquare',
    description: 'After a consultation or discovery call, automatically send a follow-up email the next day to keep the conversation going.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'consulted' }],
    actions: [
      { type: 'wait', config: { durationMinutes: 1440 } },
      {
        type: 'send_email',
        config: {
          subject: 'Great chatting with you yesterday!',
          body: 'Hi {{entity.first_name}},\n\nIt was really great talking with you yesterday. I enjoyed learning about what you are working on and I think there are some solid ways I can help.\n\nI have been thinking about what we discussed and I have a few ideas I would love to share. Would you be open to a quick follow-up call this week?\n\nJust reply to this email or grab a time on my calendar: {{sender.booking_url}}\n\nLooking forward to it!\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['consultation', 'followup', 'booking'],
  },
  {
    id: 'solo-proposal-followup',
    name: 'Proposal Follow-Up Reminder',
    category: 'Solopreneur',
    icon: 'FileText',
    description: 'When you tag a contact as "proposal-sent", this waits 3 days then sends a gentle check-in so your proposal does not get lost in their inbox.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'proposal-sent' }],
    actions: [
      { type: 'wait', config: { durationMinutes: 4320 } },
      {
        type: 'send_email',
        config: {
          subject: 'Quick follow-up on my proposal',
          body: 'Hi {{entity.first_name}},\n\nI just wanted to check in on the proposal I sent over a few days ago. I know things get busy, so no pressure at all.\n\nIf you have any questions or want to adjust anything, I am happy to hop on a quick call. I want to make sure the scope and pricing feel right for you.\n\nJust hit reply and let me know what you are thinking!\n\nBest,\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['proposal', 'followup', 'sales'],
  },
  {
    id: 'solo-payment-thankyou',
    name: 'Payment Thank You + Review Request',
    category: 'Solopreneur',
    icon: 'Heart',
    description: 'When an invoice is paid, automatically send a warm thank-you email and ask if they would be willing to leave a review.',
    trigger: { type: 'sales.payment.created' },
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Thank you for your payment!',
          body: 'Hi {{entity.customer_name}},\n\nI just wanted to send a quick thank you for your payment. I really appreciate your business and it is a pleasure working with you.\n\nIf you have a moment, it would mean the world to me if you could leave a short review about your experience. It helps other people find me and honestly, it makes my day.\n\n{{sender.review_url}}\n\nThank you again!\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['payment', 'thankyou', 'review'],
  },
  {
    id: 'solo-appointment-confirmation',
    name: 'Appointment Confirmation',
    category: 'Solopreneur',
    icon: 'Calendar',
    description: 'Send a confirmation email right after a booking is created, with details about what to expect and how to prepare.',
    trigger: { type: 'customers.activity.created', config: { activityType: 'meeting' } },
    conditions: [{ field: 'contact_id', operator: 'exists' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'You are all booked! Here are the details',
          body: 'Hi {{entity.contact_name}},\n\nYour appointment is confirmed! Here is what you need to know:\n\nDate: {{entity.scheduled_at}}\nDuration: {{entity.duration}} minutes\n\nA few things to prepare:\n- Have any relevant documents or questions ready\n- Make sure you are in a quiet spot if we are meeting virtually\n\nIf you need to reschedule, just reply to this email and we will figure it out.\n\nSee you soon!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['booking', 'confirmation', 'appointment'],
  },
  {
    id: 'solo-project-kickoff',
    name: 'Project Kickoff Checklist',
    category: 'Solopreneur',
    icon: 'CheckSquare',
    description: 'When you win a deal, automatically create your standard kickoff tasks: send the contract, schedule the kickoff call, and set up the project.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'stage', operator: 'eq', value: 'won' }],
    actions: [
      { type: 'create_task', config: { title: 'Send contract to {{entity.contact_name}}', dueInDays: 1 } },
      { type: 'create_task', config: { title: 'Schedule kickoff call for {{entity.title}}', dueInDays: 2 } },
      { type: 'create_task', config: { title: 'Set up project folder for {{entity.title}}', dueInDays: 2 } },
    ],
    tags: ['project', 'kickoff', 'tasks', 'deal-won'],
  },
  {
    id: 'solo-referral-request',
    name: 'Ask for a Referral',
    category: 'Solopreneur',
    icon: 'Users',
    description: 'A week after you mark a project as complete, send a friendly email asking if they know anyone else who could use your services.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'project-complete' }],
    actions: [
      { type: 'wait', config: { durationMinutes: 10080 } },
      {
        type: 'send_email',
        config: {
          subject: 'Know anyone who could use some help?',
          body: 'Hi {{entity.first_name}},\n\nI hope you are loving the results from our work together! It was a real pleasure.\n\nI have a small favor to ask. If you know anyone who might benefit from similar help, I would be so grateful if you could pass along my name. Word of mouth is how I get most of my clients, and a recommendation from you would mean a lot.\n\nNo pressure at all, of course. And if there is ever anything else I can help you with down the road, do not hesitate to reach out.\n\nThank you!\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['referral', 'word-of-mouth', 'post-project'],
  },
  {
    id: 'solo-happy-birthday',
    name: 'Happy Birthday Email',
    category: 'Solopreneur',
    icon: 'Gift',
    description: 'Send a personal birthday email to your clients. A small touch that makes a big impression and keeps you top of mind.',
    trigger: { type: 'schedule', config: { cron: '0 9 * * *', description: 'Daily at 9 AM' } },
    conditions: [{ field: 'date_of_birth', operator: 'eq', value: '{{now-birthday}}' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Happy Birthday, {{entity.first_name}}!',
          body: 'Hi {{entity.first_name}},\n\nHappy Birthday! I hope you have an amazing day.\n\nJust wanted to send a quick note to let you know I am thinking of you. Wishing you a wonderful year ahead!\n\nCheers,\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['birthday', 'personal-touch', 'retention'],
  },
  {
    id: 'solo-new-student-welcome',
    name: 'New Student Welcome',
    category: 'Solopreneur',
    icon: 'GraduationCap',
    description: 'When someone enrolls in your course or program, send them a welcome email and create a task to check in on their progress.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'enrolled' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Welcome aboard! Here is how to get started',
          body: 'Hi {{entity.first_name}},\n\nWelcome! I am so excited to have you on board.\n\nHere is what to do first:\n1. Log in to your account and check out the first module\n2. Join our community group where you can ask questions and connect with other students\n3. Block out some time this week to go through the first lesson\n\nRemember, I am here to help. If you get stuck or have questions, just reply to this email.\n\nLet us do this!\n{{sender.first_name}}',
        },
      },
      { type: 'create_task', config: { title: 'Check in on {{entity.first_name}} — 1 week after enrollment', dueInDays: 7 } },
    ],
    tags: ['course', 'enrollment', 'welcome', 'onboarding'],
  },
  {
    id: 'solo-review-request-delayed',
    name: 'Review Request (2 Weeks After Payment)',
    category: 'Solopreneur',
    icon: 'Star',
    description: 'Two weeks after a client pays, send a friendly request to leave a review on Google, Yelp, or your preferred platform.',
    trigger: { type: 'sales.payment.created' },
    actions: [
      { type: 'wait', config: { durationMinutes: 20160 } },
      {
        type: 'send_email',
        config: {
          subject: 'Would you mind leaving a quick review?',
          body: 'Hi {{entity.customer_name}},\n\nI hope things are going well! I wanted to follow up and see how everything is working out.\n\nIf you have had a good experience, would you mind taking 2 minutes to leave a quick review? It really helps my business and helps other people decide if I am a good fit for them.\n\nHere is the link: {{sender.review_url}}\n\nEven just a sentence or two makes a huge difference. Thank you so much!\n\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['review', 'testimonial', 'reputation'],
  },
  {
    id: 'solo-dormant-client-checkin',
    name: 'Dormant Client Check-In',
    category: 'Solopreneur',
    icon: 'RefreshCw',
    description: 'Automatically reach out to clients you have not been in touch with for 90 days. A simple "thinking of you" keeps the relationship warm.',
    trigger: { type: 'schedule', config: { cron: '0 10 * * 1', description: 'Every Monday at 10 AM' } },
    conditions: [{ field: 'last_activity_at', operator: 'lt', value: '{{now-90d}}' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'It has been a while! How are things going?',
          body: 'Hi {{entity.first_name}},\n\nI realized it has been a few months since we last connected and I wanted to check in. How is everything going?\n\nI have been working on some new things and would love to catch up. If you are ever looking for help again or just want to chat, my door is always open.\n\nHope to hear from you!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['re-engagement', 'dormant', 'retention', 'check-in'],
  },
  {
    id: 'solo-web-lead-auto-tag',
    name: 'Auto-Tag Website Leads',
    category: 'Solopreneur',
    icon: 'Tag',
    description: 'When a new contact comes in from your website, automatically tag them as "web-lead" so you can easily filter and follow up with website inquiries.',
    trigger: { type: 'customers.person.created', config: { source: 'website' } },
    actions: [
      { type: 'add_tag', config: { tagName: 'web-lead' } },
    ],
    tags: ['tag', 'lead-source', 'website', 'organization'],
  },
  {
    id: 'solo-vip-client-alert',
    name: 'VIP Client Alert',
    category: 'Solopreneur',
    icon: 'Star',
    description: 'When a client pays an invoice over a certain amount, automatically tag them as a VIP and create a task to send a personal thank-you note.',
    trigger: { type: 'sales.payment.created' },
    conditions: [{ field: 'amount', operator: 'gte', value: 1000 }],
    actions: [
      { type: 'add_tag', config: { tagName: 'vip' } },
      { type: 'create_task', config: { title: 'Send personal thank-you to VIP client', dueInDays: 1 } },
    ],
    tags: ['vip', 'high-value', 'thank-you'],
  },
  {
    id: 'solo-missed-call-followup',
    name: 'Missed Call Follow-Up',
    category: 'Solopreneur',
    icon: 'Phone',
    description: 'When you tag a contact as "missed-call", immediately send them an email so they know you saw their call and will get back to them.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'missed-call' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Sorry I missed your call!',
          body: 'Hi {{entity.first_name}},\n\nI am sorry I was not able to pick up just now. I saw your call and did not want to leave you hanging.\n\nI will try to call you back shortly. If it is easier, you can also reply to this email or book a time that works for you: {{sender.booking_url}}\n\nTalk soon!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['missed-call', 'response', 'phone'],
  },
  {
    id: 'solo-service-completion-survey',
    name: 'Service Completion Survey',
    category: 'Solopreneur',
    icon: 'ClipboardCheck',
    description: 'Two days after marking a service as complete, send a short satisfaction survey to learn what went well and what you can improve.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'service-complete' }],
    actions: [
      { type: 'wait', config: { durationMinutes: 2880 } },
      {
        type: 'send_email',
        config: {
          subject: 'How did everything go?',
          body: 'Hi {{entity.first_name}},\n\nNow that we have wrapped up, I would love to hear how everything went for you. Your feedback helps me get better at what I do.\n\nWould you mind taking 60 seconds to answer a few quick questions?\n\n{{sender.survey_url}}\n\nWhether it is praise or constructive feedback, I genuinely want to hear it. Thank you for trusting me with your project!\n\nAll the best,\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['survey', 'feedback', 'service-complete'],
  },
  {
    id: 'solo-event-rsvp-nurture',
    name: 'Event RSVP Nurture Sequence',
    category: 'Solopreneur',
    icon: 'Calendar',
    description: 'When someone registers for your event, tag them and add them to your Events mailing list, then send a prep email 2 days before to build excitement.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'event-registered' }],
    actions: [
      { type: 'add_to_list', config: { listName: 'Event Attendees' } },
      { type: 'wait', config: { durationMinutes: 2880 } },
      {
        type: 'send_email',
        config: {
          subject: 'Getting ready for the event!',
          body: 'Hi {{entity.first_name}},\n\nThe event is coming up soon and I wanted to make sure you are all set!\n\nHere are a few things to keep in mind:\n- Save the date and add it to your calendar\n- Come with questions — I love when people engage\n- Share it with a friend who might get value from it\n\nI am really looking forward to seeing you there.\n\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['event', 'rsvp', 'nurture', 'mailing-list'],
  },
  {
    id: 'solo-course-completion-upsell',
    name: 'Course Completion Upsell',
    category: 'Solopreneur',
    icon: 'GraduationCap',
    description: 'When a student completes your course (tagged "course-complete"), wait 3 days then offer your next-level program or 1-on-1 coaching.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'course-complete' }],
    actions: [
      { type: 'wait', config: { durationMinutes: 4320 } },
      {
        type: 'send_email',
        config: {
          subject: 'Congrats on finishing! What is next?',
          body: 'Hi {{entity.first_name}},\n\nFirst off — huge congrats on completing the course! That takes real commitment and you should be proud.\n\nNow that you have the foundation down, I wanted to let you know about the next step: my advanced program where we go deeper and I work with you more closely.\n\nIt is perfect if you:\n- Want personalized feedback on your progress\n- Are ready to accelerate your results\n- Want access to a tight-knit community of action-takers\n\nInterested? Just reply to this email and I will send you the details.\n\nKeep up the great work!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['course', 'upsell', 'completion', 'coaching'],
  },
  {
    id: 'solo-booking-no-show-followup',
    name: 'Booking No-Show Follow-Up',
    category: 'Solopreneur',
    icon: 'Clock',
    description: 'When you tag a contact as "no-show" after a missed appointment, send a friendly email with a link to reschedule instead of letting them slip away.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'no-show' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'We missed you! Let us reschedule',
          body: 'Hi {{entity.first_name}},\n\nI noticed we were not able to connect for our scheduled call. No worries at all — life happens!\n\nI would still love to chat. Here is a link to grab a new time that works better for you: {{sender.booking_url}}\n\nIf your plans have changed or you have any questions, feel free to reply to this email.\n\nHope to connect soon!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['booking', 'no-show', 'reschedule'],
  },
  {
    id: 'solo-new-subscriber-welcome-sequence',
    name: 'New Subscriber Welcome Series',
    category: 'Solopreneur',
    icon: 'Mail',
    description: 'When a contact is added to your main mailing list, kick off a 3-email welcome series: intro, your best content, and a soft pitch.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'subscriber' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Welcome! Here is what to expect',
          body: 'Hi {{entity.first_name}},\n\nThanks for subscribing! I am glad you are here.\n\nHere is what you can expect from me:\n- Practical tips you can use right away\n- Behind-the-scenes insights from my work\n- Occasional offers on my products and services\n\nI keep things short, useful, and no-spam. If you ever want to chat, just hit reply — I read every email.\n\nWelcome aboard!\n{{sender.first_name}}',
        },
      },
      { type: 'wait', config: { durationMinutes: 2880 } },
      {
        type: 'send_email',
        config: {
          subject: 'My most popular resource (it is free)',
          body: 'Hi {{entity.first_name}},\n\nI wanted to share something my subscribers consistently tell me is the most helpful thing I have put out. It covers the foundations and gives you a clear starting point.\n\nCheck it out here: {{sender.resource_url}}\n\nLet me know what you think — I love hearing what resonates with people.\n\n{{sender.first_name}}',
        },
      },
      { type: 'wait', config: { durationMinutes: 4320 } },
      {
        type: 'send_email',
        config: {
          subject: 'Quick question for you',
          body: 'Hi {{entity.first_name}},\n\nI have a quick question: what is the biggest challenge you are facing right now in your business or project?\n\nI ask because I want to make sure what I send you is actually useful. Plus, if I can help directly, I would love to.\n\nJust hit reply and let me know. Even a one-liner helps!\n\n{{sender.first_name}}',
        },
      },
    ],
    popular: true,
    tags: ['welcome', 'sequence', 'subscriber', 'nurture', 'mailing-list'],
  },
  {
    id: 'solo-form-to-list',
    name: 'Form Submission to Mailing List',
    category: 'Solopreneur',
    icon: 'FileText',
    description: 'When someone fills out your form, automatically add them to a mailing list and tag them by the form they completed, keeping your contacts organized.',
    trigger: { type: 'customers.person.created', config: { source: 'form' } },
    conditions: [{ field: 'primary_email', operator: 'exists' }],
    actions: [
      { type: 'add_tag', config: { tagName: 'form-lead' } },
      { type: 'add_to_list', config: { listName: 'Form Submissions' } },
    ],
    tags: ['form', 'mailing-list', 'tag', 'organization'],
  },
  {
    id: 'solo-post-event-followup',
    name: 'Post-Event Follow-Up',
    category: 'Solopreneur',
    icon: 'PartyPopper',
    description: 'The day after your event, send attendees a thank-you email with a recap, replay link, and your next offer.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'event-attended' }],
    actions: [
      { type: 'wait', config: { durationMinutes: 1440 } },
      {
        type: 'send_email',
        config: {
          subject: 'Thanks for coming! Here is the recap',
          body: 'Hi {{entity.first_name}},\n\nThank you so much for showing up yesterday — it means a lot!\n\nHere is what I promised:\n- Replay link: {{sender.replay_url}}\n- Slides/resources: {{sender.resource_url}}\n\nIf you enjoyed the event and want to take the next step, I have something that might be a great fit for you. Reply to this email and I will share the details.\n\nThanks again for being there!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['event', 'followup', 'replay', 'offer'],
  },
  {
    id: 'solo-product-purchase-onboard',
    name: 'Product Purchase Onboarding',
    category: 'Solopreneur',
    icon: 'Package',
    description: 'When a customer purchases a product, add them to a buyers list, send a getting-started guide, and create a follow-up task for yourself.',
    trigger: { type: 'sales.payment.created' },
    actions: [
      { type: 'add_to_list', config: { listName: 'Customers' } },
      { type: 'add_tag', config: { tagName: 'customer' } },
      {
        type: 'send_email',
        config: {
          subject: 'You are in! Here is how to get started',
          body: 'Hi {{entity.customer_name}},\n\nThank you for your purchase! I am thrilled to have you.\n\nHere is how to get started:\n1. Check your inbox for your access details\n2. Start with the first section — it takes about 15 minutes\n3. Reply to this email if you get stuck on anything\n\nI want you to get maximum value from this, so do not hesitate to reach out.\n\nEnjoy!\n{{sender.first_name}}',
        },
      },
      { type: 'create_task', config: { title: 'Check in with {{entity.customer_name}} — 5 days after purchase', dueInDays: 5 } },
    ],
    popular: true,
    tags: ['purchase', 'onboarding', 'mailing-list', 'product'],
  },
  {
    id: 'solo-deal-lost-nurture',
    name: 'Lost Deal Nurture',
    category: 'Solopreneur',
    icon: 'HeartHandshake',
    description: 'When you lose a deal, do not burn the bridge. Add them to a nurture list and send a gracious email — they may come back later.',
    trigger: { type: 'customers.deal.updated' },
    conditions: [{ field: 'stage', operator: 'eq', value: 'lost' }],
    actions: [
      { type: 'add_tag', config: { tagName: 'lost-deal' } },
      { type: 'add_to_list', config: { listName: 'Nurture' } },
      {
        type: 'send_email',
        config: {
          subject: 'No hard feelings — wishing you the best',
          body: 'Hi {{entity.contact_name}},\n\nI understand this was not the right fit or timing, and I totally respect that.\n\nI just wanted to say it was great getting to know you and learning about your project. If anything changes down the road or you need help in the future, my door is always open.\n\nI will keep in touch with occasional helpful content — nothing spammy, I promise. And you can unsubscribe anytime.\n\nWishing you all the best!\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['deal-lost', 'nurture', 'mailing-list', 'relationship'],
  },
  {
    id: 'solo-booking-confirm-and-prep',
    name: 'Booking Confirmation + Prep Guide',
    category: 'Solopreneur',
    icon: 'CalendarCheck',
    description: 'When a booking is created, send a confirmation email with a prep checklist so clients show up ready and the meeting is productive.',
    trigger: { type: 'customers.activity.created', config: { activityType: 'meeting' } },
    conditions: [{ field: 'contact_id', operator: 'exists' }],
    actions: [
      {
        type: 'send_email',
        config: {
          subject: 'Confirmed! How to prepare for our call',
          body: 'Hi {{entity.contact_name}},\n\nYour booking is confirmed! I am looking forward to our conversation.\n\nTo make the most of our time, here is a quick prep checklist:\n\n1. Write down your top 2-3 goals or questions\n2. Have any relevant files or links ready to share\n3. Be in a quiet space with good internet if we are meeting virtually\n4. Come with an open mind — we will figure this out together\n\nIf you need to reschedule, just reply to this email. Otherwise, see you soon!\n\n{{sender.first_name}}',
        },
      },
      { type: 'create_task', config: { title: 'Prep notes for call with {{entity.contact_name}}', dueInDays: 0 } },
    ],
    tags: ['booking', 'confirmation', 'prep', 'meeting'],
  },
  {
    id: 'solo-tag-to-sequence',
    name: 'Tag Triggers Email Sequence',
    category: 'Solopreneur',
    icon: 'GitBranch',
    description: 'When you add a specific tag to a contact, automatically enroll them in an email sequence. Great for segmented drip campaigns.',
    trigger: { type: 'customers.person.updated' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'nurture' }],
    actions: [
      { type: 'enroll_in_sequence', config: { sequenceName: 'Nurture Sequence' } },
    ],
    tags: ['tag', 'sequence', 'drip', 'enrollment'],
  },
  {
    id: 'solo-repeat-client-vip',
    name: 'Repeat Client VIP Treatment',
    category: 'Solopreneur',
    icon: 'Award',
    description: 'When a client pays for a second time, tag them as a repeat client, add them to your VIP list, and send a personal thank-you with a loyalty discount.',
    trigger: { type: 'sales.payment.created' },
    conditions: [{ field: 'tags', operator: 'contains', value: 'customer' }],
    actions: [
      { type: 'add_tag', config: { tagName: 'repeat-client' } },
      { type: 'add_to_list', config: { listName: 'VIP Clients' } },
      {
        type: 'send_email',
        config: {
          subject: 'You are officially a VIP',
          body: 'Hi {{entity.customer_name}},\n\nI noticed this is not your first purchase — and I wanted to say a special thank you. Repeat clients are the backbone of my business, and I do not take your trust lightly.\n\nAs a small token of my appreciation, here is a 15% loyalty discount for your next purchase: {{sender.discount_code}}\n\nIf there is ever anything I can do for you, please do not hesitate to reach out. You are a priority.\n\nWith gratitude,\n{{sender.first_name}}',
        },
      },
    ],
    tags: ['vip', 'repeat', 'loyalty', 'mailing-list'],
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
  ...solopreneurTemplates,
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
  'solo-quick-inquiry-response',
  'solo-referral-request',
  'solo-proposal-followup',
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
