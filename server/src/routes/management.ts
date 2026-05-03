/**
 * 班主任工作台 / 管理路由
 *
 * 提供交付前最小运营闭环：今日任务、学生列表、收作业链接、入营链接、老师轻量管理。
 */
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { canSeeAll, getCurrentTeacher, resolveTeacherId } from '../lib/access.js'
import { getDb } from '../lib/database.js'
import { makeEnrollToken, makeSubmitToken, makePublicSubmitToken } from '../lib/submit-token.js'
import { listJobs } from '../lib/storage.js'
import { isValidDay, normalizeJobListStatus } from '../lib/job-queue.js'

const app = new Hono()

function publicUrl(): string {
  return process.env.PUBLIC_URL ?? 'http://localhost:5173/homework'
}

function getCohortByTerm(term: string) {
  const db = getDb()
  return db.prepare(`
    SELECT camp_id, id AS cohort_id
    FROM cohorts
    WHERE term = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(term) as { camp_id: string; cohort_id: string } | undefined
}

function tokenSecret(): string {
  const secret = process.env.TOKEN_SECRET
  if (!secret) throw new Error('TOKEN_SECRET 未配置')
  return secret
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

function hashPhone(phone: string): string {
  return crypto.createHmac('sha256', tokenSecret()).update(normalizePhone(phone)).digest('hex')
}

function ensureStudent(name: string): string {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM students WHERE name = ?').get(name) as { id: string } | undefined
  if (existing) return existing.id

  const id = `student-${crypto.randomBytes(4).toString('hex')}`
  db.prepare('INSERT INTO students (id, name) VALUES (?, ?)').run(id, name)
  return id
}

app.get('/overview', (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)

  const term = c.req.query('term')
  if (!term) return c.json({ error: '缺少 term 参数' }, 400)
  const campId = c.req.query('campId')
  const cohortId = c.req.query('cohortId')

  const teacherId = resolveTeacherId(c, c.req.query('teacherId')) || current.id
  const db = getDb()
  const base = publicUrl().replace(/\/$/, '')
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()

  const teachers = canSeeAll(current)
    ? db.prepare('SELECT id, name, role, feishu_open_id FROM teachers ORDER BY name').all() as any[]
    : db.prepare('SELECT id, name, role, feishu_open_id FROM teachers WHERE id = ?').all(current.id) as any[]

  const rows = db.prepare(`
    SELECT
      s.id,
      s.name,
      e.semester,
      e.term,
      e.teacher_id,
      t.name AS teacher_name,
      MAX(j.submitted_at) AS last_submitted_at,
      COUNT(j.job_id) AS job_count,
      SUM(CASE WHEN j.review_status != 'reviewed' AND COALESCE(j.frozen, 0) = 0 THEN 1 ELSE 0 END) AS pending_review_count,
      SUM(CASE WHEN j.review_status = 'reviewed' AND j.feedback_status != 'sent' AND COALESCE(j.frozen, 0) = 0 THEN 1 ELSE 0 END) AS pending_feedback_count
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN teachers t ON t.id = e.teacher_id
    LEFT JOIN jobs j ON j.student_id = e.student_id
      AND j.teacher_id = e.teacher_id
      AND j.term = e.term
      AND j.semester = e.semester
      AND (? IS NULL OR j.camp_id = ?)
      AND (? IS NULL OR j.cohort_id = ?)
    WHERE e.teacher_id = ? AND e.term = ?
      AND (? IS NULL OR e.camp_id = ?)
      AND (? IS NULL OR e.cohort_id = ?)
    GROUP BY s.id, s.name, e.semester, e.term, e.teacher_id, t.name
    ORDER BY e.semester, s.name
  `).all(campId || null, campId || null, cohortId || null, cohortId || null, teacherId, term, campId || null, campId || null, cohortId || null, cohortId || null) as any[]

  const pendingReview = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM jobs
    WHERE teacher_id = ? AND term = ? AND review_status != 'reviewed' AND COALESCE(frozen, 0) = 0
      AND (? IS NULL OR camp_id = ?)
      AND (? IS NULL OR cohort_id = ?)
  `).get(teacherId, term, campId || null, campId || null, cohortId || null, cohortId || null) as any

  const pendingFeedback = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM jobs
    WHERE teacher_id = ? AND term = ? AND review_status = 'reviewed' AND feedback_status != 'sent' AND COALESCE(frozen, 0) = 0
      AND (? IS NULL OR camp_id = ?)
      AND (? IS NULL OR cohort_id = ?)
  `).get(teacherId, term, campId || null, campId || null, cohortId || null, cohortId || null) as any

  const taskRows = db.prepare(`
    SELECT j.job_id, j.day, j.review_status, j.feedback_status, j.submitted_at, s.name AS student_name, j.semester
    FROM jobs j
    JOIN students s ON s.id = j.student_id
    WHERE j.teacher_id = ? AND j.term = ? AND COALESCE(j.frozen, 0) = 0
      AND (? IS NULL OR j.camp_id = ?)
      AND (? IS NULL OR j.cohort_id = ?)
      AND (j.review_status != 'reviewed' OR (j.review_status = 'reviewed' AND j.feedback_status != 'sent'))
    ORDER BY j.submitted_at DESC
    LIMIT 12
  `).all(teacherId, term, campId || null, campId || null, cohortId || null, cohortId || null) as any[]

  const submittedTodayIds = new Set(
    (db.prepare(`
      SELECT DISTINCT student_id
      FROM jobs
      WHERE teacher_id = ? AND term = ? AND submitted_at >= ?
        AND (? IS NULL OR camp_id = ?)
        AND (? IS NULL OR cohort_id = ?)
    `).all(teacherId, term, todayStart, campId || null, campId || null, cohortId || null, cohortId || null) as { student_id: string }[]).map(r => r.student_id),
  )

  const students = rows.map(row => {
    const token = makeSubmitToken(row.id, teacherId, row.term)
    return {
      studentId: row.id,
      studentName: row.name,
      semester: row.semester,
      term: row.term,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      jobCount: row.job_count || 0,
      lastSubmittedAt: row.last_submitted_at,
      pendingReviewCount: row.pending_review_count || 0,
      pendingFeedbackCount: row.pending_feedback_count || 0,
      submittedToday: submittedTodayIds.has(row.id),
      submitToken: token,
      submitUrl: `${base}/submit/${token}`,
    }
  })

  const enrollToken = makeEnrollToken(teacherId, term)
  const publicSubmitToken = makePublicSubmitToken(teacherId, term)
  const scopedStudents = new Map(students.map(s => [s.studentId, s]))
  const queueJobs = listJobs().filter((job: any) => {
    if (job.term !== term) return false
    if (job.teacherId !== teacherId) return false
    if (job.jobStatus === 'DONE' || job.jobStatus === 'IGNORED') return false
    if (job.studentId && scopedStudents.has(job.studentId)) return true
    return students.some(s => s.studentName === job.studentName && s.semester === job.semester)
  }) as any[]

  const queueSubmittedTodayIds = new Set<string>()
  for (const job of queueJobs) {
    const savedAt = String(job.savedAt ?? '')
    if (savedAt >= todayStart) {
      const sid = String(job.studentId || '')
      if (sid) queueSubmittedTodayIds.add(sid)
    }
  }
  for (const student of students) {
    if (queueSubmittedTodayIds.has(student.studentId)) {
      student.submittedToday = true
      const latest = queueJobs
        .filter((job: any) => job.studentId === student.studentId)
        .map((job: any) => String(job.savedAt ?? ''))
        .sort()
        .at(-1)
      if (latest && (!student.lastSubmittedAt || latest > student.lastSubmittedAt)) {
        student.lastSubmittedAt = latest
      }
    }
  }

  const operationalTasks = queueJobs
    .map((job: any) => ({
      jobId: String(job.jobId),
      studentName: String(job.studentName ?? ''),
      semester: String(job.semester ?? ''),
      day: isValidDay(job.day) ? Number(job.day) : null,
      status: normalizeJobListStatus(job.jobStatus),
      submittedAt: String(job.savedAt ?? ''),
      errorMessage: String(job.errorMessage ?? ''),
    }))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  const allTaskRows = [
    ...operationalTasks,
    ...taskRows.map(row => ({
      jobId: row.job_id,
      studentName: row.student_name,
      semester: row.semester,
      day: row.day,
      status: row.review_status !== 'reviewed' ? 'pending-review' : 'pending-feedback',
      submittedAt: row.submitted_at,
      errorMessage: '',
    })),
  ].slice(0, 16)
  const submittedCount = new Set([...submittedTodayIds, ...queueSubmittedTodayIds]).size
  const noSubmitToday = students.filter(s => !s.submittedToday).slice(0, 10)

  return c.json({
    currentTeacher: current,
    selectedTeacherId: teacherId,
    term,
    teachers,
    summary: {
      studentCount: students.length,
      todaySubmittedCount: submittedCount,
      pendingReviewCount: pendingReview?.cnt || 0,
      pendingFeedbackCount: pendingFeedback?.cnt || 0,
      submittedPendingCount: queueJobs.filter((job: any) => ['PENDING', 'PROCESSING'].includes(job.jobStatus)).length,
      needsDayCount: queueJobs.filter((job: any) => job.jobStatus === 'NEEDS_DAY_CONFIRMATION').length,
      failedCount: queueJobs.filter((job: any) => job.jobStatus === 'FAIL').length,
      noSubmitTodayCount: students.length - submittedCount,
    },
    tasks: {
      pending: allTaskRows,
      noSubmitToday,
    },
    links: {
      enrollToken,
      enrollUrl: `${base}/enroll/${enrollToken}`,
      publicSubmitToken,
      publicSubmitUrl: `${base}/submit/public/${publicSubmitToken}`,
    },
    students,
  })
})

app.post('/students', async (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)

  const body = await c.req.json<{
    studentName: string
    semester: string
    term: string
    parentPhone: string
    teacherId?: string
  }>()
  const name = body.studentName?.trim()
  const semester = body.semester?.trim()
  const term = body.term?.trim()
  const parentPhone = normalizePhone(body.parentPhone || '')
  if (!name || !semester || !term) return c.json({ error: '缺少 studentName、semester 或 term' }, 400)
  if (parentPhone.length < 8) return c.json({ error: '请填写有效的家长手机号' }, 400)

  const teacherId = canSeeAll(current) ? (body.teacherId || current.id) : current.id
  const cohort = getCohortByTerm(term)
  const studentId = ensureStudent(name)
  const db = getDb()

  db.prepare(`
    INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, term, semester)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    teacherId,
    studentId,
    cohort?.camp_id || 'camp-calculation',
    cohort?.cohort_id || 'cohort-calculation-2026-03',
    term,
    semester,
  )

  db.prepare(`
    INSERT INTO student_profiles (student_id, camp_id, cohort_id, term, parent_phone_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, term) DO UPDATE SET
      camp_id = COALESCE(student_profiles.camp_id, excluded.camp_id),
      cohort_id = COALESCE(student_profiles.cohort_id, excluded.cohort_id),
      parent_phone_hash = excluded.parent_phone_hash
  `).run(
    studentId,
    cohort?.camp_id || 'camp-calculation',
    cohort?.cohort_id || 'cohort-calculation-2026-03',
    term,
    hashPhone(parentPhone),
  )

  return c.json({ ok: true, studentId, teacherId, term, semester })
})

app.post('/teachers', async (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)
  if (!canSeeAll(current)) return c.json({ error: '只有管理员/主讲可新增老师' }, 403)

  const body = await c.req.json<{
    id?: string
    name: string
    role?: string
    feishuOpenId?: string
  }>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: '缺少老师姓名' }, 400)

  const id = body.id?.trim() || `teacher-${crypto.randomBytes(4).toString('hex')}`
  const role = ['tutor', 'admin', 'lecturer'].includes(body.role || '') ? body.role : 'tutor'

  const db = getDb()
  db.prepare(`
    INSERT INTO teachers (id, name, role, feishu_open_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      feishu_open_id = excluded.feishu_open_id
  `).run(id, name, role, body.feishuOpenId?.trim() || null)

  return c.json({ ok: true, teacher: { id, name, role, feishuOpenId: body.feishuOpenId || '' } })
})

export default app
