import type { EntityManager } from '@mikro-orm/postgresql'
import {
  MCP_AUTH_UNAVAILABLE_RESPONSE,
  resolveServerApiKey,
} from '../server-api-key-lookup'

describe('CRM MCP server-level authentication lookup', () => {
  const em = {} as EntityManager

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('preserves an admitted API-key record', async () => {
    const record = { id: 'key-1' }
    const lookup = jest.fn().mockResolvedValue(record)

    await expect(resolveServerApiKey(em, 'fixed-non-secret-key', lookup)).resolves.toEqual({
      status: 'admitted',
      record,
    })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith(em, 'fixed-non-secret-key')
  })

  it('preserves an ordinary invalid-key refusal', async () => {
    const lookup = jest.fn().mockResolvedValue(null)

    await expect(resolveServerApiKey(em, 'fixed-non-secret-key', lookup)).resolves.toEqual({
      status: 'invalid',
    })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('maps a database rejection to one fixed unavailable class without logging detail', async () => {
    const lookup = jest
      .fn()
      .mockRejectedValue(new Error('credential-like-detail-must-not-leak'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(resolveServerApiKey(em, 'fixed-non-secret-key', lookup)).resolves.toEqual({
      status: 'unavailable',
    })
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[MCP HTTP] Server-level authentication unavailable')
    expect(JSON.stringify(error.mock.calls)).not.toContain('credential-like-detail')
  })

  it('freezes the bounded no-store retryable HTTP projection', () => {
    expect(MCP_AUTH_UNAVAILABLE_RESPONSE).toEqual({
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': '30',
      },
      body: '{"error":"MCP authentication temporarily unavailable"}',
    })
    expect(Object.isFrozen(MCP_AUTH_UNAVAILABLE_RESPONSE)).toBe(true)
    expect(Object.isFrozen(MCP_AUTH_UNAVAILABLE_RESPONSE.headers)).toBe(true)
  })
})
