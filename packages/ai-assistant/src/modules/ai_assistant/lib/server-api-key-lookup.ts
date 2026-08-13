import type { EntityManager } from '@mikro-orm/postgresql'

export type ServerApiKeyLookup<T> = (
  em: EntityManager,
  secret: string,
) => Promise<T | null>

export type ServerApiKeyLookupResult<T> =
  | { status: 'admitted'; record: T }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export const MCP_AUTH_UNAVAILABLE_RESPONSE = Object.freeze({
  status: 503,
  headers: Object.freeze({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Retry-After': '30',
  }),
  body: JSON.stringify({ error: 'MCP authentication temporarily unavailable' }),
})

export async function resolveServerApiKey<T>(
  em: EntityManager,
  secret: string,
  lookup: ServerApiKeyLookup<T>,
): Promise<ServerApiKeyLookupResult<T>> {
  try {
    const record = await lookup(em, secret)
    return record ? { status: 'admitted', record } : { status: 'invalid' }
  } catch {
    console.error('[MCP HTTP] Server-level authentication unavailable')
    return { status: 'unavailable' }
  }
}
