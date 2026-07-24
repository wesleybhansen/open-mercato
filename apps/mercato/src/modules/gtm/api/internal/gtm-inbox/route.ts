import crypto from 'crypto'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { gtmEnabled } from '../../../lib/flags'
import { gtmInboxBodySchema } from '../../../data/validators'
import { isUuid } from '../../../lib/play-shape'
import { GtmExecutionError, type ExecutionEm } from '../../../lib/execute/schedule'
import type { GtmReply } from '../../../data/entities'

/*
 * Internal GTM inbox (SPEC-066 sections 5, 9, 14 Tranche 6).
 *
 * Ops (body.op):
 * - 'list'                replies with enrollment context
 *                         (filter: all | unread | interested; unread =
 *                         not yet classified)
 * - 'classify'            user override of a reply classification;
 *                         'unsubscribe' also suppresses in-transaction
 * - 'record-social-reply' user-recorded LinkedIn/X reply; takes the SAME
 *                         atomic-stop transaction path as correlated email
 *                         replies (section 9)
 * - 'draft-response'      store a draft answer (draft_status 'drafted')
 * - 'approve-draft'       'drafted' -> 'approved' with audit; NO send path
 *                         exists for drafts in this tranche
 *
 * Auth/identity mirrors internal/campaigns: shared-secret bearer, noliUserId
 * re-resolved server-side, every query self-scoped by org + tenant.
 */
export const metadata = {
  path: '/internal/gtm/inbox',
  POST: { requireAuth: false },
}

function opaqueNotFound() {
  return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
}

function replyShape(reply: GtmReply) {
  return {
    id: reply.id,
    enrollment_id: reply.enrollmentId,
    send_attempt_id: reply.sendAttemptId ?? null,
    step_id: reply.stepId ?? null,
    channel: reply.channel,
    email_message_id: reply.emailMessageId ?? null,
    classification: reply.classification ?? null,
    classification_source: reply.classificationSource ?? null,
    draft_status: reply.draftStatus,
    draft_response: reply.draftResponse ?? null,
    created_at: reply.createdAt ?? null,
  }
}

export async function POST(req: Request) {
  if (!gtmEnabled()) {
    return opaqueNotFound()
  }

  const secret = process.env.NOLI_INTERNAL_SERVICE_SECRET
  const authHeader = (req.headers.get('authorization') || '').trim()
  const expected = secret ? `Bearer ${secret}` : ''
  if (
    !secret ||
    authHeader.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  ) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await req.json().catch(() => ({}))
  const parsed = gtmInboxBodySchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path?.length ? `${first.path.join('.')}: ` : ''
    return NextResponse.json(
      { ok: false, error: `${where}${first?.message ?? 'Invalid body'}` },
      { status: 400 },
    )
  }
  const body = parsed.data

  try {
    const { findNoliUserById } = await import('@open-mercato/shared/lib/noli/core-client')
    const noliUser = await findNoliUserById(body.noliUserId)
    if (!noliUser?.clerk_user_id) {
      return NextResponse.json({ ok: false, error: 'Noli user not found' }, { status: 404 })
    }
    const { resolveClerkUserToAuthContext } = await import('@open-mercato/shared/lib/auth/clerk')
    const auth = await resolveClerkUserToAuthContext(noliUser.clerk_user_id)
    if (!auth || !auth.userId || !auth.orgId || !auth.tenantId) {
      return NextResponse.json({ ok: false, error: 'User has no CRM access' }, { status: 403 })
    }
    const ctx = {
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId as string,
      userId: auth.userId as string,
      requestId: req.headers.get('x-request-id') || null,
    }

    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager as unknown as ExecutionEm
    const entities = await import('../../../data/entities')

    if (body.op === 'list') {
      const filter = body.filter ?? 'all'
      const replies = (
        await em.find(entities.GtmReply, {
          organizationId: ctx.organizationId,
          tenantId: ctx.tenantId,
          deletedAt: null,
        })
      )
        .filter((reply) => {
          if (filter === 'unread') return reply.classification == null
          if (filter === 'interested') return reply.classification === 'interested'
          return true
        })
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      const enrollmentIds = [...new Set(replies.map((reply) => reply.enrollmentId))]
      const enrollments = enrollmentIds.length
        ? await em.find(entities.GtmEnrollment, {
            organizationId: ctx.organizationId,
            tenantId: ctx.tenantId,
            id: { $in: enrollmentIds },
          })
        : []
      const enrollmentById = new Map(enrollments.map((row) => [row.id, row]))
      return NextResponse.json({
        ok: true,
        replies: replies.map((reply) => {
          const enrollment = enrollmentById.get(reply.enrollmentId)
          return {
            ...replyShape(reply),
            enrollment: enrollment
              ? {
                  id: enrollment.id,
                  campaign_id: enrollment.campaignId,
                  candidate_id: enrollment.candidateId,
                  contact_id: enrollment.contactId ?? null,
                  status: enrollment.status,
                  stop_reason: enrollment.stopReason ?? null,
                }
              : null,
          }
        }),
      })
    }

    if (body.op === 'classify') {
      if (!isUuid(body.replyId)) return opaqueNotFound()
      const { classifyReply } = await import('../../../lib/replies/classify')
      const result = await classifyReply(em, ctx, {
        replyId: body.replyId,
        classification: body.classification,
      })
      return NextResponse.json({
        ok: true,
        reply: replyShape(result.reply),
        suppressed: result.suppressed,
      })
    }

    if (body.op === 'record-social-reply') {
      if (!isUuid(body.enrollmentId) || !isUuid(body.stepId)) return opaqueNotFound()
      const { recordSocialReply } = await import('../../../lib/replies/correlate')
      const result = await recordSocialReply(em, ctx, {
        enrollmentId: body.enrollmentId,
        stepId: body.stepId,
        note: body.note ?? null,
      })
      return NextResponse.json({
        ok: true,
        reply: replyShape(result.reply),
        already_recorded: result.alreadyRecorded,
      })
    }

    if (body.op === 'draft-response') {
      if (!isUuid(body.replyId)) return opaqueNotFound()
      const { draftResponse } = await import('../../../lib/replies/classify')
      const reply = await draftResponse(em, ctx, {
        replyId: body.replyId,
        draft: { subject: body.draft.subject ?? null, body: body.draft.body },
      })
      return NextResponse.json({ ok: true, reply: replyShape(reply) })
    }

    // approve-draft
    if (!isUuid(body.replyId)) return opaqueNotFound()
    const { approveDraft } = await import('../../../lib/replies/classify')
    const reply = await approveDraft(em, ctx, { replyId: body.replyId })
    return NextResponse.json({ ok: true, reply: replyShape(reply) })
  } catch (err) {
    if (err instanceof GtmExecutionError) {
      if (
        err.code === 'reply_not_found' ||
        err.code === 'enrollment_not_found' ||
        err.code === 'step_not_found'
      ) {
        return opaqueNotFound()
      }
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 422 })
    }
    console.error('[internal.gtm.inbox]', err)
    return NextResponse.json({ ok: false, error: 'Inbox operation failed' }, { status: 500 })
  }
}
