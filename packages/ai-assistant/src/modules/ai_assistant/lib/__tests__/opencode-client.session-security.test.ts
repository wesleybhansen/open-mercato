import { OpenCodeClient } from '../opencode-client'

describe('OpenCode session security', () => {
  const client = new OpenCodeClient({ baseUrl: 'http://opencode.test' })
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects a question that is not owned by the expected session', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{
      id: 'question-1',
      sessionID: 'ses_other',
      questions: [{
        question: 'Proceed?',
        header: 'Confirm',
        options: [{ label: 'Yes', description: 'Proceed' }],
      }],
      tool: { messageID: 'message-1', callID: 'call-1' },
    }]))

    await expect(client.answerQuestion('question-1', 0, 'ses_owned')).rejects.toThrow(
      'does not belong to the authenticated OpenCode session',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts, deletes, and proves an external session absent', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(true))
      .mockResolvedValueOnce(Response.json(true))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    await expect(client.abortDeleteAndProveSessionAbsent('ses_owned')).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['http://opencode.test/session/ses_owned/abort', 'POST'],
      ['http://opencode.test/session/ses_owned', 'DELETE'],
      ['http://opencode.test/session/ses_owned', 'GET'],
    ])
  })

  it('does not delete or claim safety when a busy session rejects abort', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(false))
      .mockResolvedValueOnce(Response.json({ ses_owned: { type: 'busy' } }))

    await expect(client.abortDeleteAndProveSessionAbsent('ses_owned')).rejects.toThrow(
      'did not acknowledge session abort',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts an already-absent session when delete returns false', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(true))
      .mockResolvedValueOnce(Response.json(false))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    await expect(client.abortDeleteAndProveSessionAbsent('ses/already gone')).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['http://opencode.test/session/ses%2Falready%20gone/abort', 'POST'],
      ['http://opencode.test/session/ses%2Falready%20gone', 'DELETE'],
      ['http://opencode.test/session/ses%2Falready%20gone', 'GET'],
    ])
  })

  it('reads the documented session-status map endpoint', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ses_owned: { type: 'idle' } }))

    await expect(client.getSessionStatus('ses_owned')).resolves.toEqual({ status: 'idle' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://opencode.test/session/status',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })
})
