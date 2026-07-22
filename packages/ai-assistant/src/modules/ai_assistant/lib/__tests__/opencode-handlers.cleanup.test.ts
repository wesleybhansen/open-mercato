jest.mock('../opencode-client', () => ({
  createOpenCodeClient: jest.fn(),
}))

import { createOpenCodeClient } from '../opencode-client'
import {
  handleOpenCodeAnswer,
  handleOpenCodeMessageStreaming,
} from '../opencode-handlers'

const client = {
  createSession: jest.fn(),
  getSession: jest.fn(),
  sendMessage: jest.fn(),
  subscribeToEvents: jest.fn(),
  getSessionStatus: jest.fn(),
  getPendingQuestions: jest.fn(),
  answerQuestion: jest.fn(),
  abortDeleteAndProveSessionAbsent: jest.fn(),
}

describe('OpenCode handler terminal cleanup', () => {
  beforeEach(() => {
    for (const mock of Object.values(client)) mock.mockReset()
    jest.mocked(createOpenCodeClient).mockReturnValue(client as never)
    client.createSession.mockResolvedValue({ id: 'session-1' })
    client.abortDeleteAndProveSessionAbsent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('deletes a newly created session when durable ownership binding fails', async () => {
    const onEvent = jest.fn().mockResolvedValue(undefined)

    const result = await handleOpenCodeMessageStreaming({
      message: 'hello',
      onSessionReady: async () => {
        throw new Error('binding failed')
      },
    }, onEvent)

    expect(client.sendMessage).not.toHaveBeenCalled()
    expect(client.abortDeleteAndProveSessionAbsent).toHaveBeenCalledWith('session-1')
    expect(result).toEqual({ sessionId: 'session-1', terminalConfirmed: true })
  })

  it('reports ambiguity when failed-session absence cannot be proved', async () => {
    client.abortDeleteAndProveSessionAbsent.mockRejectedValueOnce(new Error('provider unknown'))

    const result = await handleOpenCodeMessageStreaming({
      message: 'hello',
      onSessionReady: async () => {
        throw new Error('binding failed')
      },
    }, jest.fn().mockResolvedValue(undefined))

    expect(result).toEqual({ sessionId: 'session-1', terminalConfirmed: false })
  })

  it('cleans up an answer path that fails before quiescence', async () => {
    client.answerQuestion.mockRejectedValueOnce(new Error('reply failed'))

    const result = await handleOpenCodeAnswer(
      'question-1',
      0,
      'session-1',
      jest.fn().mockResolvedValue(undefined),
    )

    expect(client.answerQuestion).toHaveBeenCalledWith('question-1', 0, 'session-1')
    expect(client.abortDeleteAndProveSessionAbsent).toHaveBeenCalledWith('session-1')
    expect(result).toEqual({ sessionId: 'session-1', terminalConfirmed: true })
  })

  it('ignores global or foreign idle events until the exact session becomes idle', async () => {
    jest.useFakeTimers()
    let receiveEvent: ((event: unknown) => Promise<void>) | undefined
    client.subscribeToEvents.mockImplementation((onEvent) => {
      receiveEvent = onEvent
      return jest.fn()
    })
    client.sendMessage.mockResolvedValue({})
    client.getPendingQuestions.mockResolvedValue([])
    const onEvent = jest.fn().mockResolvedValue(undefined)

    const operation = handleOpenCodeMessageStreaming({ message: 'hello' }, onEvent)
    for (let tick = 0; tick < 4 && !receiveEvent; tick += 1) {
      await Promise.resolve()
    }
    expect(receiveEvent).toBeDefined()

    await receiveEvent?.({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    })
    await receiveEvent?.({
      type: 'session.status',
      properties: { status: { type: 'idle' } },
    })
    await receiveEvent?.({
      type: 'session.status',
      properties: { sessionID: 'foreign-session', status: { type: 'idle' } },
    })
    await receiveEvent?.({
      type: 'message.updated',
      properties: {
        info: {
          id: 'message-1',
          sessionID: 'session-1',
          role: 'assistant',
          time: { completed: 1 },
          modelID: 'model-1',
          providerID: 'provider-1',
          tokens: { input: 5, output: 3 },
        },
      },
    })
    await receiveEvent?.({
      type: 'message.updated',
      properties: {
        info: {
          id: 'message-2',
          sessionID: 'session-1',
          role: 'assistant',
          time: { completed: 2 },
          modelID: 'model-1',
          providerID: 'provider-1',
          tokens: { input: 7, output: 4 },
        },
      },
    })
    await jest.advanceTimersByTimeAsync(2_000)
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }))

    await receiveEvent?.({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'idle' } },
    })
    await jest.advanceTimersByTimeAsync(2_000)

    await expect(operation).resolves.toEqual({
      sessionId: 'session-1',
      terminalConfirmed: true,
    })
    expect(onEvent).toHaveBeenCalledWith({ type: 'done', sessionId: 'session-1' })
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'metadata',
      tokens: { input: 12, output: 7 },
    }))
  })
})
