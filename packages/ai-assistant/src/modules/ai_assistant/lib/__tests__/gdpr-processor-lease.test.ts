jest.mock('@open-mercato/core/modules/auth/lib/gdprLocalWriteLease', () => ({
  beginGdprLocalWriteLease: jest.fn(),
  beginGdprUserWriteLease: jest.fn(),
}))

import {
  beginGdprLocalWriteLease,
  beginGdprUserWriteLease,
} from '@open-mercato/core/modules/auth/lib/gdprLocalWriteLease'
import {
  beginAiAssistantProcessorLease,
  resolveAiAssistantLocalUserId,
} from '../gdpr-processor-lease'

const beginOrganizationLeaseMock = jest.mocked(beginGdprLocalWriteLease)
const beginUserLeaseMock = jest.mocked(beginGdprUserWriteLease)
const organizationRelease = jest.fn()
const userRelease = jest.fn()
const database = {}
const em = { getKnex: () => database }

describe('AI assistant processor leases', () => {
  beforeEach(() => {
    organizationRelease.mockReset().mockResolvedValue(undefined)
    userRelease.mockReset().mockResolvedValue(undefined)
    beginOrganizationLeaseMock.mockReset().mockResolvedValue({
      leaseId: '70000000-0000-4000-8000-000000000001',
      release: organizationRelease,
    })
    beginUserLeaseMock.mockReset().mockResolvedValue({
      leaseId: '70000000-0000-4000-8000-000000000002',
      release: userRelease,
    })
  })

  it('prefers an exact API-key owner over a synthetic subject', () => {
    expect(resolveAiAssistantLocalUserId({
      sub: 'api_key:90000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000001',
    })).toBe('10000000-0000-4000-8000-000000000001')
  })

  it('holds both exact leases until one idempotent release', async () => {
    const lease = await beginAiAssistantProcessorLease(em as never, {
      orgId: '20000000-0000-4000-8000-000000000001',
      sub: '10000000-0000-4000-8000-000000000001',
    })

    expect(beginOrganizationLeaseMock).toHaveBeenCalledWith(
      database,
      '20000000-0000-4000-8000-000000000001',
      'processor',
    )
    expect(beginUserLeaseMock).toHaveBeenCalledWith(
      database,
      '10000000-0000-4000-8000-000000000001',
      'processor',
    )
    expect(organizationRelease).not.toHaveBeenCalled()
    expect(userRelease).not.toHaveBeenCalled()

    await Promise.all([lease?.release(), lease?.release()])
    expect(userRelease).toHaveBeenCalledTimes(1)
    expect(organizationRelease).toHaveBeenCalledTimes(1)
  })

  it('fails closed before user admission when the organization is fenced', async () => {
    beginOrganizationLeaseMock.mockResolvedValueOnce(null)

    await expect(beginAiAssistantProcessorLease(em as never, {
      orgId: '20000000-0000-4000-8000-000000000001',
      sub: '10000000-0000-4000-8000-000000000001',
    })).resolves.toBeNull()

    expect(beginUserLeaseMock).not.toHaveBeenCalled()
  })

  it('releases the organization lease when the user fence rejects admission', async () => {
    beginUserLeaseMock.mockResolvedValueOnce(null)

    await expect(beginAiAssistantProcessorLease(em as never, {
      orgId: '20000000-0000-4000-8000-000000000001',
      sub: '10000000-0000-4000-8000-000000000001',
    })).resolves.toBeNull()

    expect(organizationRelease).toHaveBeenCalledTimes(1)
  })
})
