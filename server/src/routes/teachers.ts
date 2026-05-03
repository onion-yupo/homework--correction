/**
 * teachers 路由 — 老师与归属关系管理
 */
import { Hono } from 'hono'
import { getDb } from '../lib/database.js'
import { canSeeAll, getCurrentTeacher, resolveTeacherId } from '../lib/access.js'

const app = new Hono()

/**
 * GET /api/teachers
 * 获取所有老师列表
 */
app.get('/', (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)

  const db = getDb()
  const teachers = canSeeAll(current)
    ? db.prepare('SELECT id, name, role, created_at FROM teachers ORDER BY name').all()
    : db.prepare('SELECT id, name, role, created_at FROM teachers WHERE id = ?').all(current.id)
  return c.json({ teachers })
})

/**
 * GET /api/teachers/:teacherId/enrollments
 * 获取某老师负责的所有 level 和学生
 */
app.get('/:teacherId/enrollments', (c) => {
  const teacherId = resolveTeacherId(c, c.req.param('teacherId'))
  if (!teacherId) return c.json({ error: '未登录' }, 401)
  const db = getDb()

  // 获取老师信息
  const teacher = db.prepare('SELECT id, name, role FROM teachers WHERE id = ?').get(teacherId) as any
  if (!teacher) {
    return c.json({ error: '未找到该老师' }, 404)
  }

  // 获取该老师负责的所有学期（level）
  const semesters = db.prepare(`
    SELECT DISTINCT term, semester FROM enrollments WHERE teacher_id = ? ORDER BY term DESC
  `).all(teacherId) as any[]

  const GRADE_ORDER = '一二三四五六'
  const sw = (s: string) => { const gi = GRADE_ORDER.indexOf(s[0]); return gi >= 0 ? gi * 2 + (s[1] === '下' ? 1 : 0) : 99 }
  semesters.sort((a: any, b: any) => a.term === b.term ? sw(a.semester) - sw(b.semester) : 0)

  // 按 term 分组
  const termMap = new Map<string, string[]>()
  for (const { term, semester } of semesters) {
    if (!termMap.has(term)) termMap.set(term, [])
    termMap.get(term)!.push(semester)
  }

  // 获取每个 term+semester 下的学生列表
  const result: Record<string, Record<string, any[]>> = {}
  for (const [term, semList] of termMap) {
    result[term] = {}
    for (const semester of semList) {
      const students = db.prepare(`
        SELECT s.id, s.name
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        WHERE e.teacher_id = ? AND e.term = ? AND e.semester = ?
        ORDER BY s.name
      `).all(teacherId, term, semester)
      result[term][semester] = students
    }
  }

  return c.json({
    teacher,
    terms: Array.from(termMap.keys()),
    termSemesters: Object.fromEntries(termMap),
    enrollments: result,
  })
})

/**
 * POST /api/teachers
 * 创建老师
 */
app.post('/', async (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)
  if (!canSeeAll(current)) return c.json({ error: '无权创建老师' }, 403)

  const { id, name } = await c.req.json<{ id: string; name: string }>()
  if (!id || !name) return c.json({ error: '缺少 id 或 name' }, 400)

  const db = getDb()
  try {
    db.prepare('INSERT OR IGNORE INTO teachers (id, name) VALUES (?, ?)').run(id, name)
    return c.json({ ok: true, id, name })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

/**
 * POST /api/enrollments
 * 创建归属关系（支持批量）
 */
app.post('/enrollments', async (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)
  if (!canSeeAll(current)) return c.json({ error: '无权创建归属关系' }, 403)

  const body = await c.req.json<{
    teacherId: string
    term: string
    semester: string
    studentNames: string[]
  }>()

  if (!body.teacherId || !body.term || !body.semester || !body.studentNames?.length) {
    return c.json({ error: '缺少 teacherId、term、semester 或 studentNames' }, 400)
  }

  const db = getDb()
  const { ensureStudent } = await import('../lib/db-sync.js')
  const cohort = db.prepare(`
    SELECT camp_id, id AS cohort_id FROM cohorts
    WHERE term = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(body.term) as { camp_id: string; cohort_id: string } | undefined

  const insertEnrollment = db.prepare(`
    INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, term, semester)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  const transaction = db.transaction(() => {
    for (const name of body.studentNames) {
      const studentId = ensureStudent(name)
      insertEnrollment.run(
        body.teacherId,
        studentId,
        cohort?.camp_id || 'camp-calculation',
        cohort?.cohort_id || 'cohort-calculation-2026-03',
        body.term,
        body.semester,
      )
      count++
    }
  })

  transaction()

  return c.json({ ok: true, count })
})

export default app
