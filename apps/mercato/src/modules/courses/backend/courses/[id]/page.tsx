'use client'

import { useState, useEffect } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ArrowLeft, Plus, Trash2, GripVertical, BookOpen, Video, FileText, Save, Loader2, Users, Globe } from 'lucide-react'

type Lesson = { id?: string; title: string; contentType: string; content: string; videoUrl: string; dripDays: string }
type Module = { id?: string; title: string; description: string; lessons: Lesson[] }
type Course = {
  id: string; title: string; description: string; slug: string
  price: string; is_free: boolean; is_published: boolean; enrollment_count: number
  modules?: Module[]
}

export default function CourseEditorPage({ params }: { params: { id: string } }) {
  const [course, setCourse] = useState<Course | null>(null)
  const [modules, setModules] = useState<Module[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/courses/courses/${params.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.data) {
          setCourse(d.data)
          setModules(d.data.modules?.map((m: any) => ({
            id: m.id, title: m.title, description: m.description || '',
            lessons: (m.lessons || []).map((l: any) => ({
              id: l.id, title: l.title, contentType: l.content_type || 'text',
              content: l.content || '', videoUrl: l.video_url || '', dripDays: l.drip_days?.toString() || '',
            })),
          })) || [])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [params.id])

  function addModule() {
    setModules([...modules, { title: '', description: '', lessons: [] }])
  }

  function removeModule(idx: number) {
    setModules(modules.filter((_, i) => i !== idx))
  }

  function updateModule(idx: number, field: string, value: string) {
    setModules(modules.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  function addLesson(modIdx: number) {
    setModules(modules.map((m, i) => i === modIdx ? {
      ...m, lessons: [...m.lessons, { title: '', contentType: 'text', content: '', videoUrl: '', dripDays: '' }]
    } : m))
  }

  function removeLesson(modIdx: number, lesIdx: number) {
    setModules(modules.map((m, i) => i === modIdx ? {
      ...m, lessons: m.lessons.filter((_, j) => j !== lesIdx)
    } : m))
  }

  function updateLesson(modIdx: number, lesIdx: number, field: string, value: string) {
    setModules(modules.map((m, i) => i === modIdx ? {
      ...m, lessons: m.lessons.map((l, j) => j === lesIdx ? { ...l, [field]: value } : l)
    } : m))
  }

  async function saveCourse() {
    setSaving(true)
    try {
      await fetch(`/api/courses/courses/${params.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ modules }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>
  if (!course) return <div className="p-6 text-sm text-muted-foreground">Course not found</div>

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button type="button" onClick={() => window.location.href = '/backend/courses'}
          className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{course.title}</h1>
          <p className="text-xs text-muted-foreground">
            {course.is_free ? 'Free' : `$${Number(course.price).toFixed(2)}`} · {course.enrollment_count} enrolled · /course/{course.slug}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={saveCourse} disabled={saving}>
          {saving ? <Loader2 className="size-3 animate-spin mr-1.5" /> : saved ? '✓ Saved' : <><Save className="size-3 mr-1.5" /> Save</>}
        </Button>
      </div>

      {/* Modules */}
      <div className="space-y-4">
        {modules.map((mod, modIdx) => (
          <div key={modIdx} className="rounded-lg border">
            <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
              <span className="text-xs font-semibold text-muted-foreground">Module {modIdx + 1}</span>
              <Input value={mod.title} onChange={e => updateModule(modIdx, 'title', e.target.value)}
                placeholder="Module title" className="flex-1 h-8 text-sm border-0 bg-transparent font-medium" />
              <IconButton type="button" variant="ghost" size="sm" onClick={() => removeModule(modIdx)} aria-label="Remove module">
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>

            <div className="p-4 space-y-2">
              {mod.lessons.map((lesson, lesIdx) => (
                <div key={lesIdx} className="flex items-start gap-2 group">
                  <span className="text-[10px] text-muted-foreground/60 mt-2.5 w-4 text-right shrink-0">{lesIdx + 1}</span>
                  <div className="flex-1 rounded-md border p-3 space-y-2">
                    <div className="flex gap-2">
                      <Input value={lesson.title} onChange={e => updateLesson(modIdx, lesIdx, 'title', e.target.value)}
                        placeholder="Lesson title" className="flex-1 h-8 text-sm" />
                      <select value={lesson.contentType} onChange={e => updateLesson(modIdx, lesIdx, 'contentType', e.target.value)}
                        className="h-8 rounded-md border bg-card px-2 text-xs w-24">
                        <option value="text">Text</option>
                        <option value="video">Video</option>
                        <option value="file">File</option>
                      </select>
                      <IconButton type="button" variant="ghost" size="xs" onClick={() => removeLesson(modIdx, lesIdx)}
                        className="opacity-0 group-hover:opacity-100" aria-label="Remove lesson">
                        <Trash2 className="size-3" />
                      </IconButton>
                    </div>
                    {lesson.contentType === 'text' && (
                      <textarea value={lesson.content} onChange={e => updateLesson(modIdx, lesIdx, 'content', e.target.value)}
                        placeholder="Lesson content (supports HTML)"
                        className="w-full rounded-md border bg-card px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring h-20" />
                    )}
                    {lesson.contentType === 'video' && (
                      <Input value={lesson.videoUrl} onChange={e => updateLesson(modIdx, lesIdx, 'videoUrl', e.target.value)}
                        placeholder="Video URL (YouTube, Vimeo, etc.)" className="h-8 text-xs" />
                    )}
                    {lesson.dripDays !== undefined && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">Unlock after</span>
                        <Input type="number" value={lesson.dripDays} onChange={e => updateLesson(modIdx, lesIdx, 'dripDays', e.target.value)}
                          placeholder="0" className="w-14 h-7 text-xs" />
                        <span className="text-[10px] text-muted-foreground">days (blank = immediate)</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => addLesson(modIdx)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-6">
                <Plus className="size-3" /> Add Lesson
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addModule}
          className="w-full rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/20 transition flex items-center justify-center gap-2">
          <Plus className="size-4" /> Add Module
        </button>
      </div>
    </div>
  )
}
