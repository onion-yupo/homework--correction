/**
 * 当前老师可访问的营 / 期上下文。
 */
import { Hono } from 'hono'
import { canSeeAll, getCurrentTeacher } from '../lib/access.js'
import { getDb } from '../lib/database.js'

const app = new Hono()

app.get('/', (c) => {
  const teacher = getCurrentTeacher(c)
  if (!teacher) return c.json({ error: '未登录' }, 401)

  const db = getDb()
  const rows = canSeeAll(teacher)
    ? db.prepare(`
      SELECT DISTINCT
        c.id AS camp_id, c.name AS camp_name, c.subject,
        co.id AS cohort_id, co.name AS cohort_name, co.term, co.start_date, co.total_days
      FROM camps c
      JOIN cohorts co ON co.camp_id = c.id
      ORDER BY c.created_at, co.created_at DESC
    `).all() as any[]
    : db.prepare(`
      SELECT DISTINCT
        c.id AS camp_id, c.name AS camp_name, c.subject,
        co.id AS cohort_id, co.name AS cohort_name, co.term, co.start_date, co.total_days
      FROM enrollments e
      JOIN camps c ON c.id = e.camp_id
      JOIN cohorts co ON co.id = e.cohort_id
      WHERE e.teacher_id = ?
      ORDER BY c.created_at, co.created_at DESC
    `).all(teacher.id) as any[]

  const camps = new Map<string, any>()
  for (const row of rows) {
    if (!camps.has(row.camp_id)) {
      camps.set(row.camp_id, {
        id: row.camp_id,
        name: row.camp_name,
        subject: row.subject,
        cohorts: [],
      })
    }
    camps.get(row.camp_id).cohorts.push({
      id: row.cohort_id,
      name: row.cohort_name,
      term: row.term,
      startDate: row.start_date,
      totalDays: row.total_days,
    })
  }

  return c.json({
    teacher,
    camps: Array.from(camps.values()),
  })
})

export default app
