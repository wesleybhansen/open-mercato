import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'landing_pages.page.created', label: 'Page Created', entity: 'page', category: 'crud' as const },
  { id: 'landing_pages.page.updated', label: 'Page Updated', entity: 'page', category: 'crud' as const },
  { id: 'landing_pages.page.deleted', label: 'Page Deleted', entity: 'page', category: 'crud' as const },
  { id: 'landing_pages.page.published', label: 'Page Published', entity: 'page', category: 'lifecycle' as const },
  { id: 'landing_pages.page.unpublished', label: 'Page Unpublished', entity: 'page', category: 'lifecycle' as const },
  { id: 'landing_pages.form.submitted', label: 'Form Submitted', entity: 'form_submission', category: 'lifecycle' as const },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'landing_pages', events })
export default eventsConfig
