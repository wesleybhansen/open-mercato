import { ApiKey } from '../../data/entities'
import {
  bindOpenCodeSession,
  findOwnedOpenCodeSession,
} from '../openCodeSessionBinding'

const OWNER = {
  localUserId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  tenantId: '30000000-0000-4000-8000-000000000001',
}

function sessionKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return Object.assign(new ApiKey(), {
    id: '40000000-0000-4000-8000-000000000001',
    sessionToken: 'sess_test',
    sessionUserId: OWNER.localUserId,
    organizationId: OWNER.organizationId,
    tenantId: OWNER.tenantId,
    expiresAt: new Date(Date.now() + 60_000),
    deletedAt: null,
    ...overrides,
  })
}

describe('OpenCode session binding', () => {
  it('durably binds a new external session to its exact session key owner', async () => {
    const record = sessionKey()
    const findOne = jest.fn()
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(null)
    const persistAndFlush = jest.fn().mockResolvedValue(undefined)
    const em = { findOne, persistAndFlush }

    await expect(bindOpenCodeSession(em as never, {
      keyId: record.id,
      sessionToken: 'sess_test',
      sessionId: 'ses_external_1',
      ...OWNER,
    })).resolves.toEqual(expect.objectContaining({
      keyId: record.id,
      sessionId: 'ses_external_1',
      ...OWNER,
    }))

    expect(findOne).toHaveBeenNthCalledWith(1, ApiKey, expect.objectContaining({
      id: record.id,
      sessionToken: 'sess_test',
      sessionUserId: OWNER.localUserId,
      organizationId: OWNER.organizationId,
      tenantId: OWNER.tenantId,
    }))
    expect(record.opencodeSessionId).toBe('ses_external_1')
    expect(persistAndFlush).toHaveBeenCalledWith(record)
  })

  it('rejects a session ID already bound to another key', async () => {
    const record = sessionKey()
    const findOne = jest.fn()
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(sessionKey({ id: '40000000-0000-4000-8000-000000000002' }))
    const em = { findOne, persistAndFlush: jest.fn() }

    await expect(bindOpenCodeSession(em as never, {
      keyId: record.id,
      sessionToken: 'sess_test',
      sessionId: 'ses_external_1',
      ...OWNER,
    })).rejects.toThrow('already bound to another owner')

    expect(em.persistAndFlush).not.toHaveBeenCalled()
  })

  it('finds only an active session belonging to the exact user, org, and tenant', async () => {
    const record = sessionKey({ opencodeSessionId: 'ses_external_1' })
    const findOne = jest.fn().mockResolvedValue(record)
    const em = { findOne }

    await expect(findOwnedOpenCodeSession(
      em as never,
      'ses_external_1',
      OWNER,
    )).resolves.toEqual(expect.objectContaining({ sessionId: 'ses_external_1', ...OWNER }))
    expect(findOne).toHaveBeenCalledWith(ApiKey, {
      opencodeSessionId: 'ses_external_1',
      sessionUserId: OWNER.localUserId,
      organizationId: OWNER.organizationId,
      tenantId: OWNER.tenantId,
      deletedAt: null,
    })
  })

  it('rejects an expired exact-owner binding', async () => {
    const record = sessionKey({
      opencodeSessionId: 'ses_external_1',
      expiresAt: new Date(Date.now() - 1),
    })
    const em = { findOne: jest.fn().mockResolvedValue(record) }

    await expect(findOwnedOpenCodeSession(
      em as never,
      'ses_external_1',
      OWNER,
    )).resolves.toBeNull()
  })
})
