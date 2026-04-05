import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['courses.manage'] },
}

export async function DELETE(req: Request, ctx: any) {
  const auth = ctx?.auth
  if (!auth?.orgId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()
    const moduleId = ctx.params?.id

    const mod = await knex('course_modules as cm')
      .join('courses as c', 'cm.course_id', 'c.id')
      .where('cm.id', moduleId)
      .where('c.organization_id', auth.orgId)
      .select('cm.id')
      .first()
    if (!mod) return NextResponse.json({ ok: false, error: 'Module not found' }, { status: 404 })

    // Delete lesson progress, then lessons, then module
    const lessonIds = await knex('course_lessons').where('module_id', moduleId).pluck('id')
    if (lessonIds.length > 0) {
      await knex('lesson_progress').whereIn('lesson_id', lessonIds).delete()
      await knex('course_lessons').where('module_id', moduleId).delete()
    }
    await knex('course_modules').where('id', moduleId).delete()

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[courses.modules.delete]', error)
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Courses',
  summary: 'Module operations',
  methods: { DELETE: { summary: 'Delete a module and its lessons', tags: ['Courses'] } },
}
