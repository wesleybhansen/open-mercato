import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'billing',
  title: 'Billing',
  version: '0.1.0',
  description: 'Credit-based billing with Stripe. Users purchase credits and pay per usage for email, SMS, and AI.',
  author: 'CRM',
  license: 'MIT',
}
