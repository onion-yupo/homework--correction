import { Hono } from 'hono'
import { listJobs, deleteJob, saveJob, loadJob, normalizeSemester } from '../lib/storage.js'
import { syncJobToDb, updateJobFlags } from '../lib/db-sync.js'
import { advanceJobQueue, isValidDay, normalizeJobListStatus } from '../lib/job-queue.js'

const app = new Hono()

/**
 * GET /api/jobs
 * 返回所有作业记录列表（按时间倒序）
 * - 刷新 PROCESSING 任务的腾讯云状态
 * - 如果有任务刚完成，自动推进下一个 PENDING 任务
 * - 前端展示：最多 1 个 processing，其余 PROCESSING/PENDING 均显示 pending
 */
app.get('/', async (c) => {
  await advanceJobQueue()
  const jobs = listJobs()

  const list = jobs.map((job) => {
    return {
      jobId: job.jobId,
      studentName: job.studentName ?? '',
      semester: job.semester ?? '',
      day: job.day ?? '',
      status: normalizeJobListStatus(job.jobStatus),
      errorMessage: job.errorMessage ?? '',
      savedAt: job.savedAt ?? '',
      hasImage: job.hasImage ?? false,
    }
  })

  return c.json(list)
})

app.post('/:jobId/day', async (c) => {
  const jobId = c.req.param('jobId')
  const body = await c.req.json<{ day?: string | number, semester?: string }>()
  const existing = loadJob(jobId)
  if (!existing) return c.json({ error: '未找到该记录' }, 404)
  if (!isValidDay(body.day)) return c.json({ error: '请输入 1-24 之间的作业天数' }, 400)

  existing.day = String(body.day).trim()
  if (body.semester) existing.semester = normalizeSemester(String(body.semester))
  if (existing.jobStatus === 'NEEDS_DAY_CONFIRMATION') {
    existing.jobStatus = 'PENDING'
    existing.errorMessage = ''
  }
  saveJob(jobId, existing)
  await advanceJobQueue()
  return c.json({ ok: true, job: { jobId, day: existing.day, semester: existing.semester, status: normalizeJobListStatus(existing.jobStatus) } })
})

app.post('/:jobId/retry', async (c) => {
  const jobId = c.req.param('jobId')
  const existing = loadJob(jobId)
  if (!existing) return c.json({ error: '未找到该记录' }, 404)
  if (!isValidDay(existing.day)) {
    existing.jobStatus = 'NEEDS_DAY_CONFIRMATION'
    existing.errorMessage = '缺少有效的作业天数，需要老师确认后再批改'
  }
  else {
    existing.jobStatus = 'PENDING'
    existing.errorCode = ''
    existing.errorMessage = ''
  }
  saveJob(jobId, existing)
  await advanceJobQueue()
  return c.json({ ok: true, status: normalizeJobListStatus(existing.jobStatus) })
})

app.post('/:jobId/ignore', async (c) => {
  const jobId = c.req.param('jobId')
  const existing = loadJob(jobId)
  if (!existing) return c.json({ error: '未找到该记录' }, 404)
  existing.jobStatus = 'IGNORED'
  existing.errorMessage = ''
  saveJob(jobId, existing)

  try {
    const { getDb } = await import('../lib/database.js')
    const db = getDb()
    db.prepare('UPDATE jobs SET frozen = 1, updated_at = ? WHERE job_id = ?').run(new Date().toISOString(), jobId)
  } catch (e) { console.error('[Ignore] SQLite 同步失败:', e) }

  return c.json({ ok: true })
})

/**
 * GET /api/jobs/by-student?studentName=xxx
 * 按学生名字查询所有已完成的作业，按天数分组
 * 用于详情页的天数导航
 */
app.get('/by-student', async (c) => {
  const studentName = c.req.query('studentName')
  if (!studentName) {
    return c.json({ error: '缺少 studentName 参数' }, 400)
  }

  const jobs = listJobs()
  const matched = jobs.filter(
    j => j.studentName === studentName && j.jobStatus === 'DONE',
  )

  type DayJob = { jobId: string, savedAt: string, reviewed: boolean, feedbacked: boolean }
  const semesters: Record<string, Record<string, DayJob[]>> = {}

  for (const job of matched) {
    const rawSemester = String(job.semester ?? '') || '未知学期'
    const semester = rawSemester === '未知学期' ? rawSemester : normalizeSemester(rawSemester)
    const day = String(job.day ?? '')
    if (!day) continue

    if (!semesters[semester]) semesters[semester] = {}
    if (!semesters[semester][day]) semesters[semester][day] = []
    semesters[semester][day].push({
      jobId: String(job.jobId),
      savedAt: String(job.savedAt ?? ''),
      reviewed: !!job.reviewed,
      feedbacked: !!job.feedbacked,
    })
  }

  for (const sem of Object.values(semesters)) {
    for (const day of Object.keys(sem)) {
      sem[day].sort((a, b) => a.savedAt.localeCompare(b.savedAt))
    }
  }

  const gradeOrder = ['一', '二', '三', '四', '五', '六']
  const semesterList = Object.keys(semesters).sort((a, b) => {
    const ga = gradeOrder.indexOf(a.charAt(0))
    const gb = gradeOrder.indexOf(b.charAt(0))
    if (ga !== gb) return ga - gb
    const sa = a.includes('下') ? 1 : 0
    const sb = b.includes('下') ? 1 : 0
    return sa - sb
  })

  return c.json({ studentName, semesters, semesterList })
})

/**
 * POST /api/jobs/:jobId/flags
 * 更新单次提交的状态标记（已核对 / 已反馈）
 */
app.post('/:jobId/flags', async (c) => {
  const jobId = c.req.param('jobId')
  const body = await c.req.json<{ reviewed?: boolean, feedbacked?: boolean }>()

  const existing = loadJob(jobId)
  if (!existing) {
    return c.json({ error: '未找到该记录' }, 404)
  }

  if (typeof body.reviewed === 'boolean') existing.reviewed = body.reviewed
  if (typeof body.feedbacked === 'boolean') existing.feedbacked = body.feedbacked

  saveJob(jobId, existing)

  // 双写 SQLite
  try { updateJobFlags(jobId, body.reviewed, body.feedbacked) }
  catch (e) { console.error('[Flags] SQLite 同步失败:', e) }

  return c.json({ ok: true, reviewed: existing.reviewed ?? false, feedbacked: existing.feedbacked ?? false })
})

/**
 * POST /api/jobs/:jobId/review-state
 * 保存老师复核状态：修改的对错判定 + 隐藏的答案ID
 */
app.post('/:jobId/review-state', async (c) => {
  const jobId = c.req.param('jobId')
  const body = await c.req.json<{
    reviewCorrections: Record<string, boolean>
    hiddenAnswerIds: string[]
  }>()

  const existing = loadJob(jobId)
  if (!existing) {
    return c.json({ error: '未找到该记录' }, 404)
  }

  existing.reviewCorrections = body.reviewCorrections ?? {}
  existing.hiddenAnswerIds = body.hiddenAnswerIds ?? []
  saveJob(jobId, existing)

  // 双写 SQLite（全量重新同步该 job，因为对错判定和隐藏状态影响所有 answers）
  try { syncJobToDb(jobId, existing as any) }
  catch (e) { console.error('[ReviewState] SQLite 同步失败:', e) }

  console.log(`[ReviewState] 已保存复核状态: ${jobId}, corrections=${Object.keys(body.reviewCorrections ?? {}).length}, hidden=${(body.hiddenAnswerIds ?? []).length}`)
  return c.json({ ok: true })
})

/**
 * POST /api/jobs/:jobId/manual-annotations
 * 保存手动标注数据（老师在图片上框选的对错标记）
 */
app.post('/:jobId/manual-annotations', async (c) => {
  const jobId = c.req.param('jobId')
  const body = await c.req.json<{ annotations: Array<{ id: string, positions: number[], isCorrect: boolean }> }>()

  const existing = loadJob(jobId)
  if (!existing) {
    return c.json({ error: '未找到该记录' }, 404)
  }

  existing.manualAnnotations = body.annotations ?? []
  saveJob(jobId, existing)

  // 双写 SQLite（全量重新同步，因为人工标注影响 answers 列表和统计）
  try { syncJobToDb(jobId, existing as any) }
  catch (e) { console.error('[ManualAnno] SQLite 同步失败:', e) }

  console.log(`[ManualAnno] 已保存 ${body.annotations?.length ?? 0} 条手动标注: ${jobId}`)
  return c.json({ ok: true, count: body.annotations?.length ?? 0 })
})

/**
 * POST /api/jobs/:jobId/delete
 * 删除指定作业记录及其关联文件
 */
app.post('/:jobId/delete', async (c) => {
  const jobId = c.req.param('jobId')
  const deleted = deleteJob(jobId)

  if (!deleted) {
    return c.json({ error: '未找到该记录' }, 404)
  }

  // 同步删除 SQLite 数据
  try {
    const { getDb } = await import('../lib/database.js')
    const db = getDb()
    db.prepare('DELETE FROM answers WHERE job_id = ?').run(jobId)
    db.prepare('DELETE FROM jobs WHERE job_id = ?').run(jobId)
  } catch (e) { console.error('[Delete] SQLite 同步失败:', e) }

  return c.json({ ok: true })
})

export default app
