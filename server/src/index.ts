import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { config } from 'dotenv'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import correctionRoute from './routes/correction.js'
import feedbackRoute from './routes/feedback.js'
import jobsRoute from './routes/jobs.js'
import visionRoute from './routes/vision.js'
import teachersRoute from './routes/teachers.js'
import dashboardRoute from './routes/dashboard.js'
import analyticsRoute from './routes/analytics.js'
import reportRoute from './routes/report.js'
import authRoute from './routes/auth.js'
import submitRoute from './routes/submit.js'
import enrollRoute from './routes/enroll.js'
import contextRoute from './routes/context.js'
import managementRoute from './routes/management.js'
import { getDb, closeDb } from './lib/database.js'
import { startJobQueueWorker } from './lib/job-queue.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env') })

// 初始化 SQLite 数据库（建表 + 索引）
getDb()
const queueWorker = startJobQueueWorker()

const app = new Hono()

app.use('*', logger())
app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

/** 多图提交上限约 60MB，单张图片仍在提交接口内限制 10MB */
app.use('/api/*', async (c, next) => {
  const contentLength = Number(c.req.header('content-length') ?? 0)
  if (contentLength > 60 * 1024 * 1024) {
    return c.json({ error: '请求体过大，请减少图片数量后重试' }, 413)
  }
  await next()
})

app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.get('/api/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.route('/api/auth', authRoute)
app.route('/api/context', contextRoute)
app.route('/api/management', managementRoute)
app.route('/api/submit', submitRoute)
app.route('/api/enroll', enrollRoute)
app.route('/api/correction', correctionRoute)
app.route('/api/feedback', feedbackRoute)
app.route('/api/jobs', jobsRoute)
app.route('/api/vision', visionRoute)
app.route('/api/teachers', teachersRoute)
app.route('/api/dashboard', dashboardRoute)
app.route('/api/analytics', analyticsRoute)
app.route('/api/report', reportRoute)

app.notFound(c => c.json({ error: '接口不存在' }, 404))

app.onError((err, c) => {
  console.error('[Server Error]', err)
  return c.json({ error: err.message ?? '服务器内部错误' }, 500)
})

const port = Number(process.env.PORT ?? 3100)

console.log(`🚀 计算营 AI Copilot 后端启动`)
console.log(`   端口：${port}`)
console.log(`   接口：`)
console.log(`     POST /api/correction/submit      - 提交批改任务（上传图片）`)
console.log(`     POST /api/correction/submit-url   - 提交批改任务（图片URL，同步返回）`)
console.log(`     POST /api/correction/submit-file  - 提交批改任务（文件上传，同步返回，供OpenClaw调用）`)
console.log(`     GET  /api/correction/query        - 查询批改结果（轮询）`)
console.log(`     GET  /api/correction/result/:id   - 获取已存储的批改结果`)
console.log(`     GET  /api/correction/image/:id    - 获取已存储的作业图片`)
console.log(`     POST /api/feedback/generate       - 生成反馈建议（流式）`)
console.log(`     GET  /api/jobs                    - 获取作业列表`)
console.log(`     POST /api/jobs/:id/delete         - 删除作业记录`)
console.log(`     POST /api/vision/analyze          - 视觉识别（学期+天数）`)
console.log(`     GET  /health                      - 健康检查`)

serve({ fetch: app.fetch, port })

// 优雅关闭
process.on('SIGINT', () => { clearInterval(queueWorker); closeDb(); process.exit(0) })
process.on('SIGTERM', () => { clearInterval(queueWorker); closeDb(); process.exit(0) })
