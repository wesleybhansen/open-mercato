import { purgeOpenCodeSessions } from '../opencode-session-purge'

describe('OpenCode session purge', () => {
  it('deduplicates an exact inventory and proves every session absent', async () => {
    const abortDeleteAndProveSessionAbsent = jest.fn().mockResolvedValue(undefined)

    const receipt = await purgeOpenCodeSessions(
      ['session-b', 'session-a', 'session-b', '  '],
      { abortDeleteAndProveSessionAbsent },
    )

    expect(abortDeleteAndProveSessionAbsent.mock.calls).toEqual([
      ['session-a'],
      ['session-b'],
    ])
    expect(receipt).toEqual({ requested: 2, provenAbsent: 2 })
  })

  it('fails closed on the first ambiguous provider cleanup', async () => {
    const abortDeleteAndProveSessionAbsent = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('provider unavailable'))

    await expect(purgeOpenCodeSessions(
      ['session-a', 'session-b', 'session-c'],
      { abortDeleteAndProveSessionAbsent },
    )).rejects.toThrow('provider unavailable')
    expect(abortDeleteAndProveSessionAbsent.mock.calls).toEqual([
      ['session-a'],
      ['session-b'],
    ])
  })
})
