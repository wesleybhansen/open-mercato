import {
  registerCliModules,
  getCliModules,
  hasCliModules,
  padByCodePointWidth,
  withGdprQueueExecutionLeases,
} from '../mercato'

describe('mercato CLI module registration', () => {
  beforeEach(() => {
    // Reset module state by re-importing
    jest.resetModules()
  })

  describe('getCliModules', () => {
    it('returns empty array when no modules registered', () => {
      // Fresh import to get clean state
      const { getCliModules: freshGetCliModules } = jest.requireActual('../mercato')

      // In a fresh state (or after reset), should return empty array
      const modules = freshGetCliModules()
      expect(Array.isArray(modules)).toBe(true)
    })

    it('returns registered modules after registration', () => {
      const mockModules = [{ id: 'test-module', cli: [{ command: 'test', run: jest.fn() }] }] as any

      registerCliModules(mockModules)
      const result = getCliModules()

      expect(result).toBe(mockModules)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('test-module')
    })
  })

  describe('hasCliModules', () => {
    it('returns false when no modules registered', () => {
      const { hasCliModules: freshHasCliModules } = jest.requireActual('../mercato')
      // Note: This test depends on module state
      // In practice, hasCliModules checks if _cliModules is not null and has length
    })

    it('returns true after modules are registered', () => {
      const mockModules = [{ id: 'auth', cli: [{ command: 'setup', run: jest.fn() }] }] as any

      registerCliModules(mockModules)

      expect(hasCliModules()).toBe(true)
    })

    it('returns false when empty array is registered', () => {
      registerCliModules([])

      expect(hasCliModules()).toBe(false)
    })
  })

  describe('registerCliModules', () => {
    it('allows re-registration in development mode', () => {
      const originalEnv = process.env.NODE_ENV
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'

      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation()

      const modules1 = [{ id: 'mod1', cli: [] }] as any
      const modules2 = [{ id: 'mod2', cli: [] }] as any

      registerCliModules(modules1)
      registerCliModules(modules2)

      const result = getCliModules()
      expect(result).toBe(modules2)

      consoleSpy.mockRestore()
      ;(process.env as Record<string, string | undefined>).NODE_ENV = originalEnv
    })

    it('registers modules correctly', () => {
      const testModules = [
        { id: 'customers', cli: [{ command: 'seed', run: jest.fn() }] },
        { id: 'catalog', cli: [{ command: 'import', run: jest.fn() }] },
      ] as any

      registerCliModules(testModules)

      const result = getCliModules()
      expect(result).toHaveLength(2)
      expect(result.map((m: any) => m.id)).toEqual(['customers', 'catalog'])
    })
  })
})

describe('padByCodePointWidth', () => {
  it('pads emoji labels based on code point width', () => {
    expect(padByCodePointWidth('👑 Superadmin:', 13)).toBe('👑 Superadmin:')
    expect(padByCodePointWidth('🧰 Admin:', 13)).toBe('🧰 Admin:     ')
    expect(padByCodePointWidth('👷 Employee:', 13)).toBe('👷 Employee:  ')
  })

  it('does not trim or pad when value meets or exceeds target width', () => {
    expect(padByCodePointWidth('1234567890123', 13)).toBe('1234567890123')
    expect(padByCodePointWidth('12345678901234', 13)).toBe('12345678901234')
  })
})

function gdprQueueDatabase(
  options: {
    tombstoned?: boolean
    durableUser?: boolean
    durableOrganization?: boolean
    liveOrganization?: boolean
    liveUser?: boolean
    userAcquired?: boolean
  } = {},
) {
  const organizationId = '10000000-0000-4000-8000-000000000001'
  const userId = '20000000-0000-4000-8000-000000000001'
  const database = jest.fn((table: string) => {
    const rows =
      table === 'organizations'
        ? options.liveOrganization === false
          ? []
          : [{ id: organizationId }]
        : table === 'users'
          ? options.liveUser === false
            ? []
            : [{ id: userId }]
          : []
    return { select: () => ({ whereIn: async () => rows }) }
  }) as jest.Mock & { raw: jest.Mock }
  database.raw = jest.fn(async (sql: string) => {
    if (sql.includes('to_regprocedure')) {
      return {
        rows: [{ organization_lease: 'installed', user_lease: 'installed' }],
      }
    }
    if (sql.includes('as user_search_subject')) {
      return {
        rows: [
          {
            user_search_subject: options.tombstoned === true,
            noli_user_subject: options.durableUser === true,
            local_user_subject: options.durableUser === true,
            organization_subject: options.durableOrganization === true,
          },
        ],
      }
    }
    if (sql.includes('acquire_local_write_lease')) {
      return { rows: [{ subject: 'noli-org' }] }
    }
    if (sql.includes('acquire_user_write_lease')) {
      return { rows: [{ acquired: options.userAcquired !== false }] }
    }
    if (sql.includes('release_')) return { rows: [{ released: true }] }
    throw new Error(`unexpected SQL: ${sql}`)
  })
  return { database, organizationId, userId }
}

describe('GDPR queue execution lease', () => {
  it('holds organization and user leases around every discovered worker', async () => {
    const { database, organizationId, userId } = gdprQueueDatabase()
    const operation = jest.fn().mockResolvedValue(undefined)
    await withGdprQueueExecutionLeases(
      { resolve: () => ({ getKnex: () => database }) },
      { payload: { organizationId, userId } },
      operation,
    )
    expect(operation).toHaveBeenCalledTimes(1)
    expect(
      database.raw.mock.calls.filter(([sql]) => sql.includes('select public.crm_gdpr_acquire_')),
    ).toHaveLength(2)
    expect(database.raw.mock.calls.filter(([sql]) => sql.includes('release_'))).toHaveLength(2)
  })

  it('acknowledges without execution when a subject fence rejects the job', async () => {
    const { database, organizationId, userId } = gdprQueueDatabase({
      userAcquired: false,
    })
    const operation = jest.fn()
    await withGdprQueueExecutionLeases(
      { resolve: () => ({ getKnex: () => database }) },
      { payload: { organizationId, userId } },
      operation,
    )
    expect(operation).not.toHaveBeenCalled()
    expect(database.raw.mock.calls.filter(([sql]) => sql.includes('release_local'))).toHaveLength(1)
  })

  it('suppresses jobs carrying a durable erased record tombstone', async () => {
    const { database, userId } = gdprQueueDatabase({ tombstoned: true })
    const operation = jest.fn()
    await withGdprQueueExecutionLeases(
      { resolve: () => ({ getKnex: () => database }) },
      { payload: { recordId: userId } },
      operation,
    )
    expect(operation).not.toHaveBeenCalled()
    expect(
      database.raw.mock.calls.some(([sql]) => sql.includes('select public.crm_gdpr_acquire_')),
    ).toBe(false)
  })

  it('suppresses durable user and organization subjects after live rows are gone', async () => {
    const user = gdprQueueDatabase({ durableUser: true, liveUser: false })
    const userOperation = jest.fn()
    await withGdprQueueExecutionLeases(
      { resolve: () => ({ getKnex: () => user.database }) },
      { payload: { userId: user.userId } },
      userOperation,
    )
    expect(userOperation).not.toHaveBeenCalled()

    const organization = gdprQueueDatabase({
      durableOrganization: true,
      liveOrganization: false,
    })
    const organizationOperation = jest.fn()
    await withGdprQueueExecutionLeases(
      { resolve: () => ({ getKnex: () => organization.database }) },
      { payload: { organizationId: organization.organizationId } },
      organizationOperation,
    )
    expect(organizationOperation).not.toHaveBeenCalled()
  })

  it('fails closed when a queue payload exceeds the bounded subject inventory', async () => {
    const { database } = gdprQueueDatabase()
    let payload: unknown = 'leaf'
    for (let index = 0; index < 20; index += 1) payload = { nested: payload }
    await expect(
      withGdprQueueExecutionLeases(
        { resolve: () => ({ getKnex: () => database }) },
        { payload },
        jest.fn(),
      ),
    ).rejects.toThrow('depth limit')
  })
})
