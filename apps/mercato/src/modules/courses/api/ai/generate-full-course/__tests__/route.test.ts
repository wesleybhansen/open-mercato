jest.mock('server-only', () => ({}))

const afterTasks: Array<() => unknown | Promise<unknown>> = []
jest.mock('next/server', () => ({
  after: jest.fn((task: () => unknown | Promise<unknown>) => afterTasks.push(task)),
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@/lib/usage/allowance', () => ({
  beginCustomersAiAllowance: jest.fn(),
}))
jest.mock('@/lib/usage/meter', () => ({
  meterCustomersAi: jest.fn(),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { beginCustomersAiAllowance } from '@/lib/usage/allowance'
import { meterCustomersAi } from '@/lib/usage/meter'
import { POST } from '../route'

const createRequestContainerMock = jest.mocked(createRequestContainer)
const beginCustomersAiAllowanceMock = jest.mocked(beginCustomersAiAllowance)
const meterCustomersAiMock = jest.mocked(meterCustomersAi)

describe('POST /api/courses/ai/generate-full-course', () => {
  const release = jest.fn()
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = []
  const updates: Array<{
    table: string
    column: string
    value: unknown
    patch: Record<string, unknown>
  }> = []
  const knex = jest.fn((table: string) => ({
    insert: async (value: Record<string, unknown>) => {
      inserts.push({ table, value })
    },
    where: (column: string, value: unknown) => ({
      update: async (patch: Record<string, unknown>) => {
        updates.push({ table, column, value, patch })
      },
    }),
  }))

  beforeEach(() => {
    afterTasks.length = 0
    inserts.length = 0
    updates.length = 0
    release.mockReset().mockResolvedValue(undefined)
    knex.mockClear()
    createRequestContainerMock.mockReset().mockResolvedValue({
      resolve: () => ({ getKnex: () => knex }),
    } as never)
    beginCustomersAiAllowanceMock.mockReset().mockResolvedValue({
      gate: { allowed: true },
      createExternalGrant: jest.fn(),
      release,
    })
    meterCustomersAiMock.mockReset().mockResolvedValue(undefined)
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [{ text: 'Generated lesson' }] } }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22 },
    }))
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  })

  it('keeps the processor lease until registered lesson work and metering settle', async () => {
    const request = new Request('http://localhost/api/courses/ai/generate-full-course', {
      method: 'POST',
      body: JSON.stringify({
        topic: 'Privacy-safe course',
        outline: {
          title: 'Privacy-safe course',
          description: 'A course',
          modules: [{
            title: 'Module one',
            lessons: [{ title: 'Lesson one', description: 'The lesson' }],
          }],
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request, {
      auth: {
        tenantId: 'tenant-1',
        orgId: '20000000-0000-4000-8000-000000000001',
        sub: '10000000-0000-4000-8000-000000000001',
      },
    })

    expect(response.status).toBe(201)
    expect(beginCustomersAiAllowanceMock).toHaveBeenCalledTimes(1)
    expect(inserts.map((entry) => entry.table)).toEqual([
      'courses',
      'course_modules',
      'course_lessons',
    ])
    expect(afterTasks).toHaveLength(1)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()

    await afterTasks[0]()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'course_lessons', patch: { content: 'Generated lesson' } }),
      expect.objectContaining({ table: 'courses', patch: expect.objectContaining({ generation_status: 'complete' }) }),
    ]))
    expect(meterCustomersAiMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: '20000000-0000-4000-8000-000000000001' }),
      expect.objectContaining({ feature: 'courses-generate-full-course-lessons' }),
    )
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does no provider or local write work when the deletion fence rejects admission', async () => {
    beginCustomersAiAllowanceMock.mockResolvedValueOnce(null)
    const request = new Request('http://localhost/api/courses/ai/generate-full-course', {
      method: 'POST',
      body: JSON.stringify({
        topic: 'Blocked course',
        outline: { title: 'Blocked course', modules: [] },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request, {
      auth: {
        tenantId: 'tenant-1',
        orgId: '20000000-0000-4000-8000-000000000001',
        sub: '10000000-0000-4000-8000-000000000001',
      },
    })

    expect(response.status).toBe(503)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(knex).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
    expect(meterCustomersAiMock).not.toHaveBeenCalled()
  })
})
