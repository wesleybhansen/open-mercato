import { isGdprUserSearchTombstoned, tryWithGdprSearchWriteLease } from '../gdpr-local-write-lease'

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
  })
})
