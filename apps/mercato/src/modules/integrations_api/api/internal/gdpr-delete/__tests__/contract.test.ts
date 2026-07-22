import { GDPR_DELETE_CONTRACT, gdprDeleteResponse, parseGdprDeleteRequest } from '../contract'
import {
  GDPR_ORG_TRANSACTION_OPTIONS,
  isSerializationFailure,
  runGdprOrganizationTransaction,
} from '../route'

const request = {
  contract: GDPR_DELETE_CONTRACT,
  operationId: '10000000-0000-4000-8000-000000000001',
  app: 'crm' as const,
  phase: 'organization' as const,
  noliUserId: '20000000-0000-4000-8000-000000000001',
  noliOrgId: '30000000-0000-4000-8000-000000000001',
  email: null,
  clerkUserId: null,
}

describe('CRM GDPR v2 contract', () => {
  it('requires the exact UUID-bound request', () => {
    expect(parseGdprDeleteRequest(request)).toEqual(request)
    expect(parseGdprDeleteRequest({ ...request, soleMember: true })).toBeNull()
    expect(parseGdprDeleteRequest({ ...request, noliOrgId: 'not-a-uuid' })).toBeNull()
    expect(parseGdprDeleteRequest({ ...request, noliUserId: 'not-a-uuid' })).toBeNull()
    expect(parseGdprDeleteRequest({ ...request, phase: 'user' })).toBeNull()
    expect(
      parseGdprDeleteRequest({
        ...request,
        phase: 'user',
        email: 'person@example.com',
      }),
    ).toMatchObject({ phase: 'user', email: 'person@example.com' })
    expect(
      parseGdprDeleteRequest({
        ...request,
        phase: 'user',
        clerkUserId: 'user_123',
      }),
    ).toMatchObject({ phase: 'user', clerkUserId: 'user_123' })
  })

  it('distinguishes purged, already absent, and incomplete outcomes', () => {
    expect(gdprDeleteResponse(request, 'complete', { organizations: 1 }).outcome).toBe('purged')
    expect(gdprDeleteResponse(request, 'complete').outcome).toBe('already_absent')
    const partial = gdprDeleteResponse(request, 'partial', {}, ['organizations'])
    expect(partial).toMatchObject({
      ok: false,
      complete: false,
      outcome: 'incomplete',
    })
  })

  it('makes the last-member predicate serializable and retryable', () => {
    expect(GDPR_ORG_TRANSACTION_OPTIONS).toEqual({
      isolationLevel: 'serializable',
    })
    expect(isSerializationFailure({ code: '40001' })).toBe(true)
    expect(isSerializationFailure({ code: '23505' })).toBe(false)
  })

  it('actually runs organization finalization with serializable isolation', async () => {
    let transactionOptions: unknown
    const transaction = { receipt: 'transaction' }
    const knex = {
      transaction: async (
        scope: (trx: typeof transaction) => Promise<string>,
        options: unknown,
      ) => {
        transactionOptions = options
        return scope(transaction)
      },
    }

    const result = await runGdprOrganizationTransaction(
      knex as never,
      async (trx) => (trx as never as typeof transaction).receipt,
    )
    expect(result).toBe('transaction')
    expect(transactionOptions).toEqual(GDPR_ORG_TRANSACTION_OPTIONS)
  })
})
