import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'email.message.sent', label: 'Email Sent', entity: 'message', category: 'lifecycle' as const },
  { id: 'email.message.received', label: 'Email Received', entity: 'message', category: 'lifecycle' as const },
  { id: 'email.message.opened', label: 'Email Opened', entity: 'message', category: 'lifecycle' as const },
  { id: 'email.message.clicked', label: 'Email Link Clicked', entity: 'message', category: 'lifecycle' as const },
  { id: 'email.message.bounced', label: 'Email Bounced', entity: 'message', category: 'lifecycle' as const },
  { id: 'email.campaign.sent', label: 'Campaign Sent', entity: 'campaign', category: 'lifecycle' as const },
  { id: 'email.campaign.completed', label: 'Campaign Completed', entity: 'campaign', category: 'lifecycle' as const },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'email', events })
export default eventsConfig
