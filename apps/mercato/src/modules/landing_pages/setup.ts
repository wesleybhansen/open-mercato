import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['landing_pages.*'],
    employee: ['landing_pages.view'],
  },
}

export default setup
