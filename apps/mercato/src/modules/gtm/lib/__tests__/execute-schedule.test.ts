import { FakeEm } from './support/fake-em'
import { ctx, WORKSPACE, seedPlay, seedRun, seedCandidate } from './support/campaign-fixtures'
import {
  LAUNCH_ISO,
  MAILBOX,
  fixedClock,
  seedLaunchedCampaign,
  seedMailbox,
} from './support/execution-fixtures'
import { createCampaign } from '../campaign/build'
import { approveCampaign } from '../campaign/approve'
import {
  GtmExecutionError,
  buildSendIdempotencyKey,
  clampToBusinessWindow,
  computeScheduledFor,
  deterministicJitterMinutes,
  launchCampaign,
} from '../execute/schedule'
import { GtmSendAttempt } from '../../data/entities'

const WINDOW = { start_hour: 9, end_hour: 17, timezone: 'America/New_York' }

describe('materializeSendAttempts + launchCampaign (SPEC-066 section 6 rule 6)', () => {
  it('creates one approved attempt per enrollment x email step, none for manual social steps', async () => {
    const em = new FakeEm()
    const clock = fixedClock(LAUNCH_ISO)
    const fixture = await seedLaunchedCampaign(em, {
      clock,
      recipients: 2,
      emails: 2,
      linkedin: true,
    })

    // 2 recipients x 2 email steps; the two manual LinkedIn steps get none.
    expect(fixture.attempts).toHaveLength(4)
    const emailStepIds = new Set(
      fixture.steps.filter((step) => step.mode === 'automated_email').map((step) => step.id),
    )
    const socialStepIds = new Set(
      fixture.steps.filter((step) => step.mode === 'manual_social').map((step) => step.id),
    )
    expect(socialStepIds.size).toBe(2)
    for (const attempt of fixture.attempts) {
      expect(attempt.state).toBe('approved')
      expect(attempt.fence).toBe(0)
      expect(attempt.attemptNo).toBe(1)
      expect(attempt.rfcMessageId).toBeNull()
      expect(attempt.claimToken).toBeNull()
      expect(attempt.mailboxConnectionId).toBe(MAILBOX)
      expect(emailStepIds.has(attempt.stepId)).toBe(true)
      expect(socialStepIds.has(attempt.stepId)).toBe(false)
      expect(attempt.idempotencyKey).toBe(
        buildSendIdempotencyKey(fixture.version.id, attempt.enrollmentId, attempt.stepId, 1),
      )
      expect(attempt.scheduledFor).toBeInstanceOf(Date)
    }
    expect(fixture.campaign.status).toBe('active')
  })

  it('schedules by delay_days with a business-window clamp: day-0 fires at launch, day-3 skips the weekend', async () => {
    const em = new FakeEm()
    const clock = fixedClock(LAUNCH_ISO) // Wednesday 12:00 ET
    const fixture = await seedLaunchedCampaign(em, { clock, recipients: 1, emails: 2 })
    const stepByOrder = new Map(fixture.steps.map((step) => [step.order, step]))
    const first = fixture.attempts.find((a) => a.stepId === stepByOrder.get(1)!.id)!
    const second = fixture.attempts.find((a) => a.stepId === stepByOrder.get(2)!.id)!

    // Jitter 0: the day-0 step fires exactly at launch (already in-window).
    expect(first.scheduledFor!.toISOString()).toBe(LAUNCH_ISO)
    // Launch + 3 days = Saturday 2026-07-25 12:00 ET; the clamp rolls it to
    // Monday 2026-07-27 09:00 ET = 13:00Z.
    expect(second.scheduledFor!.toISOString()).toBe('2026-07-27T13:00:00.000Z')
  })

  it('jitter is deterministic (seeded, no Math.random) and bounded', () => {
    const a = deterministicJitterMinutes('enrollment-1:step-1', 10)
    const b = deterministicJitterMinutes('enrollment-1:step-1', 10)
    const c = deterministicJitterMinutes('enrollment-2:step-1', 10)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(10)
    expect(c).toBeGreaterThanOrEqual(0)
    expect(c).toBeLessThanOrEqual(10)
    expect(deterministicJitterMinutes('anything', 0)).toBe(0)

    const launchAt = new Date(LAUNCH_ISO)
    const one = computeScheduledFor(launchAt, 0, WINDOW, 10, 'seed-x')
    const two = computeScheduledFor(launchAt, 0, WINDOW, 10, 'seed-x')
    expect(one.toISOString()).toBe(two.toISOString())
  })

  it('clamps before-window and after-window instants into the next window opening', () => {
    // Wednesday 03:00 ET -> same day 09:00 ET.
    const early = clampToBusinessWindow(new Date('2026-07-22T07:00:00.000Z'), WINDOW)
    expect(early.toISOString()).toBe('2026-07-22T13:00:00.000Z')
    // Wednesday 18:30 ET -> Thursday 09:00 ET.
    const late = clampToBusinessWindow(new Date('2026-07-22T22:30:00.000Z'), WINDOW)
    expect(late.toISOString()).toBe('2026-07-23T13:00:00.000Z')
    // Friday 18:00 ET -> Monday 09:00 ET.
    const friday = clampToBusinessWindow(new Date('2026-07-24T22:00:00.000Z'), WINDOW)
    expect(friday.toISOString()).toBe('2026-07-27T13:00:00.000Z')
  })

  it('double-launch is idempotent: existing attempts and active status returned unchanged', async () => {
    const em = new FakeEm()
    const clock = fixedClock(LAUNCH_ISO)
    const fixture = await seedLaunchedCampaign(em, { clock, recipients: 2, emails: 2 })
    const before = (await em.find(GtmSendAttempt, {})).map((row) => row.id).sort()

    const again = await launchCampaign(em, ctx, { campaignId: fixture.campaign.id }, { clock })
    expect(again.alreadyLaunched).toBe(true)
    expect(again.campaign.status).toBe('active')
    expect(again.attempts.map((row) => row.id).sort()).toEqual(before)
    const after = (await em.find(GtmSendAttempt, {})).map((row) => row.id).sort()
    expect(after).toEqual(before)
  })

  it('refuses to launch a campaign without an approved version', async () => {
    const em = new FakeEm()
    await seedMailbox(em)
    const play = await seedPlay(em)
    const run = await seedRun(em, play)
    await seedCandidate(em, run)
    const { campaign } = await createCampaign(em, ctx, {
      workspaceId: WORKSPACE,
      playId: play.id,
      name: 'Never approved',
      settings: { mailbox_connection_id: MAILBOX },
    })
    await expect(
      launchCampaign(em, ctx, { campaignId: campaign.id }, { clock: fixedClock(LAUNCH_ISO) }),
    ).rejects.toMatchObject({ code: 'not_approved' })
  })

  it('refuses to launch an invalidated version', async () => {
    const em = new FakeEm()
    await seedMailbox(em)
    const play = await seedPlay(em)
    const run = await seedRun(em, play)
    await seedCandidate(em, run)
    const { campaign } = await createCampaign(em, ctx, {
      workspaceId: WORKSPACE,
      playId: play.id,
      name: 'Invalidated before launch',
      settings: { mailbox_connection_id: MAILBOX },
    })
    const approved = await approveCampaign(em, ctx, { campaignId: campaign.id })
    approved.version.invalidatedAt = new Date()
    approved.version.invalidatedReason = 'scope_change'
    await expect(
      launchCampaign(em, ctx, { campaignId: campaign.id }, { clock: fixedClock(LAUNCH_ISO) }),
    ).rejects.toMatchObject({ code: 'version_invalidated' })
  })

  it('refuses to launch when the frozen version has no sender mailbox', async () => {
    const em = new FakeEm()
    const play = await seedPlay(em)
    const run = await seedRun(em, play)
    await seedCandidate(em, run)
    const { campaign } = await createCampaign(em, ctx, {
      workspaceId: WORKSPACE,
      playId: play.id,
      name: 'No sender',
    })
    await approveCampaign(em, ctx, { campaignId: campaign.id })
    await expect(
      launchCampaign(em, ctx, { campaignId: campaign.id }, { clock: fixedClock(LAUNCH_ISO) }),
    ).rejects.toMatchObject({ code: 'no_sender' })
    // The failed launch created nothing.
    expect(await em.find(GtmSendAttempt, {})).toHaveLength(0)
  })

  it('unknown campaign raises campaign_not_found', async () => {
    const em = new FakeEm()
    await expect(
      launchCampaign(
        em,
        ctx,
        { campaignId: 'ffffffff-0000-4000-8000-000000000000' },
        { clock: fixedClock(LAUNCH_ISO) },
      ),
    ).rejects.toBeInstanceOf(GtmExecutionError)
  })
})
