import crypto from 'crypto'
import { FakeEm } from './support/fake-em'
import { ctx, seedCandidate, seedPlay, seedRun, WORKSPACE } from './support/campaign-fixtures'
import { createCampaign } from '../campaign/build'
import { messageContentHash, renderMessages, sanitizeMergeValue } from '../campaign/render'
import type { GtmCampaign, GtmCandidate, GtmPlay, GtmResearchRun } from '../../data/entities'

async function setup(): Promise<{
  em: FakeEm
  play: GtmPlay
  run: GtmResearchRun
  campaign: GtmCampaign
}> {
  const em = new FakeEm()
  const play = await seedPlay(em)
  const run = await seedRun(em, play)
  const { campaign } = await createCampaign(em, ctx, {
    workspaceId: WORKSPACE,
    playId: play.id,
    name: 'Render test',
  })
  return { em, play, run, campaign }
}

const TEMPLATE = {
  subject: 'Hello {{first_name}} at {{company}}',
  body: 'Hi {{first_name}},\nSaw {{signal}}.\n{{why_now}}',
}

describe('renderMessages (deterministic per-recipient rendering)', () => {
  it('substitutes grounded merge fields from identity, evidence, and the play', async () => {
    const { em, run, campaign } = await setup()
    const candidate = await seedCandidate(em, run, {
      name: 'Ada Synthetic',
      company: 'Looply Labs',
      evidenceClaim: 'they opened two new offices in Fresno',
    })
    const [row] = await renderMessages(em, ctx, campaign, [candidate], TEMPLATE)
    expect(row.subject).toBe('Hello Ada at Looply Labs')
    expect(row.bodyText).toContain('Hi Ada,')
    expect(row.bodyText).toContain('Saw they opened two new offices in Fresno.')
    expect(row.bodyText).toContain('rebuilding their outbound stack')
    expect(row.needsReview).toBe(false)
    expect(row.missingFields).toEqual([])
  })

  it('renders an honest [[missing:field]] token and flags review instead of inventing facts', async () => {
    const { em, run, campaign } = await setup()
    const candidate = await seedCandidate(em, run, {
      name: 'Ada Synthetic',
      company: null,
      evidenceClaim: null,
    })
    const [row] = await renderMessages(em, ctx, campaign, [candidate], TEMPLATE)
    expect(row.subject).toContain('[[missing:company]]')
    expect(row.bodyText).toContain('[[missing:signal]]')
    expect(row.needsReview).toBe(true)
    expect(row.missingFields).toEqual(expect.arrayContaining(['company', 'signal']))
  })

  it('is deterministic: identical inputs produce identical content hashes', async () => {
    const { em, run, campaign } = await setup()
    const candidate = await seedCandidate(em, run, { name: 'Ada Synthetic', company: 'Looply' })
    const [first] = await renderMessages(em, ctx, campaign, [candidate], TEMPLATE)
    const [second] = await renderMessages(em, ctx, campaign, [candidate], TEMPLATE)
    expect(first.contentHash).toBe(second.contentHash)
    expect(first.contentHash).toBe(
      crypto.createHash('sha256').update(`${first.subject}\n${first.bodyHtml}`).digest('hex'),
    )
    expect(messageContentHash(first.subject, first.bodyHtml)).toBe(first.contentHash)
  })

  it('treats candidate-sourced text as data: a {{evil}} value is never expanded', async () => {
    const { em, run, campaign } = await setup()
    const candidate = await seedCandidate(em, run, {
      name: 'Evil {{why_now}} Actor',
      company: 'Braces {{evil}} Inc',
      evidenceClaim: 'claim with {{first_name}} inside',
    })
    const [row] = await renderMessages(em, ctx, campaign, [candidate], TEMPLATE)
    // Braces are stripped from values, so no candidate-sourced token survives
    // and nothing gets a second expansion pass.
    expect(row.subject).toBe('Hello Evil at Braces evil Inc')
    expect(row.subject).not.toContain('{{')
    expect(row.bodyText).not.toContain('{{')
    expect(row.bodyText).toContain('claim with first_name inside')
    // The play's why_now value appears exactly once (from the template slot),
    // never injected via the candidate name.
    const whyNowMatches = row.bodyText.match(/rebuilding their outbound stack/g) ?? []
    expect(whyNowMatches).toHaveLength(1)
    expect(row.needsReview).toBe(false)
  })

  it('flags unsupported tokens typed into the template for review', async () => {
    const { em, run, campaign } = await setup()
    const candidate = await seedCandidate(em, run, { name: 'Ada Synthetic', company: 'Looply' })
    const [row] = await renderMessages(em, ctx, campaign, [candidate], {
      subject: 'Hi {{first_name}}',
      body: 'This uses {{unsupported_field}} directly',
    })
    expect(row.bodyText).toContain('{{unsupported_field}}')
    expect(row.needsReview).toBe(true)
  })

  it('escapes HTML in body_html but not body_text', async () => {
    const { em, run, campaign } = await setup()
    const candidate = await seedCandidate(em, run, {
      name: 'Ada Synthetic',
      company: 'Tags <script>alert(1)</script> Co',
    })
    const [row] = await renderMessages(em, ctx, campaign, [candidate], {
      subject: 'Hello {{company}}',
      body: 'Hi {{first_name}},\nAbout {{company}}.',
    })
    expect(row.bodyHtml).not.toContain('<script>')
    expect(row.bodyText).toContain('<script>')
    expect(row.bodyHtml).toContain('&lt;script&gt;')
    expect(row.bodyHtml).toContain('<br/>')
  })
})

describe('sanitizeMergeValue', () => {
  it('strips braces and collapses whitespace', () => {
    expect(sanitizeMergeValue('  {{evil}}   payload ')).toBe('evil payload')
    expect(sanitizeMergeValue('{}{}{}')).toBe('')
    expect(sanitizeMergeValue(42)).toBe('')
  })
})
