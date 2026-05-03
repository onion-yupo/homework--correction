/**
 * 访问范围工具：从登录态解析当前老师，并提供老师级数据隔离。
 */
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyTeacherToken } from './auth.js'
import { getDb } from './database.js'

export interface CurrentTeacher {
  id: string
  name: string
  role: 'tutor' | 'admin' | 'lecturer'
  feishuOpenId?: string
}

export function getCurrentTeacher(c: Context): CurrentTeacher | null {
  const db = getDb()

  if (process.env.DEV_AUTH_BYPASS === 'true') {
    const teacher = db.prepare(`
      SELECT id, name, role, feishu_open_id
      FROM teachers
      ORDER BY created_at
      LIMIT 1
    `).get() as any
    if (!teacher) return null
    return {
      id: teacher.id,
      name: teacher.name,
      role: teacher.role || 'tutor',
      feishuOpenId: teacher.feishu_open_id || 'dev_open_id',
    }
  }

  const token = getCookie(c, 'auth_token')
  if (!token) return null
  const payload = verifyTeacherToken(token)
  if (!payload) return null

  const teacher = db.prepare(`
    SELECT id, name, role, feishu_open_id
    FROM teachers
    WHERE id = ?
  `).get(payload.teacherId) as any
  if (!teacher) return null

  return {
    id: teacher.id,
    name: teacher.name,
    role: teacher.role || 'tutor',
    feishuOpenId: teacher.feishu_open_id || payload.feishuOpenId,
  }
}

export function canSeeAll(teacher: CurrentTeacher | null): boolean {
  return teacher?.role === 'admin' || teacher?.role === 'lecturer'
}

/**
 * 普通老师只能访问自己；管理员/主讲可以访问指定老师或全局。
 */
export function resolveTeacherId(c: Context, requestedTeacherId?: string | null): string | null {
  const teacher = getCurrentTeacher(c)
  if (!teacher) return requestedTeacherId || null
  if (canSeeAll(teacher)) return requestedTeacherId || null
  return teacher.id
}

export function requireTeacher(c: Context): CurrentTeacher | Response {
  const teacher = getCurrentTeacher(c)
  if (!teacher) {
    return c.json({ error: '未登录' }, 401)
  }
  return teacher
}

export function assertStudentVisible(c: Context, studentId: string, term: string, semester: string): boolean {
  const teacher = getCurrentTeacher(c)
  if (!teacher || canSeeAll(teacher)) return true

  const db = getDb()
  const row = db.prepare(`
    SELECT 1 FROM enrollments
    WHERE teacher_id = ? AND student_id = ? AND term = ? AND semester = ?
    LIMIT 1
  `).get(teacher.id, studentId, term, semester)
  return !!row
}
