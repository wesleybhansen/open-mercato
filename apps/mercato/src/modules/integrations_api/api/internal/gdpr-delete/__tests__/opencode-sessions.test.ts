import {
  purgeOrganizationOpenCodeSessions,
  purgeUserOpenCodeSessions,
} from '../route'

type Binding = {
  opencode_session_id: string
  session_user_id: string | null
  organization_id: string | null
  tenant_id: string | null
}

function thenableRows(rows: unknown[]) {
  return {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    whereNotNull: jest.fn().mockReturnThis(),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
}

function fakeKnex(inventories: Binding[][]) {
  let inventoryRead = 0
  return jest.fn((table: string) => {
    if (table === 'information_schema.columns') {
      return thenableRows([
        { column_name: 'opencode_session_id' },
        { column_name: 'session_user_id' },
        { column_name: 'organization_id' },
        { column_name: 'tenant_id' },
      ])
    }
    if (table === 'api_keys') {
      return thenableRows(inventories[inventoryRead++] ?? [])
    }
    throw new Error(`unexpected table: ${table}`)
  })
}

const binding = (overrides: Partial<Binding> = {}): Binding => ({
  opencode_session_id: 'session-1',
  session_user_id: '10000000-0000-4000-8000-000000000001',
  organization_id: '20000000-0000-4000-8000-000000000001',
  tenant_id: '30000000-0000-4000-8000-000000000001',
  ...overrides,
})

describe('CRM OpenCode erasure inventory', () => {
  it('purges the exact user-owned inventory and retains its local proof for the transaction', async () => {
    const inventory = [binding()]
    const knex = fakeKnex([inventory, inventory])
    const purge = jest.fn().mockResolvedValue({ requested: 1, provenAbsent: 1 })

    await expect(purgeUserOpenCodeSessions(knex as never, [{
      id: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      tenantId: '30000000-0000-4000-8000-000000000001',
    }], purge)).resolves.toBe(1)

    expect(purge).toHaveBeenCalledWith(['session-1'])
  })

  it('refuses a user session whose durable organization binding is inconsistent', async () => {
    const knex = fakeKnex([[binding({
      organization_id: '20000000-0000-4000-8000-000000000099',
    })]])
    const purge = jest.fn()

    await expect(purgeUserOpenCodeSessions(knex as never, [{
      id: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      tenantId: '30000000-0000-4000-8000-000000000001',
    }], purge)).rejects.toThrow('ownership inventory was not exact')
    expect(purge).not.toHaveBeenCalled()
  })

  it('purges an exact orphaned organization session inventory', async () => {
    const inventory = [binding({ session_user_id: null })]
    const knex = fakeKnex([inventory, inventory])
    const purge = jest.fn().mockResolvedValue({ requested: 1, provenAbsent: 1 })

    await expect(purgeOrganizationOpenCodeSessions(
      knex as never,
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      purge,
    )).resolves.toBe(1)

    expect(purge).toHaveBeenCalledWith(['session-1'])
  })
})
