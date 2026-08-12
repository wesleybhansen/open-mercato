/** @jest-environment node */

const mockFindNoliUserById = jest.fn()
const mockIsEntitled = jest.fn()
const mockResolveClerkUserToAuthContext = jest.fn()

jest.mock('@open-mercato/shared/lib/noli/core-client', () => ({
  findNoliUserById: (...args: unknown[]) => mockFindNoliUserById(...args),
  isEntitled: (...args: unknown[]) => mockIsEntitled(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/clerk', () => ({
  resolveClerkUserToAuthContext: (...args: unknown[]) =>
    mockResolveClerkUserToAuthContext(...args),
}))

import { POST } from '../route'

const serviceSecret = 'lg11-test-service-secret'

function request(): Request {
  return new Request('http://localhost/api/internal/receptionist', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ op: 'availability', noliUserId: 'noli-user-1' }),
  })
}

describe('LG-11 receptionist entitlement boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NOLI_INTERNAL_SERVICE_SECRET = serviceSecret
    mockFindNoliUserById.mockResolvedValue({
      id: 'noli-user-1',
      clerk_user_id: 'clerk-user-1',
    })
  })

  afterAll(() => {
    delete process.env.NOLI_INTERNAL_SERVICE_SECRET
  })

  it('refuses before CRM resolution when receptionist entitlement is inactive', async () => {
    mockIsEntitled.mockResolvedValue(false)

    const response = await POST(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'receptionist access unavailable',
    })
    expect(mockIsEntitled).toHaveBeenCalledWith('noli-user-1', 'receptionist')
    expect(mockResolveClerkUserToAuthContext).not.toHaveBeenCalled()
  })
})
