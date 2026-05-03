/**
 * 飞书 OAuth 2.0 登录路由
 *
 * GET  /api/auth/login     — 302 到飞书授权页
 * GET  /api/auth/callback  — code 换 token，白名单校验，写 JWT Cookie
 * GET  /api/auth/me        — 返回当前登录老师信息
 * POST /api/auth/logout    — 清除 Cookie
 */
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
function devAuthBypass(): boolean {
  return process.env.DEV_AUTH_BYPASS === 'true'
}

function getDevTeacher() {
  const db = getDb()
  return db.prepare('SELECT id, name, feishu_open_id FROM teachers ORDER BY created_at LIMIT 1').get() as { id: string; name: string; feishu_open_id?: string } | undefined
}

/** 飞书 OAuth 授权页 URL */
function buildOAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    app_id: feishuAppId(),
    redirect_uri: redirectUri,
    scope: 'contact:user.base:readonly',
    response_type: 'code',
  })
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`
}

/** 用 code 换取 user_access_token */
async function exchangeCode(code: string): Promise<{ accessToken: string; openId: string; name: string } | null> {
  // Step 1: 获取 app_access_token
  const appTokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: feishuAppId(), app_secret: feishuAppSecret() }),
  })
  const appTokenData = await appTokenRes.json() as any
  if (!appTokenData.app_access_token) {
    console.error('[auth] 获取 app_access_token 失败', appTokenData)
    return null
  }

  // Step 2: code 换 user_access_token
  const userTokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${appTokenData.app_access_token}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  })
  const userTokenData = await userTokenRes.json() as any
  if (!userTokenData.data?.access_token) {
    console.error('[auth] code 换 token 失败', userTokenData)
    return null
  }

  // Step 3: 获取用户信息
  const userInfoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { 'Authorization': `Bearer ${userTokenData.data.access_token}` },
  })
  const userInfo = await userInfoRes.json() as any
  if (!userInfo.data?.open_id) {
    console.error('[auth] 获取用户信息失败', userInfo)
    return null
  }

  return {
    accessToken: userTokenData.data.access_token,
    openId: userInfo.data.open_id,
    name: userInfo.data.name ?? '',
  }
}

/** GET /api/auth/login — 重定向到飞书 OAuth 页面 */
router.get('/login', async (c) => {
  if (devAuthBypass()) {
    const homeworkBase = publicUrl().endsWith('/homework') ? publicUrl() : `${publicUrl()}/homework`
    return c.redirect(homeworkBase, 302)
  }
  if (!feishuAppId()) {
    return c.json({ error: 'FEISHU_APP_ID 未配置，请联系管理员' }, 500)
  }
  const redirectUri = `${publicUrl().replace(/\/homework$/, '')}/api/auth/callback`
  return c.redirect(buildOAuthUrl(redirectUri), 302)
})

/** GET /api/auth/callback — 飞书 OAuth 回调 */
router.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) {
    return c.html('<h2>授权失败：缺少 code 参数</h2>', 400)
  }

  const userInfo = await exchangeCode(code)
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
  })

  // 302 跳回工作台
  const homeworkBase = publicUrl().endsWith('/homework') ? publicUrl() : `${publicUrl()}/homework`
  return c.redirect(homeworkBase, 302)
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
