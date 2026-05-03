/**
 * 家长收作业表单路由（公开，token 鉴权）
 *
 * GET  /api/submit/config/:token — 解析 token，返回学生姓名等信息
 * POST /api/submit/:token        — 接收图片，接入现有批改队列
 * GET  /api/submit/links         — 老师获取自己负责学生的专属链接（需登录）
 */
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { getDb } from '../lib/database.js'
import { parseSubmitToken, makeSubmitToken, parsePublicSubmitToken } from '../lib/submit-token.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { saveJob, saveImage, listJobs, normalizeSemester, normalizeImageRotation } from '../lib/storage.js'
import type { TeacherPayload } from '../lib/auth.js'
import { advanceJobQueue, prepareSubmittedJob } from '../lib/job-queue.js'

const router = new Hono()

function publicUrl(): string {
  return process.env.PUBLIC_URL ?? 'http://localhost:5173/homework'
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

function asFileList(value: unknown): File[] {
  if (Array.isArray(value)) return value.filter((item): item is File => item instanceof File)
  return value instanceof File ? [value] : []
}

function parseStringList(value: unknown, fallback: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return [value]
    }
  }
  return fallback ? [String(fallback)] : []
}

function getCampName(term: string): string {
  const db = getDb()
  const row = db.prepare(`
    SELECT c.name
    FROM cohorts co
    JOIN camps c ON c.id = co.camp_id
    WHERE co.term = ?
    ORDER BY co.created_at DESC
    LIMIT 1
  `).get(term) as { name: string } | undefined
  return row?.name || '营课'
}

/** GET /api/submit/public/config/:token — 通用收作业链接配置 */
router.get('/public/config/:token', (c) => {
  const token = c.req.param('token')
  const parsed = parsePublicSubmitToken(token)
  if (!parsed) return c.json({ error: '链接无效或已损坏' }, 400)

  const db = getDb()
  const teacher = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(parsed.teacherId) as { id: string; name: string } | undefined
  if (!teacher) return c.json({ error: '老师不存在' }, 404)

  return c.json({
    teacherId: teacher.id,
    teacherName: teacher.name,
    campName: getCampName(parsed.term),
    term: parsed.term,
  })
})

/** POST /api/submit/public/bind — 家长首次绑定：学生姓名 + 手机号 */
router.post('/public/bind', async (c) => {
  const body = await c.req.json<{
    token: string
    studentName: string
    parentPhone: string
  }>()
  const parsed = parsePublicSubmitToken(body.token)
  if (!parsed) return c.json({ error: '链接无效' }, 400)

  const studentName = body.studentName?.trim()
  const phone = normalizePhone(body.parentPhone || '')
  if (!studentName || phone.length < 8) {
    return c.json({ error: '请填写学生姓名和有效手机号' }, 400)
  }

  const db = getDb()
  const matches = db.prepare(`
    SELECT
      s.id AS student_id,
      s.name AS student_name,
      e.teacher_id,
      e.term,
      e.semester,
      e.camp_id,
      e.cohort_id,
      sp.parent_phone_hash
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.term = e.term
    WHERE e.teacher_id = ? AND e.term = ? AND s.name = ?
    ORDER BY e.created_at DESC
  `).all(parsed.teacherId, parsed.term, studentName) as any[]

  if (!matches.length) return c.json({ error: '未找到该学生，请确认姓名或联系老师' }, 404)
  if (matches.length > 1) return c.json({ error: '存在同名学生，请联系老师确认后再提交' }, 409)

  const match = matches[0]
  const phoneHash = hashPhone(phone)
  if (match.parent_phone_hash && match.parent_phone_hash !== phoneHash) {
    return c.json({ error: '手机号与学生档案不匹配，请联系老师确认' }, 403)
  }

  db.prepare(`
    INSERT INTO student_profiles (student_id, camp_id, cohort_id, term, parent_phone_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, term) DO UPDATE SET
      camp_id = COALESCE(student_profiles.camp_id, excluded.camp_id),
      cohort_id = COALESCE(student_profiles.cohort_id, excluded.cohort_id),
      parent_phone_hash = COALESCE(student_profiles.parent_phone_hash, excluded.parent_phone_hash)
  `).run(match.student_id, match.camp_id, match.cohort_id, match.term, phoneHash)

  const submitToken = makeSubmitToken(match.student_id, parsed.teacherId, parsed.term)
  return c.json({
    ok: true,
    submitToken,
    student: {
      studentId: match.student_id,
      studentName: match.student_name,
      semester: match.semester,
      term: match.term,
    },
  })
})

/** GET /api/submit/config/:token — 校验 token，返回学生信息 */
router.get('/config/:token', (c) => {
  const token = c.req.param('token')
  const parsed = parseSubmitToken(token)
  if (!parsed) {
    return c.json({ error: '链接无效或已损坏' }, 400)
  }

  const db = getDb()
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(parsed.studentId) as { id: string; name: string } | undefined
  if (!student) {
    return c.json({ error: '学生不存在' }, 404)
  }

  const teacher = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(parsed.teacherId) as { id: string; name: string } | undefined

  return c.json({
    studentId: student.id,
    studentName: student.name,
    teacherName: teacher?.name ?? '',
    campName: getCampName(parsed.term),
    term: parsed.term,
  })
})

/** POST /api/submit/:token — 接收图片，接入批改队列（复用现有 /api/correction/submit 逻辑） */
router.post('/:token', async (c) => {
  const token = c.req.param('token')
  const parsed = parseSubmitToken(token)
  if (!parsed) {
    return c.json({ error: '链接无效' }, 400)
  }

  const db = getDb()
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(parsed.studentId) as { id: string; name: string } | undefined
  if (!student) {
    return c.json({ error: '学生不存在' }, 404)
  }

  const body = await c.req.parseBody({ all: true })
  const files = asFileList(body.images).length ? asFileList(body.images) : asFileList(body.image)
  if (!files.length) {
    return c.json({ error: '请上传图片文件' }, 400)
  }
  if (files.length > 9) {
    return c.json({ error: '一次最多上传 9 张作业图片' }, 400)
  }

  const semesters = parseStringList(body.semesters, body.semester)
  const days = parseStringList(body.days, body.day)
  const submittedJobs: { jobId: string; semester: string; day: string }[] = []

  for (const [index, file] of files.entries()) {
    const arrayBuffer = await file.arrayBuffer()
    if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
      return c.json({ error: `第 ${index + 1} 张图片过大，请控制在 10MB 以内` }, 413)
    }

    const semester = normalizeSemester(semesters[index] || semesters[0] || '')
    const day = days[index] || days[0] || ''

    let buffer: Buffer = Buffer.from(arrayBuffer)
    let ext = file.type?.includes('png') ? 'png' : 'jpg'

    try {
      const normalized = await normalizeImageRotation(buffer)
      buffer = normalized.buffer
      ext = normalized.ext
    } catch {
      // 非致命，忽略
    }

    const localId = `pending_${Date.now()}_${index}_${crypto.randomBytes(4).toString('hex')}`
    saveImage(localId, buffer, ext)
    const job = prepareSubmittedJob(localId, {
      jobStatus: 'PENDING',
      studentId: parsed.studentId,
      studentName: student.name,
      semester,
      day,
      term: parsed.term,
      teacherId: parsed.teacherId,
      teacherName: '',
      source: 'parent_submit',
      savedAt: new Date().toISOString(),
    })
    saveJob(localId, job)
    submittedJobs.push({ jobId: localId, semester, day })
  }

  const hasProcessing = listJobs().some(j => j.jobStatus === 'PROCESSING')
  console.log(`[Submit/Parent] 家长提交 studentId=${parsed.studentId} count=${submittedJobs.length} hasProcessing=${hasProcessing}`)
  advanceJobQueue().catch(err => console.error('[Submit/Parent] 推进队列失败:', err))

  return c.json({
    success: true,
    jobId: submittedJobs[0]?.jobId,
    submittedJobs,
    queued: true,
    message: `已收到 ${submittedJobs.length} 份作业，老师正在批改中`,
  })
})

/** GET /api/submit/links — 老师获取自己负责学生的专属链接（需登录） */
router.get('/links', requireAuth, (c) => {
  const teacher = (c as any).get('teacher') as TeacherPayload
  const term = c.req.query('term')

  const db = getDb()
  let query = `
    SELECT s.id, s.name, e.term, e.semester
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.teacher_id = ?
  `
  const params: string[] = [teacher.teacherId]
  if (term) {
    query += ' AND e.term = ?'
    params.push(term)
  }
  query += ' ORDER BY e.semester, s.name'

  const rows = db.prepare(query).all(...params) as { id: string; name: string; term: string; semester: string }[]
  const base = publicUrl().replace(/\/$/, '')

  const links = rows.map(r => ({
    studentId: r.id,
    studentName: r.name,
    term: r.term,
    semester: r.semester,
    token: makeSubmitToken(r.id, teacher.teacherId, r.term),
    url: `${base}/submit/${makeSubmitToken(r.id, teacher.teacherId, r.term)}`,
  }))

  return c.json({ links })
})

export default router
