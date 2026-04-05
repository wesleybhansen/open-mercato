import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['courses.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['courses.manage'] },
}

export async function PUT(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const lessonId = ctx.params?.id
    if (!lessonId) return NextResponse.json({ ok: false, error: 'Lesson ID required' }, { status: 400 })

    // Verify ownership through module → course → org chain
    const lesson = await knex('course_lessons as cl')
      .join('course_modules as cm', 'cl.module_id', 'cm.id')
      .join('courses as c', 'cm.course_id', 'c.id')
      .where('cl.id', lessonId)
      .where('c.organization_id', auth.orgId)
      .select('cl.id')
      .first()
    if (!lesson) return NextResponse.json({ ok: false, error: 'Lesson not found' }, { status: 404 })

    const body = await req.json()
    const updates: Record<string, unknown> = {}
    if (body.title !== undefined) updates.title = body.title
    if (body.content !== undefined) updates.content = body.content
    if (body.contentType !== undefined) updates.content_type = body.contentType
    if (body.videoUrl !== undefined) updates.video_url = body.videoUrl
    if (body.durationMinutes !== undefined) updates.duration_minutes = body.durationMinutes
    if (body.isFreePreview !== undefined) updates.is_free_preview = body.isFreePreview
    if (body.dripDays !== undefined) updates.drip_days = body.dripDays || null

    await knex('course_lessons').where('id', lessonId).update(updates)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[courses.lessons.update]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const lessonId = ctx.params?.id

    const lesson = await knex('course_lessons as cl')
      .join('course_modules as cm', 'cl.module_id', 'cm.id')
      .join('courses as c', 'cm.course_id', 'c.id')
      .where('cl.id', lessonId)
      .where('c.organization_id', auth.orgId)
      .select('cl.id')
      .first()
    if (!lesson) return NextResponse.json({ ok: false, error: 'Lesson not found' }, { status: 404 })

    await knex('lesson_progress').where('lesson_id', lessonId).delete()
    await knex('course_lessons').where('id', lessonId).delete()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[courses.lessons.delete]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Courses',
  summary: 'Individual lesson operations',
  methods: {
    PUT: { summary: 'Update a lesson', tags: ['Courses'] },
    DELETE: { summary: 'Delete a lesson', tags: ['Courses'] },
  },
}
