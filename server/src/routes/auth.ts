/**
 * 飞书 OAuth 2.0 登录路由
 *
 * GET  /api/auth/login     — 302 到飞书授权页
 * GET  /api/auth/callback  — code 换 token，白名单校验，写 JWT Cookie
 * GET  /api/auth/me        — 返回当前登录老师信息
 * POST /api/auth/logout    — 清除 Cookie
 */
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { getDb } from '../lib/database.js'
import { signTeacherToken, verifyTeacherToken } from '../lib/auth.js'

const router = new Hono()

function feishuAppId(): string {
  return process.env.FEISHU_APP_ID ?? ''
}
function feishuAppSecret(): string {
  return process.env.FEISHU_APP_SECRET ?? ''
}
function publicUrl(): string {
  return process.env.PUBLIC_URL ?? 'http://localhost:5173/homework'
}
function publicApiBase(): string {
  return process.env.PUBLIC_API_BASE ?? '/api'
}
function devAuthBypass(): boolean {
  return process.env.DEV_AUTH_BYPASS === 'true'
}
function oauthScope(): string {
  return process.env.FEISHU_OAUTH_SCOPE ?? 'auth:user.id:read user_profile'
}
function frontendUrl(path = ''): string {
  const base = publicUrl().replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
function authCallbackUrl(): string {
  if (process.env.FEISHU_REDIRECT_URI) return process.env.FEISHU_REDIRECT_URI
  const origin = new URL(publicUrl()).origin
  return `${origin}${publicApiBase().replace(/\/$/, '')}/auth/callback`
}

function getDevTeacher() {
  const db = getDb()
  return db.prepare('SELECT id, name, feishu_open_id FROM teachers ORDER BY created_at LIMIT 1').get() as { id: string; name: string; feishu_open_id?: string } | undefined
}

/** 飞书 OAuth 授权页 URL */
function buildOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: feishuAppId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: oauthScope(),
    state,
  })
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${params}`
}

/** 用 code 换取 user_access_token */
async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; openId: string; name: string } | null> {
  const userTokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: feishuAppId(),
      client_secret: feishuAppSecret(),
      code,
      redirect_uri: redirectUri,
    }),
  })
  const userTokenData = await userTokenRes.json() as any
  if (userTokenData.code !== 0 || !userTokenData.access_token) {
    console.error('[auth] code 换 token 失败', userTokenData)
    return null
  }

  const userInfoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { 'Authorization': `Bearer ${userTokenData.access_token}` },
  })
  const userInfo = await userInfoRes.json() as any
  if (userInfo.code !== 0 || !userInfo.data?.open_id) {
    console.error('[auth] 获取用户信息失败', userInfo)
    return null
  }

  return {
    accessToken: userTokenData.access_token,
    openId: userInfo.data.open_id,
    name: userInfo.data.name ?? '',
  }
}

/** GET /api/auth/login — 重定向到飞书 OAuth 页面 */
router.get('/login', async (c) => {
  if (devAuthBypass()) {
    return c.redirect(frontendUrl(), 302)
  }
  if (!feishuAppId() || !feishuAppSecret()) {
    return c.json({ error: '飞书应用未配置，请联系管理员设置 FEISHU_APP_ID / FEISHU_APP_SECRET' }, 500)
  }
  const redirectUri = authCallbackUrl()
  const state = crypto.randomUUID()
  setCookie(c, 'feishu_oauth_state', state, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 10 * 60,
    path: '/',
    secure: publicUrl().startsWith('https://'),
  })
  return c.redirect(buildOAuthUrl(redirectUri, state), 302)
})

/** GET /api/auth/callback — 飞书 OAuth 回调 */
router.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const savedState = getCookie(c, 'feishu_oauth_state')
  deleteCookie(c, 'feishu_oauth_state', { path: '/' })
  if (!code) {
    return c.html('<h2>授权失败：缺少 code 参数</h2>', 400)
  }
  if (!state || !savedState || state !== savedState) {
    return c.html('<h2>授权失败：state 校验不通过，请重新登录</h2>', 400)
  }

  const userInfo = await exchangeCode(code, authCallbackUrl())
  if (!userInfo) {
    return c.html('<h2>飞书登录失败，请重试</h2>', 500)
  }

  // 白名单校验：在 teachers 表按 feishu_open_id 查找
  const db = getDb()
  const teacher = db.prepare('SELECT id, name FROM teachers WHERE feishu_open_id = ?').get(userInfo.openId) as { id: string; name: string } | undefined

  if (!teacher) {
    console.warn(`[auth] 飞书账号未绑定老师：name=${userInfo.name}, open_id=${userInfo.openId}`)
    return c.html(
      `<h2>无权访问</h2><p>你的飞书账号（${userInfo.name}）未在系统白名单中，请联系管理员。</p>`,
      403,
    )
  }

  const token = signTeacherToken({
    teacherId: teacher.id,
    feishuOpenId: userInfo.openId,
    name: teacher.name,
  })

  // httpOnly Cookie，同站
  setCookie(c, 'auth_token', token, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
    secure: publicUrl().startsWith('https://'),
  })

  // 302 跳回工作台
  return c.redirect(frontendUrl(), 302)
})

/** GET /api/auth/me — 返回当前登录老师信息 */
router.get('/me', (c) => {
  if (devAuthBypass()) {
    const teacher = getDevTeacher()
    if (!teacher) return c.json({ error: 'DEV_AUTH_BYPASS 已开启，但没有老师数据' }, 500)
    return c.json({
      teacher: {
        teacherId: teacher.id,
        feishuOpenId: teacher.feishu_open_id || 'dev_open_id',
        name: teacher.name,
      },
    })
  }

  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: '未登录' }, 401)
  const payload = verifyTeacherToken(token)
  if (!payload) return c.json({ error: 'Token 无效或已过期' }, 401)
  return c.json({ teacher: payload })
})

/** POST /api/auth/logout — 清除 Cookie */
router.post('/logout', (c) => {
  deleteCookie(c, 'auth_token', { path: '/' })
  return c.json({ success: true })
})

export default router
