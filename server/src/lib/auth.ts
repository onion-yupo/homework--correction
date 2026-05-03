/**
 * JWT 工具 — 签发与验证教师登录凭证
 */
import jwt from 'jsonwebtoken'

export interface TeacherPayload {
  teacherId: string
  feishuOpenId: string
  name: string
}

function jwtSecret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET 未配置')
  return s
}

/** 签发 JWT（7 天有效） */
export function signTeacherToken(payload: TeacherPayload): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '7d' })
}

/** 验证 JWT，返回 payload 或 null */
export function verifyTeacherToken(token: string): TeacherPayload | null {
  try {
    return jwt.verify(token, jwtSecret()) as TeacherPayload
  } catch {
    return null
  }
}
