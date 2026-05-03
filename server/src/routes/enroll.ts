/**
 * 入营问卷路由（公开，无需登录）
 *
 * GET  /api/enroll/config/:token — 解析 token，返回老师和期信息
 * POST /api/enroll               — 提交问卷，建立学生档案
 *
 * 以及需要登录的老师工具（在 dashboard.ts 或此处注册均可）：
 * GET  /api/enroll/link          — 老师生成当期入营链接
 */
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { getDb } from '../lib/database.js'
import { parseEnrollToken, makeEnrollToken } from '../lib/submit-token.js'
import { requireAuth } from '../middleware/requireAuth.js'
import type { TeacherPayload } from '../lib/auth.js'

const router = new Hono()

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

function getDefaultCohort(term: string) {
  const db = getDb()
  return db.prepare(`
    SELECT camp_id, id AS cohort_id FROM cohorts
    WHERE term = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(term) as { camp_id: string; cohort_id: string } | undefined
}

function publicUrl(): string {
  return process.env.PUBLIC_URL ?? 'http://localhost:5173/homework'
}

/** GET /api/enroll/config/:token — 校验入营 token，返回基础信息 */
router.get('/config/:token', (c) => {
  const token = c.req.param('token')
  const parsed = parseEnrollToken(token)
  if (!parsed) {
    return c.json({ error: '链接无效或已损坏' }, 400)
  }

  const db = getDb()
  const teacher = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(parsed.teacherId) as { id: string; name: string } | undefined
  if (!teacher) {
    return c.json({ error: '链接中老师不存在' }, 404)
  }
  const cohort = getDefaultCohort(parsed.term)
  const camp = cohort
    ? db.prepare('SELECT id, name FROM camps WHERE id = ?').get(cohort.camp_id) as { id: string; name: string } | undefined
    : undefined

  return c.json({
    teacherId: teacher.id,
    teacherName: teacher.name,
    campName: camp?.name || '营课',
    term: parsed.term,
  })
})

/** POST /api/enroll — 提交入营问卷，自动建档 */
router.post('/', async (c) => {
  const body = await c.req.json() as {
    token: string
    studentName: string
    semester: string
    selfLevel?: string
    weakPoints?: string
    parentConcern?: string
    parentName?: string
    parentPhone?: string
  }

  const { token, studentName, semester } = body
  if (!token || !studentName?.trim() || !semester?.trim()) {
    return c.json({ error: '缺少必要字段：token / studentName / semester' }, 400)
  }

  const parsed = parseEnrollToken(token)
  if (!parsed) {
    return c.json({ error: '链接无效' }, 400)
  }

  const db = getDb()
  const teacher = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(parsed.teacherId) as { id: string } | undefined
  if (!teacher) {
    return c.json({ error: '老师不存在' }, 404)
  }

  const name = studentName.trim()
  const parentPhone = normalizePhone(body.parentPhone || '')
  if (parentPhone.length < 8) {
    return c.json({ error: '请填写有效的家长手机号' }, 400)
  }
  const term = parsed.term
  const cohort = getDefaultCohort(term)

  // 幂等创建学生（按姓名唯一）
  let student = db.prepare('SELECT id FROM students WHERE name = ?').get(name) as { id: string } | undefined
  if (!student) {
    const studentId = `student-${crypto.randomBytes(4).toString('hex')}`
    db.prepare('INSERT INTO students (id, name) VALUES (?, ?)').run(studentId, name)
    student = { id: studentId }
  }

  // 幂等创建 enrollment
  db.prepare(`
    INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, term, semester)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(parsed.teacherId, student.id, cohort?.camp_id || 'camp-calculation', cohort?.cohort_id || 'cohort-calculation-2026-03', term, semester.trim())

  // 创建/更新 student_profiles（入营问卷基线信息）
  db.prepare(`
    INSERT INTO student_profiles (student_id, camp_id, cohort_id, term, parent_name, parent_phone_hash, self_level, weak_points, parent_concern)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, term) DO UPDATE SET
      camp_id        = excluded.camp_id,
      cohort_id      = excluded.cohort_id,
      parent_name    = excluded.parent_name,
      parent_phone_hash = excluded.parent_phone_hash,
      self_level     = excluded.self_level,
      weak_points    = excluded.weak_points,
      parent_concern = excluded.parent_concern
  `).run(
    student.id,
    cohort?.camp_id || 'camp-calculation',
    cohort?.cohort_id || 'cohort-calculation-2026-03',
    term,
    body.parentName?.trim() ?? null,
    hashPhone(parentPhone),
    body.selfLevel?.trim() ?? null,
    body.weakPoints?.trim() ?? null,
    body.parentConcern?.trim() ?? null,
  )

  return c.json({
    success: true,
    studentId: student.id,
    studentName: name,
    term,
    semester: semester.trim(),
  })
})

/** GET /api/enroll/link — 老师生成当期入营链接（需登录） */
router.get('/link', requireAuth, (c) => {
  const teacher = (c as any).get('teacher') as TeacherPayload
  const term = c.req.query('term')
  if (!term) {
    return c.json({ error: '缺少 term 参数' }, 400)
  }
  const token = makeEnrollToken(teacher.teacherId, term)
  const base = publicUrl().replace(/\/$/, '')
  return c.json({
    token,
    url: `${base}/enroll/${token}`,
  })
})

export default router
