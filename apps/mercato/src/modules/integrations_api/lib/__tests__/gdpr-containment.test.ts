import { POST } from '../../api/internal/gdpr-delete/route'

describe('CRM GDPR deletion containment', () => {
  const previous = process.env.NOLI_INTERNAL_SERVICE_SECRET

  afterAll(() => {
    if (previous === undefined) delete process.env.NOLI_INTERNAL_SERVICE_SECRET
    else process.env.NOLI_INTERNAL_SERVICE_SECRET = previous
  })

  it('authenticates and then fails closed without reading a target', async () => {
    process.env.NOLI_INTERNAL_SERVICE_SECRET = 'gdpr-containment-test-secret'

    const unauthorized = await POST(
      new Request('http://localhost/api/internal/gdpr-delete', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-secret' },
      }),
    )
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('cache-control')).toBe('no-store')

    const authorized = await POST(
      new Request('http://localhost/api/internal/gdpr-delete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer gdpr-containment-test-secret',
        },
        body: 'not-json-and-must-not-be-read',
      }),
    )
    expect(authorized.status).toBe(503)
    expect(authorized.headers.get('cache-control')).toBe('no-store')
    expect(authorized.headers.get('retry-after')).toBe('86400')
    await expect(authorized.json()).resolves.toEqual({
      ok: false,
      code: 'automated_deletion_disabled',
      error: 'Automated deletion is disabled pending durable protocol rollout.',
    })
  })
})
