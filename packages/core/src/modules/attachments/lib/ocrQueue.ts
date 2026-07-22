import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { logCrmAiUsage } from '@open-mercato/shared/lib/noli/ai-usage'
import { checkOrgAiAllowance } from '@open-mercato/shared/lib/noli/allowance'
import { OcrService } from './ocrService'
import {
  beginGdprLocalWriteLease,
  beginGdprUserWriteLease,
  type GdprLocalWriteLease,
} from '../../auth/lib/gdprLocalWriteLease'

export type OcrRequestedEvent = {
  attachmentId: string
  filePath: string
  mimeType: string
  partitionCode: string
  organizationId: string | null
  tenantId: string | null
  userId?: string | null
}

export async function processAttachmentOcr(
  em: EntityManager,
  payload: OcrRequestedEvent,
): Promise<void> {
  const { attachmentId, filePath, mimeType, partitionCode } = payload

  console.log(`[attachments.ocr] Processing started for attachment: ${attachmentId}`)
  const startTime = Date.now()

  try {
    const partition = await em.findOne(AttachmentPartition, {
      code: partitionCode,
    })
    const resolvedModel = partition?.ocrModel ?? process.env.OCR_MODEL ?? 'gpt-5-mini'

    // P-3 allowance gate + unified BYOK fall-through (GAP-4). OCR runs on OpenAI.
    // Background worker → no 402: when the org is over its pooled allowance and
    // has no OpenAI BYO key, SKIP (leaves the attachment uncrawled rather than
    // billing the platform pool). Resolve the org once for both the gate + meter.
    const org = payload.organizationId
      ? await em.findOne(Organization, { id: payload.organizationId })
      : null
    const gate = await checkOrgAiAllowance(org?.noliOrgId, 'openai')
    if (!gate.allowed) {
      console.warn(`[attachments.ocr] Org over AI allowance, skipping OCR for: ${attachmentId}`)
      return
    }

    const ocrService = new OcrService(gate.byoApiKey ? { apiKey: gate.byoApiKey } : {})

    if (!ocrService.available) {
      console.warn(
        `[attachments.ocr] OPENAI_API_KEY not configured, skipping OCR for: ${attachmentId}`,
      )
      return
    }

    const result = await ocrService.processFile({
      filePath,
      mimeType,
      model: resolvedModel,
    })

    if (!result) {
      console.log(`[attachments.ocr] No content extracted for attachment: ${attachmentId}`)
      return
    }

    const attachment = await em.findOne(Attachment, { id: attachmentId })
    if (!attachment) {
      console.error(`[attachments.ocr] Attachment not found: ${attachmentId}`)
      return
    }

    attachment.content = result.content
    await em.persistAndFlush(attachment)

    // Cross-product usage metering (fire-and-forget; never breaks OCR).
    try {
      if (org?.noliOrgId && ((result.tokensIn ?? 0) > 0 || (result.tokensOut ?? 0) > 0)) {
        void logCrmAiUsage({
          noliOrgId: org.noliOrgId,
          model: result.model ?? resolvedModel,
          tokensIn: result.tokensIn ?? 0,
          tokensOut: result.tokensOut ?? 0,
          feature: 'attachment-ocr',
          byoKey: !!gate.byoApiKey,
        }).catch(() => {})
      }
    } catch {
      /* ignore — metering is best-effort */
    }

    console.log(`[attachments.ocr] Processing completed:`, {
      attachmentId,
      pageCount: result.pageCount,
      contentLength: result.content.length,
      timeMs: result.processingTimeMs,
      totalTimeMs: Date.now() - startTime,
    })
  } catch (error) {
    console.error(`[attachments.ocr] Processing failed:`, {
      attachmentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function requestOcrProcessing(
  em: EntityManager,
  attachment: Attachment,
  filePath: string,
): Promise<void> {
  const payload: OcrRequestedEvent = {
    attachmentId: attachment.id,
    filePath,
    mimeType: attachment.mimeType,
    partitionCode: attachment.partitionCode,
    organizationId: attachment.organizationId ?? null,
    tenantId: attachment.tenantId ?? null,
    userId: attachment.uploadedByUserId ?? null,
  }

  const lease = payload.organizationId
    ? await beginGdprLocalWriteLease(em.getKnex() as never, payload.organizationId, 'processor')
    : null
  if (payload.organizationId && !lease) {
    console.warn(`[attachments.ocr] Suppressed fenced organization OCR: ${attachment.id}`)
    return
  }
  let userLease: GdprLocalWriteLease | null = null
  try {
    userLease = payload.userId
      ? await beginGdprUserWriteLease(em.getKnex() as never, payload.userId, 'processor')
      : null
  } catch (error) {
    await lease?.release()
    throw error
  }
  if (payload.userId && !userLease) {
    await lease?.release()
    console.warn(`[attachments.ocr] Suppressed fenced user OCR: ${attachment.id}`)
    return
  }

  setImmediate(async () => {
    const workerEm = typeof (em as any)?.fork === 'function' ? (em as any).fork() : em
    try {
      await processAttachmentOcr(workerEm, payload)
    } catch (error) {
      console.error(`[attachments.ocr] Background processing error:`, error)
    } finally {
      await userLease?.release().catch((error) => {
        console.error(`[attachments.ocr] GDPR user lease release failed:`, error)
      })
      await lease?.release().catch((error) => {
        console.error(`[attachments.ocr] GDPR processor lease release failed:`, error)
      })
    }
  })
}
