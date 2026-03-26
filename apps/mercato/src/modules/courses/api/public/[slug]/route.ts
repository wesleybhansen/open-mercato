import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = { GET: { requireAuth: false } }

export async function GET(req: Request, ctx: any) {
  const slug = ctx?.params?.slug
  if (!slug) return new NextResponse('Not found', { status: 404 })

  try {
    const container = await createRequestContainer()
    const knex = (container.resolve('em') as EntityManager).getKnex()

    const course = await knex('courses').where('slug', slug).where('is_published', true).whereNull('deleted_at').first()
    if (!course) return new NextResponse('Course not found', { status: 404 })

    const modules = await knex('course_modules').where('course_id', course.id).orderBy('sort_order')
    for (const mod of modules) {
      mod.lessons = await knex('course_lessons').where('module_id', mod.id).orderBy('sort_order')
        .select('id', 'title', 'content_type', 'duration_minutes', 'is_free_preview')
    }

    const [{ count }] = await knex('course_enrollments').where('course_id', course.id).where('status', 'active').count()
    const baseUrl = process.env.APP_URL || 'http://localhost:3000'

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${course.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:#fafafa;color:#1a1a1a;line-height:1.6}
.hero{background:#fff;padding:80px 24px;text-align:center;border-bottom:1px solid #eee}
.hero h1{font-size:36px;font-weight:700;max-width:600px;margin:0 auto 12px;letter-spacing:-0.02em}
.hero p{color:#666;font-size:16px;max-width:500px;margin:0 auto 24px}
.meta{display:flex;gap:24px;justify-content:center;font-size:14px;color:#888;margin-bottom:32px}
.cta{display:inline-block;padding:14px 32px;background:#3B82F6;color:#fff;border-radius:8px;font-weight:600;text-decoration:none;font-size:16px}
.cta:hover{background:#2563EB}
.content{max-width:640px;margin:48px auto;padding:0 24px}
.module{margin-bottom:32px}
.module h3{font-size:14px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px}
.lesson{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:1px solid #eee;border-radius:8px;margin-bottom:8px}
.lesson-icon{width:32px;height:32px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:14px}
.lesson-title{font-size:14px;font-weight:500}
.lesson-meta{font-size:12px;color:#888}
.enroll-form{max-width:400px;margin:48px auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #eee}
.enroll-form h2{font-size:20px;font-weight:700;margin-bottom:16px;text-align:center}
.field{margin-bottom:12px}
.field label{display:block;font-size:12px;font-weight:600;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em}
.field input{width:100%;padding:10px 14px;border:1px solid #e5e5e5;border-radius:8px;font-size:14px;font-family:inherit}
.field input:focus{outline:none;border-color:#3B82F6}
.submit{width:100%;padding:12px;background:#3B82F6;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-top:8px}
.submit:hover{background:#2563EB}
.success{text-align:center;padding:32px}.success h2{font-size:20px;margin-bottom:8px}.success p{color:#666}
</style></head>
<body>
<div class="hero">
  <h1>${course.title}</h1>
  ${course.description ? `<p>${course.description}</p>` : ''}
  <div class="meta">
    <span>${modules.length} modules</span>
    <span>${modules.reduce((s: number, m: any) => s + (m.lessons?.length || 0), 0)} lessons</span>
    <span>${Number(count)} enrolled</span>
  </div>
  <a href="#enroll" class="cta">${course.is_free ? 'Enroll Free' : `Enroll — $${Number(course.price).toFixed(2)}`}</a>
</div>
<div class="content">
  <h2 style="font-size:20px;font-weight:700;margin-bottom:24px">What You'll Learn</h2>
  ${modules.map((m: any) => `
    <div class="module">
      <h3>${m.title}</h3>
      ${(m.lessons || []).map((l: any) => `
        <div class="lesson">
          <div class="lesson-icon">${l.content_type === 'video' ? '▶' : '📄'}</div>
          <div>
            <div class="lesson-title">${l.title}</div>
            ${l.duration_minutes ? `<div class="lesson-meta">${l.duration_minutes} min</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('')}
</div>
<div class="enroll-form" id="enroll">
  <h2>${course.is_free ? 'Enroll for Free' : `Enroll — $${Number(course.price).toFixed(2)}`}</h2>
  <form onsubmit="enroll(event)" id="enrollForm">
    <div class="field"><label>Your Name</label><input type="text" name="name" required placeholder="Jane Doe"></div>
    <div class="field"><label>Email</label><input type="email" name="email" required placeholder="jane@example.com"></div>
    <button type="submit" class="submit" id="enrollBtn">Enroll Now</button>
  </form>
  <div class="success" id="success" style="display:none">
    <h2>You're Enrolled!</h2>
    <p>Check your email for access instructions.</p>
  </div>
</div>
<script>
async function enroll(e) {
  e.preventDefault();
  var btn = document.getElementById('enrollBtn');
  btn.disabled = true; btn.textContent = 'Enrolling...';
  var fd = new FormData(e.target);
  try {
    var res = await fetch('${baseUrl}/api/courses/enrollments', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({courseId:'${course.id}',studentName:fd.get('name'),studentEmail:fd.get('email')})
    });
    var data = await res.json();
    if (data.ok) {
      document.getElementById('enrollForm').style.display='none';
      document.getElementById('success').style.display='block';
    } else if (data.requiresPayment) {
      alert('This course requires payment. Payment integration coming soon!');
      btn.disabled=false; btn.textContent='Enroll Now';
    } else {
      alert(data.message || data.error || 'Enrollment failed');
      btn.disabled=false; btn.textContent='Enroll Now';
    }
  } catch { alert('Error. Try again.'); btn.disabled=false; btn.textContent='Enroll Now'; }
}
</script>
</body></html>`

    return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (error) {
    console.error('[courses.public]', error)
    return new NextResponse('Server error', { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Courses', summary: 'Public course page',
  methods: { GET: { summary: 'Serve public course enrollment page', tags: ['Courses (Public)'] } },
}
