import { VectorIndexService } from '../vector-index.service'

describe('legacy vector index GDPR fence', () => {
  it('does not call the embedding provider or vector driver for a tombstoned record', async () => {
    const transactionRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ relation: 'gdpr_user_search_subjects' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: '10000000-0000-4000-8000-000000000001',
            record_id: 'record-1',
          },
        ],
      })
    const database = {
      raw: jest.fn(),
      transaction: jest.fn(async (operation) => operation({ raw: transactionRaw })),
    }
    const embeddingService = {
      available: true,
      createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    }
    const driver = {
      id: 'pgvector',
      ensureReady: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      getChecksum: jest.fn().mockResolvedValue(null),
    }
    const queryEngine = {
      query: jest.fn().mockResolvedValue({ items: [{ id: 'record-1', name: 'Personal data' }] }),
    }
    const service = new VectorIndexService({
      drivers: [driver as never],
      embeddingService: embeddingService as never,
      queryEngine: queryEngine as never,
      moduleConfigs: [
        {
          entities: [
            {
              entityId: 'customers:customer_entity' as never,
              buildSource: () => ({ input: 'Personal data' }),
            },
          ],
        },
      ],
      containerResolver: () => ({
        resolve: (name: string) => {
          if (name === 'em') return { getKnex: () => database }
          throw new Error(`Unknown service: ${name}`)
        },
      }),
    })

    await expect(
      service.indexRecord({
        entityId: 'customers:customer_entity' as never,
        recordId: 'record-1',
        tenantId: '10000000-0000-4000-8000-000000000001',
        organizationId: '20000000-0000-4000-8000-000000000002',
      }),
    ).resolves.toMatchObject({ action: 'skipped', reason: 'user_erasure' })
    expect(embeddingService.createEmbedding).not.toHaveBeenCalled()
    expect(driver.upsert).not.toHaveBeenCalled()
  })
})
