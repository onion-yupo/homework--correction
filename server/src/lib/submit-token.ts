/**
 * HMAC-SHA256 Token 工具
 *
 * 收作业 token：studentId:teacherId:term
 * 入营    token：enroll:teacherId:term
 * 通用收作业 token：public-submit:teacherId:term
 *
 * 格式：base64url(payload) + "." + base64url(signature)
 */
import crypto from 'node:crypto'

function secret(): string {
  const s = process.env.TOKEN_SECRET
  if (!s) throw new Error('TOKEN_SECRET 未配置')
  return s
}

function toBase64url(buf: Buffer | string): string {
  const s = typeof buf === 'string' ? Buffer.from(buf) : buf
  return s.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function sign(payload: string): string {
  return toBase64url(crypto.createHmac('sha256', secret()).update(payload).digest())
}

/** 生成收作业专属 token */
export function makeSubmitToken(studentId: string, teacherId: string, term: string): string {
  const payload = `${studentId}:${teacherId}:${term}`
  return `${toBase64url(payload)}.${sign(payload)}`
}

/** 解析收作业 token，验证签名 */
export function parseSubmitToken(token: string): { studentId: string; teacherId: string; term: string } | null {
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return null
  const payload = Buffer.from(payloadB64, 'base64').toString()
  if (sign(payload) !== sig) return null
  const [studentId, teacherId, term] = payload.split(':')
  if (!studentId || !teacherId || !term) return null
  return { studentId, teacherId, term }
}

/** 生成入营 token */
export function makeEnrollToken(teacherId: string, term: string): string {
  const payload = `enroll:${teacherId}:${term}`
  return `${toBase64url(payload)}.${sign(payload)}`
}

/** 解析入营 token，验证签名 */
export function parseEnrollToken(token: string): { teacherId: string; term: string } | null {
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return null
  const payload = Buffer.from(payloadB64, 'base64').toString()
  if (sign(payload) !== sig) return null
  const parts = payload.split(':')
  if (parts[0] !== 'enroll' || !parts[1] || !parts[2]) return null
  return { teacherId: parts[1], term: parts.slice(2).join(':') }
}

/** 生成通用收作业 token（老师 + 期） */
export function makePublicSubmitToken(teacherId: string, term: string): string {
  const payload = `public-submit:${teacherId}:${term}`
  return `${toBase64url(payload)}.${sign(payload)}`
}

/** 解析通用收作业 token，验证签名 */
export function parsePublicSubmitToken(token: string): { teacherId: string; term: string } | null {
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return null
  const payload = Buffer.from(payloadB64, 'base64').toString()
  if (sign(payload) !== sig) return null
  const parts = payload.split(':')
  if (parts[0] !== 'public-submit' || !parts[1] || !parts[2]) return null
  return { teacherId: parts[1], term: parts.slice(2).join(':') }
}
