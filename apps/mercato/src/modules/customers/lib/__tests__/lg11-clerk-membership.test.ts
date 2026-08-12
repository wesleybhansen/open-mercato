/** @jest-environment node */

jest.mock('server-only', () => ({}))

const mockFindUserByClerkId = jest.fn()
const mockIsEntitled = jest.fn()
const mockFindPrimaryOrgMembershipForUser = jest.fn()
const mockInvalidateUserCache = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/noli/core-client', () => ({
  findUserByClerkId: (...args: unknown[]) => mockFindUserByClerkId(...args),
  isEntitled: (...args: unknown[]) => mockIsEntitled(...args),
  findPrimaryOrgMembershipForUser: (...args: unknown[]) =>
    mockFindPrimaryOrgMembershipForUser(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  User: class User {},
  Role: class Role {},
  UserRole: class UserRole {},
}))

jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class Organization {},
}))

import { resolveClerkUserToAuthContext } from '@open-mercato/shared/lib/auth/clerk'

type EntityLike = { name?: string }

function makeEntityManager(options?: {
  organizationNoliId?: string
  organizationTenantId?: string
  currentRoleName?: 'admin' | 'employee'
  clerkLookup?: boolean
  emailFallback?: boolean
}) {
  const user = {
    id: 'local-user-1',
    clerkUserId: options?.clerkLookup === false ? null : 'clerk-user-1',
    tenantId: 'tenant-1',
    organizationId: 'local-org-1',
  }
  const organization = {
    id: 'local-org-1',
    noliOrgId: options?.organizationNoliId ?? 'noli-org-1',
    tenant: { id: options?.organizationTenantId ?? 'tenant-1' },
  }
  const adminRole = { id: 'role-admin', name: 'admin' }
  const employeeRole = { id: 'role-employee', name: 'employee' }
  const oldLink = {
    user,
    role: options?.currentRoleName === 'employee' ? employeeRole : adminRole,
    deletedAt: null as Date | null,
  }
  const newLink = { user, role: employeeRole, deletedAt: null as Date | null }
  let findRoleLinksCall = 0

  const entityManager = {
    findOne: jest.fn(async (entity: EntityLike, criteria: Record<string, unknown>) => {
      if (entity.name === 'User') {
        if (criteria.id === user.id) return user
        if (criteria.clerkUserId === 'clerk-user-1') {
          return options?.clerkLookup === false ? null : user
        }
        if (criteria.clerkUserId === null) {
          return options?.emailFallback ? user : null
        }
        return null
      }
      if (entity.name === 'Organization') {
        if ('id' in criteria) return organization
        return null
      }
      if (entity.name === 'Role') {
        if (criteria.name === 'employee') return employeeRole
        if (criteria.name === 'admin') return adminRole
        return null
      }
      return null
    }),
    find: jest.fn(async (entity: EntityLike) => {
      if (entity.name !== 'UserRole') return []
      findRoleLinksCall += 1
      return findRoleLinksCall < 3 ? [oldLink] : [newLink]
    }),
    create: jest.fn((_entity: EntityLike, value: Record<string, unknown>) => {
      Object.assign(newLink, value)
      return newLink
    }),
    getReference: jest.fn((entity: EntityLike, id: string) => {
      if (entity.name === 'Role') return id === employeeRole.id ? employeeRole : adminRole
      return user
    }),
    persist: jest.fn(),
    persistAndFlush: jest.fn(),
    flush: jest.fn(),
    transactional: jest.fn(async (callback: (transactionalEm: unknown) => Promise<void>) => {
      await callback(entityManager)
    }),
  }

  return { entityManager, user, oldLink, newLink }
}

describe('LG-11 Clerk membership authority', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindUserByClerkId.mockResolvedValue({
      id: 'noli-user-1',
      clerk_user_id: 'clerk-user-1',
      email: 'synthetic@example.invalid',
      first_name: 'Synthetic',
      last_name: 'Member',
    })
    mockIsEntitled.mockResolvedValue(true)
    mockFindPrimaryOrgMembershipForUser.mockResolvedValue({
      organizationId: 'noli-org-1',
      role: 'member',
    })
    mockInvalidateUserCache.mockResolvedValue(undefined)
  })

  it('denies a removed member before local CRM resolution', async () => {
    mockFindPrimaryOrgMembershipForUser.mockResolvedValue(null)

    await expect(resolveClerkUserToAuthContext('clerk-user-1')).resolves.toBeNull()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('denies an inactive CRM entitlement before local CRM resolution', async () => {
    mockIsEntitled.mockResolvedValue(false)

    await expect(resolveClerkUserToAuthContext('clerk-user-1')).resolves.toBeNull()
    expect(mockFindPrimaryOrgMembershipForUser).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('reconciles a member downgrade to the existing employee role', async () => {
    const { entityManager, oldLink, newLink } = makeEntityManager()
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) =>
        token === 'em' ? entityManager : { invalidateUserCache: mockInvalidateUserCache },
    })

    const result = await resolveClerkUserToAuthContext('clerk-user-1')

    expect(result).toMatchObject({
      userId: 'local-user-1',
      orgId: 'local-org-1',
      roles: ['employee'],
      noliOrgId: 'noli-org-1',
      noliOrgRole: 'member',
    })
    expect(oldLink.deletedAt).toBeInstanceOf(Date)
    expect(newLink.role.name).toBe('employee')
    expect(mockInvalidateUserCache).toHaveBeenCalledWith('local-user-1')
  })

  it('reconciles an owner upgrade to the existing admin role', async () => {
    mockFindPrimaryOrgMembershipForUser.mockResolvedValue({
      organizationId: 'noli-org-1',
      role: 'owner',
    })
    const { entityManager, oldLink, newLink } = makeEntityManager({
      currentRoleName: 'employee',
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) =>
        token === 'em' ? entityManager : { invalidateUserCache: mockInvalidateUserCache },
    })

    const result = await resolveClerkUserToAuthContext('clerk-user-1')

    expect(result).toMatchObject({ roles: ['admin'], noliOrgRole: 'owner' })
    expect(oldLink.deletedAt).toBeInstanceOf(Date)
    expect(newLink.role.name).toBe('admin')
    expect(mockInvalidateUserCache).toHaveBeenCalledWith('local-user-1')
  })

  it('denies a local organization linked to another Noli organization', async () => {
    const { entityManager } = makeEntityManager({ organizationNoliId: 'noli-org-other' })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) =>
        token === 'em' ? entityManager : { invalidateUserCache: mockInvalidateUserCache },
    })

    await expect(resolveClerkUserToAuthContext('clerk-user-1')).resolves.toBeNull()
    expect(entityManager.transactional).not.toHaveBeenCalled()
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
  })

  it('does not stamp a legacy identity before the organization authority passes', async () => {
    const { entityManager, user } = makeEntityManager({
      organizationNoliId: 'noli-org-other',
      clerkLookup: false,
      emailFallback: true,
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) =>
        token === 'em' ? entityManager : { invalidateUserCache: mockInvalidateUserCache },
    })

    await expect(resolveClerkUserToAuthContext('clerk-user-1')).resolves.toBeNull()
    expect(user.clerkUserId).toBeNull()
    expect(entityManager.persistAndFlush).not.toHaveBeenCalled()
  })

  it('denies a local organization from another CRM tenant', async () => {
    const { entityManager } = makeEntityManager({ organizationTenantId: 'tenant-other' })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) =>
        token === 'em' ? entityManager : { invalidateUserCache: mockInvalidateUserCache },
    })

    await expect(resolveClerkUserToAuthContext('clerk-user-1')).resolves.toBeNull()
    expect(entityManager.transactional).not.toHaveBeenCalled()
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
  })
})
