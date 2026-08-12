/** @jest-environment node */

jest.mock('server-only', () => ({}))

import fs from 'node:fs'
import path from 'node:path'
import {
  allowedWatchedConnectionIds,
  hasWatchedMailboxes,
  normalizeWatchedConnectionIds,
  watchedConnectionIdsForStorage,
} from '../customer-service-watch'
import { parseNoliOrgMembership } from '@open-mercato/shared/lib/noli/core-client'
import { mercatoRoleForNoliOrgRole } from '@open-mercato/shared/lib/auth/clerk'
import { GET as teamGet, POST as teamPost } from '../../api/team/route'
import { DELETE as teamMemberDelete } from '../../api/team/member/route'
import { PUT as teamRolePut } from '../../api/team/role/route'
import { DELETE as teamInviteDelete, POST as teamInvitePost } from '../../api/team/invite/route'
import { GET as localInviteGet, POST as localInvitePost } from '../../api/invite/accept/route'

const appRoot = path.resolve(__dirname, '../../../..')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8')
}

describe('LG-11 authoritative membership and capability boundaries', () => {
  it('preserves all, some, and none as distinct mailbox states', () => {
    expect(normalizeWatchedConnectionIds(undefined, null)).toBeNull()
    expect(normalizeWatchedConnectionIds([], null)).toEqual([])
    expect(normalizeWatchedConnectionIds(['mailbox-1', '', 4], null)).toEqual(['mailbox-1'])
    expect(normalizeWatchedConnectionIds('invalid', ['mailbox-1'])).toBeNull()

    expect(allowedWatchedConnectionIds(null)).toBeNull()
    expect(allowedWatchedConnectionIds([])).toEqual(new Set())
    expect(hasWatchedMailboxes(null)).toBe(true)
    expect(hasWatchedMailboxes([])).toBe(false)
    expect(watchedConnectionIdsForStorage(null)).toBeNull()
    expect(watchedConnectionIdsForStorage([])).toBe('[]')

    const settingsRoute = source('modules/customers/api/customer-service/settings/route.ts')
    const aiTools = source('modules/customers/ai-tools.ts')
    const processor = source('modules/customers/api/customer-service/process/route.ts')
    expect(settingsRoute).not.toContain('cleaned.length > 0 ? cleaned : null')
    expect(aiTools).not.toContain('cleaned.length > 0 ? cleaned : null')
    expect(processor.indexOf('if (watchNoMailboxes &&')).toBeLessThan(
      processor.indexOf('const claimed ='),
    )
  })

  it('accepts only complete authoritative organization memberships', () => {
    expect(parseNoliOrgMembership(null)).toBeNull()
    expect(parseNoliOrgMembership({ organization_id: 'org-1', role: 'owner' })).toEqual({
      organizationId: 'org-1',
      role: 'owner',
    })
    expect(parseNoliOrgMembership({ organization_id: 'org-1', role: 'admin' })).toEqual({
      organizationId: 'org-1',
      role: 'admin',
    })
    expect(parseNoliOrgMembership({ organization_id: 'org-1', role: 'member' })).toEqual({
      organizationId: 'org-1',
      role: 'member',
    })
    expect(() => parseNoliOrgMembership({ organization_id: 'org-1', role: 'viewer' })).toThrow(
      'Noli organization membership is malformed',
    )
    expect(() => parseNoliOrgMembership({ organization_id: '', role: 'member' })).toThrow(
      'Noli organization membership is malformed',
    )
  })

  it('maps the existing organization tiers to existing CRM roles', () => {
    expect(mercatoRoleForNoliOrgRole('owner')).toBe('admin')
    expect(mercatoRoleForNoliOrgRole('admin')).toBe('admin')
    expect(mercatoRoleForNoliOrgRole('member')).toBe('employee')
  })

  it('refuses every obsolete local membership mutation without reading a request', async () => {
    const responses = await Promise.all([
      teamGet(),
      teamPost(),
      teamMemberDelete(),
      teamRolePut(),
      teamInvitePost(),
      teamInviteDelete(),
      localInviteGet(),
      localInvitePost(),
    ])
    expect(responses.map((response) => response.status)).toEqual([
      409, 409, 409, 409, 409, 409, 410, 410,
    ])
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        manageTeamUrl: 'https://app.noliai.com/team',
      })
    }
  })

  it('locks conditional routes and UI to existing RBAC features', () => {
    const guardedFiles = [
      'modules/customers/api/ai/assistant/route.ts',
      'modules/customers/api/ai/debrief/route.ts',
      'modules/customers/backend/assistant/page.meta.ts',
      'modules/customers/backend/debrief/page.meta.ts',
    ]
    for (const file of guardedFiles) {
      expect(source(file)).toMatch(/requireFeatures:\s*\[\s*["']ai_assistant\.view["']\s*\]/)
    }

    const layout = source('app/(backend)/backend/layout.tsx')
    const normalizedLayout = layout.replaceAll('"', "'")
    expect(normalizedLayout).toContain("featureChecker(['ai_assistant.view', 'email.view'])")
    expect(layout).toContain('canUseAssistant ? <FloatingAssistantButton /> : null')
    expect(layout).toContain('{canUseAssistant ? <AiChatHeaderButton /> : null}')
    expect(layout).toContain('...(capabilities.canUseCustomerService')
  })

  it('removes obsolete team actions from every interactive surface', () => {
    const sourcePaths = [
      'app/(backend)/backend/welcome/page.tsx',
      'modules/customers/backend/settings-simple/page.tsx',
      'modules/customers/backend/assistant/page.tsx',
      'modules/customers/lib/crm-tool-catalog.ts',
    ]
    for (const file of sourcePaths) {
      const content = source(file).replaceAll('"', "'")
      expect(content).not.toContain("fetch('/api/team'")
      expect(content).not.toContain("'invite_team'")
    }
    expect(source('modules/customers/backend/settings-simple/page.tsx')).toContain(
      'https://app.noliai.com/team',
    )
  })
})
