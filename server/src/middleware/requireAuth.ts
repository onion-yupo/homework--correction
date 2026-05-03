/**
 * 认证中间件 — 校验 JWT Cookie，未登录返回 401
 */
import type { Context, Next } from 'hono'
import { getCurrentTeacher } from '../lib/access.js'

export async function requireAuth(c: Context, next: Next) {
  const teacher = getCurrentTeacher(c)
  if (!teacher) return c.json({ error: '未登录' }, 401)
  c.set('teacher', {
    teacherId: teacher.id,
    feishuOpenId: teacher.feishuOpenId || '',
    name: teacher.name,
  })
  await next()
}
