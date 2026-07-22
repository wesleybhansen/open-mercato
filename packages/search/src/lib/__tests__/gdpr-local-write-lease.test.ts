import {
  isGdprUserSearchTombstoned,
  tryWithGdprSearchWriteLease,
  tryWithGdprUserSearchWriteLeases,
} from '../gdpr-local-write-lease'

describe('CRM fulltext GDPR search lease', () => {
  it('suppresses a queued write after the organization fence is deleting', async () => {
    const raw = jest.fn().mockResolvedValue({ rows: [{ noli_org_id: null }] })
    const operation = jest.fn()

    const result = await tryWithGdprSearchWriteLease(
      { raw } as never,
      '10000000-0000-4000-8000-000000000001',
      operation,
    )

    expect(result).toEqual({ executed: false })
    expect(operation).not.toHaveBeenCalled()
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('holds and releases a lease around an allowed index mutation', async () => {
    const raw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ noli_org_id: 'noli-org' }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] })

    const result = await tryWithGdprSearchWriteLease(
      { raw } as never,
      '10000000-0000-4000-8000-000000000001',
      async () => 'indexed',
    )

    expect(result).toEqual({ executed: true, value: 'indexed' })
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('fails closed over a durable user search tombstone', async () => {
    const raw = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ relation: 'gdpr_user_search_subjects' }],
      })
      .mockResolvedValueOnce({ rows: [{ tombstoned: true }] })
    await expect(
      isGdprUserSearchTombstoned(
        { raw } as never,
        '10000000-0000-4000-8000-000000000001',
        'record-1',
      ),
    ).resolves.toBe(true)
    expect(raw).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('tenant_id is null'),
      ['record-1', '10000000-0000-4000-8000-000000000001'],
    )
  })

  it('holds exact record leases and filters tenant and wildcard tombstones', async () => {
    const transactionRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ relation: 'gdpr_user_search_subjects' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { tenant_id: null, record_id: 'record-wildcard' },
          {
            tenant_id: '10000000-0000-4000-8000-000000000001',
            record_id: 'record-tenant',
          },
        ],
      })
    const database = {
      raw: jest.fn(),
      transaction: jest.fn(async (operation) => operation({ raw: transactionRaw })),
    }
    const operation = jest.fn(async () => 'indexed')

    const result = await tryWithGdprUserSearchWriteLeases(
      database as never,
      [
        { tenantId: '10000000-0000-4000-8000-000000000001', recordId: 'record-allowed' },
        { tenantId: '10000000-0000-4000-8000-000000000001', recordId: 'record-tenant' },
        { tenantId: '20000000-0000-4000-8000-000000000002', recordId: 'record-wildcard' },
      ],
      operation,
    )

    expect(result).toEqual({ executed: true, value: 'indexed' })
    expect(operation).toHaveBeenCalledWith([
      { tenantId: '10000000-0000-4000-8000-000000000001', recordId: 'record-allowed' },
    ])
    expect(transactionRaw).toHaveBeenCalledTimes(3)
  })

  it('suppresses a batch when every record is tombstoned', async () => {
    const transactionRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ relation: 'gdpr_user_search_subjects' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ tenant_id: null, record_id: 'record-blocked' }],
      })
    const database = {
      transaction: jest.fn(async (operation) => operation({ raw: transactionRaw })),
    }
    const operation = jest.fn(async () => 'indexed')

    await expect(
      tryWithGdprUserSearchWriteLeases(
        database as never,
        [{ tenantId: '10000000-0000-4000-8000-000000000001', recordId: 'record-blocked' }],
        operation,
      ),
    ).resolves.toEqual({ executed: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('fails closed when the durable search fence is not installed', async () => {
    const database = {
      transaction: jest.fn(async (operation) =>
        operation({ raw: jest.fn().mockResolvedValue({ rows: [{ relation: null }] }) }),
      ),
    }

    await expect(
      tryWithGdprUserSearchWriteLeases(
        database as never,
        [{ tenantId: '10000000-0000-4000-8000-000000000001', recordId: 'record-1' }],
        jest.fn(),
      ),
    ).rejects.toThrow('CRM user-search write fence is not installed')
  })
})
