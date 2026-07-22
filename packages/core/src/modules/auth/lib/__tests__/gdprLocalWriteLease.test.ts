import {
  beginGdprLocalWriteLease,
  beginGdprUserWriteLease,
  tryWithGdprLocalWriteLease,
  withGdprLocalWriteLease,
  withGdprUserWriteLease,
} from '../gdprLocalWriteLease'

describe('CRM GDPR local-write leases', () => {
  it('rejects an upload after organization deletion starts', async () => {
    const raw = jest.fn().mockResolvedValue({ rows: [{ noli_org_id: null }] })
    await expect(
      withGdprLocalWriteLease(
        { raw } as never,
        '10000000-0000-4000-8000-000000000001',
        'storage',
        async () => undefined,
      ),
    ).rejects.toThrow('exact organization receipt')
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('releases a durable upload lease even when the write fails', async () => {
    const raw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ noli_org_id: 'noli-org' }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] })
    await expect(
      withGdprLocalWriteLease(
        { raw } as never,
        '10000000-0000-4000-8000-000000000001',
        'storage',
        async () => {
          throw new Error('disk full')
        },
      ),
    ).rejects.toThrow('disk full')
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('lets queued workers suppress fenced mutations', async () => {
    const raw = jest.fn().mockResolvedValue({ rows: [{ noli_org_id: null }] })
    const operation = jest.fn()
    await expect(
      tryWithGdprLocalWriteLease(
        { raw } as never,
        '10000000-0000-4000-8000-000000000001',
        'search',
        operation,
      ),
    ).resolves.toEqual({ executed: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('hands a durable processor lease to scheduled background work', async () => {
    const raw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ noli_org_id: 'noli-org' }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] })
    const lease = await beginGdprLocalWriteLease(
      { raw } as never,
      '10000000-0000-4000-8000-000000000001',
      'processor',
    )
    expect(lease).not.toBeNull()
    await lease!.release()
    await lease!.release()
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('suppresses and releases exact user-scoped work', async () => {
    const rejectedRaw = jest.fn().mockResolvedValue({ rows: [{ acquired: false }] })
    await expect(
      withGdprUserWriteLease(
        { raw: rejectedRaw } as never,
        '10000000-0000-4000-8000-000000000001',
        'storage',
        async () => undefined,
      ),
    ).rejects.toThrow('rejected by the erasure fence')

    const allowedRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] })
    const lease = await beginGdprUserWriteLease(
      { raw: allowedRaw } as never,
      '10000000-0000-4000-8000-000000000001',
      'processor',
    )
    expect(lease).not.toBeNull()
    await lease!.release()
    expect(allowedRaw).toHaveBeenCalledTimes(2)
  })
})
