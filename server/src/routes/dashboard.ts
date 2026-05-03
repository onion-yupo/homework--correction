/**
 * dashboard 路由 — 工作台数据接口
 *
 * 工作台视角：老师 × 期 → 展示该老师该期负责的所有 level
 */
import process from 'node:process'
import { Hono } from 'hono'
import { streamText } from 'hono/streaming'
import { getDb } from '../lib/database.js'
import { cacheGet, cacheSet, cacheInvalidate } from '../lib/cache.js'
import { canSeeAll, getCurrentTeacher, resolveTeacherId } from '../lib/access.js'

/** 学期排序权重：一上=1, 一下=2, 二上=3 ... 六下=12 */
const GRADE_ORDER = '一二三四五六'
function semesterWeight(s: string): number {
  const gi = GRADE_ORDER.indexOf(s[0])
  const half = s[1] === '上' ? 0 : 1
  return gi >= 0 ? gi * 2 + half : 99
}

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_MODEL = 'doubao-seed-2-0-lite-260215'

const app = new Hono()

/**
 * GET /api/dashboard/init
 * 一次性返回看板初始化所需全部数据，减少前端请求轮次
 *
 * 参数：teacherId（可选，缺省则自动选第一个有归属的老师）
 * 返回：{ teachers, enrollment, matrix, sortPrefs, reportStatuses }
 */
app.get('/init', (c) => {
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)

  const reqTeacherId = resolveTeacherId(c, c.req.query('teacherId') || '') || current.id
  const campId = c.req.query('campId')
  const cohortId = c.req.query('cohortId')
  const requestedTerm = c.req.query('term')
  const cacheKey = `dashboard:init:${current.id}:${reqTeacherId}:${campId || ''}:${cohortId || ''}:${requestedTerm || ''}`
  const cached = cacheGet<any>(cacheKey)
  if (cached) return c.json(cached)

  const db = getDb()

  const teachers = canSeeAll(current)
    ? db.prepare('SELECT id, name, role, created_at FROM teachers ORDER BY name').all() as any[]
    : db.prepare('SELECT id, name, role, created_at FROM teachers WHERE id = ?').all(current.id) as any[]

  let teacherId = reqTeacherId
  if (!teacherId && teachers.length) {
    const ding = teachers.find((t: any) => t.id === 'teacher-ding')
    teacherId = ding ? ding.id : teachers[0].id
  }

  // --- enrollment ---
  let enrollment: any = null
  let currentTerm = ''
  if (teacherId) {
    const teacher = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(teacherId) as any
    if (teacher) {
      const semesters = db.prepare(
        `SELECT DISTINCT term, semester FROM enrollments
         WHERE teacher_id = ?
           AND (? IS NULL OR camp_id = ?)
           AND (? IS NULL OR cohort_id = ?)
         ORDER BY term DESC`
      ).all(teacherId, campId || null, campId || null, cohortId || null, cohortId || null) as any[]
      semesters.sort((a: any, b: any) => a.term === b.term ? semesterWeight(a.semester) - semesterWeight(b.semester) : 0)

      const termMap = new Map<string, string[]>()
      for (const { term, semester } of semesters) {
        if (!termMap.has(term)) termMap.set(term, [])
        termMap.get(term)!.push(semester)
      }

      const enrollmentData: Record<string, Record<string, any[]>> = {}
      for (const [term, semList] of termMap) {
        enrollmentData[term] = {}
        for (const semester of semList) {
          enrollmentData[term][semester] = db.prepare(
            `SELECT s.id, s.name FROM enrollments e JOIN students s ON e.student_id = s.id
             WHERE e.teacher_id = ? AND e.term = ? AND e.semester = ?
               AND (? IS NULL OR e.camp_id = ?)
               AND (? IS NULL OR e.cohort_id = ?)
             ORDER BY s.name`
          ).all(teacherId, term, semester, campId || null, campId || null, cohortId || null, cohortId || null)
        }
      }

      enrollment = {
        teacher,
        terms: Array.from(termMap.keys()),
        termSemesters: Object.fromEntries(termMap),
        enrollments: enrollmentData,
      }
      currentTerm = requestedTerm && enrollment.terms.includes(requestedTerm) ? requestedTerm : (enrollment.terms[0] || '')
    }
  }

  // --- matrix ---
  let matrix: any = { groups: [], maxDay: 24, term: currentTerm }
  if (teacherId && currentTerm) {
    const levels = db.prepare(
      `SELECT DISTINCT semester FROM enrollments
       WHERE teacher_id = ? AND term = ?
         AND (? IS NULL OR camp_id = ?)
         AND (? IS NULL OR cohort_id = ?)`
    ).all(teacherId, currentTerm, campId || null, campId || null, cohortId || null, cohortId || null) as any[]
    levels.sort((a: any, b: any) => semesterWeight(a.semester) - semesterWeight(b.semester))

    const groups: any[] = []
    for (const { semester } of levels) {
      const students = db.prepare(
        `SELECT s.id, s.name FROM enrollments e JOIN students s ON e.student_id = s.id
         WHERE e.teacher_id = ? AND e.term = ? AND e.semester = ?
           AND (? IS NULL OR e.camp_id = ?)
           AND (? IS NULL OR e.cohort_id = ?)
         ORDER BY s.name`
      ).all(teacherId, currentTerm, semester, campId || null, campId || null, cohortId || null, cohortId || null) as any[]

      const jobs = db.prepare(
        `SELECT j.job_id, j.student_id, j.day, j.accuracy,
                j.review_status, j.feedback_status, j.submitted_at, j.updated_at,
                j.total_questions, j.correct_count, j.error_count, j.frozen
         FROM jobs j
         JOIN enrollments e ON j.student_id = e.student_id AND j.term = e.term AND j.semester = e.semester
         WHERE e.teacher_id = ? AND j.term = ? AND j.semester = ?
           AND (? IS NULL OR e.camp_id = ?)
           AND (? IS NULL OR e.cohort_id = ?)
           AND (? IS NULL OR j.camp_id = ?)
           AND (? IS NULL OR j.cohort_id = ?)
         ORDER BY j.student_id, j.day, j.submitted_at DESC`
      ).all(teacherId, currentTerm, semester, campId || null, campId || null, cohortId || null, cohortId || null, campId || null, campId || null, cohortId || null, cohortId || null) as any[]

      const studentMap = new Map<string, any>()
      for (const s of students) {
        studentMap.set(s.id, { id: s.id, name: s.name, days: {} as Record<number, any[]> })
      }
      for (const j of jobs) {
        const student = studentMap.get(j.student_id)
        if (!student) continue
        if (!student.days[j.day]) student.days[j.day] = []
        student.days[j.day].push({
          jobId: j.job_id, accuracy: j.accuracy,
          reviewStatus: j.review_status, feedbackStatus: j.feedback_status,
          submittedAt: j.submitted_at, updatedAt: j.updated_at || j.submitted_at,
          totalQuestions: j.total_questions, correctCount: j.correct_count, errorCount: j.error_count,
          frozen: j.frozen === 1,
        })
      }
      groups.push({ semester, students: Array.from(studentMap.values()) })
    }

    const maxDay = 24
    matrix = { groups, maxDay, term: currentTerm }
  }

  // --- sort-prefs ---
  let sortPrefs: any = { all: { field: 'updatedAt', order: 'asc' }, 'pending-review': { field: 'updatedAt', order: 'asc' }, 'pending-feedback': { field: 'updatedAt', order: 'asc' }, timeFilter: 'all' }
  if (teacherId) {
    const rows = db.prepare(
      "SELECT pref_key, pref_value FROM teacher_preferences WHERE teacher_id = ? AND (pref_key LIKE 'sort_%' OR pref_key = 'time_filter')"
    ).all(teacherId) as any[]
    for (const row of rows) {
      if (row.pref_key === 'time_filter') { sortPrefs.timeFilter = row.pref_value }
      else {
        const tab = row.pref_key.replace('sort_', '')
        if (sortPrefs[tab]) { try { sortPrefs[tab] = JSON.parse(row.pref_value) } catch {} }
      }
    }
  }

  // --- report-statuses ---
  let reportStatuses: Record<string, Record<string, string>> = {}
  if (currentTerm) {
    const reports = db.prepare(
      'SELECT student_id, semester, report_type, created_at FROM reports WHERE term = ?'
    ).all(currentTerm) as any[]
    for (const r of reports) {
      const key = `${r.student_id}_${r.semester}`
      if (!reportStatuses[key]) reportStatuses[key] = {}
      reportStatuses[key][r.report_type] = r.created_at
    }
  }

  const result = { teachers, enrollment, matrix, sortPrefs, reportStatuses, teacherId, term: currentTerm }
  cacheSet(cacheKey, result, 30_000)
  return c.json(result)
})

/**
 * GET /api/dashboard/overview
 * 某天概览统计
 *
 * 参数：teacherId, term, semester, day
 */
app.get('/overview', (c) => {
  const teacherId = resolveTeacherId(c, c.req.query('teacherId'))
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  const day = Number(c.req.query('day'))

  if (!teacherId || !term || !semester || !day) {
    return c.json({ error: '缺少 teacherId、term、semester 或 day' }, 400)
  }

  const db = getDb()

  const totalStudents = (db.prepare(`
    SELECT COUNT(*) as cnt FROM enrollments
    WHERE teacher_id = ? AND term = ? AND semester = ?
  `).get(teacherId, term, semester) as any).cnt

  const submittedStudents = (db.prepare(`
    SELECT COUNT(DISTINCT j.student_id) as cnt
    FROM jobs j
    JOIN enrollments e ON j.student_id = e.student_id AND j.term = e.term AND j.semester = e.semester
    WHERE e.teacher_id = ? AND j.term = ? AND j.semester = ? AND j.day = ?
  `).get(teacherId, term, semester, day) as any).cnt

  const reviewedStudents = (db.prepare(`
    SELECT COUNT(DISTINCT j.student_id) as cnt
    FROM jobs j
    JOIN enrollments e ON j.student_id = e.student_id AND j.term = e.term AND j.semester = e.semester
    WHERE e.teacher_id = ? AND j.term = ? AND j.semester = ? AND j.day = ?
      AND j.review_status = 'reviewed'
  `).get(teacherId, term, semester, day) as any).cnt

  const feedbackedStudents = (db.prepare(`
    SELECT COUNT(DISTINCT j.student_id) as cnt
    FROM jobs j
    JOIN enrollments e ON j.student_id = e.student_id AND j.term = e.term AND j.semester = e.semester
    WHERE e.teacher_id = ? AND j.term = ? AND j.semester = ? AND j.day = ?
      AND j.feedback_status = 'sent'
  `).get(teacherId, term, semester, day) as any).cnt

  return c.json({
    totalStudents, submittedStudents,
    notSubmitted: totalStudents - submittedStudents,
    reviewedStudents, feedbackedStudents,
    day, term, semester,
  })
})

/**
 * GET /api/dashboard/matrix
 * 学生×天数状态矩阵（按老师×期，返回所有 level）
 *
 * 参数：teacherId, term
 */
app.get('/matrix', (c) => {
  const teacherId = resolveTeacherId(c, c.req.query('teacherId'))
  const term = c.req.query('term')
  const campId = c.req.query('campId')
  const cohortId = c.req.query('cohortId')

  if (!teacherId || !term) {
    return c.json({ error: '缺少 teacherId 或 term' }, 400)
  }

  const db = getDb()

  // 获取该老师该期下的所有 level
  const levels = db.prepare(`
    SELECT DISTINCT semester FROM enrollments
    WHERE teacher_id = ? AND term = ?
      AND (? IS NULL OR camp_id = ?)
      AND (? IS NULL OR cohort_id = ?)
  `).all(teacherId, term, campId || null, campId || null, cohortId || null, cohortId || null) as any[]
  levels.sort((a: any, b: any) => semesterWeight(a.semester) - semesterWeight(b.semester))

  // 按 level 分组构建数据
  const groups: any[] = []

  for (const { semester } of levels) {
    const students = db.prepare(`
      SELECT s.id, s.name
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      WHERE e.teacher_id = ? AND e.term = ? AND e.semester = ?
        AND (? IS NULL OR e.camp_id = ?)
        AND (? IS NULL OR e.cohort_id = ?)
      ORDER BY s.name
    `).all(teacherId, term, semester, campId || null, campId || null, cohortId || null, cohortId || null) as any[]

    const jobs = db.prepare(`
      SELECT j.job_id, j.student_id, j.day, j.accuracy,
             j.review_status, j.feedback_status, j.submitted_at, j.updated_at,
             j.total_questions, j.correct_count, j.error_count, j.frozen
      FROM jobs j
      JOIN enrollments e ON j.student_id = e.student_id AND j.term = e.term AND j.semester = e.semester
      WHERE e.teacher_id = ? AND j.term = ? AND j.semester = ?
        AND (? IS NULL OR e.camp_id = ?)
        AND (? IS NULL OR e.cohort_id = ?)
        AND (? IS NULL OR j.camp_id = ?)
        AND (? IS NULL OR j.cohort_id = ?)
      ORDER BY j.student_id, j.day, j.submitted_at DESC
    `).all(teacherId, term, semester, campId || null, campId || null, cohortId || null, cohortId || null, campId || null, campId || null, cohortId || null, cohortId || null) as any[]

    const studentMap = new Map<string, any>()
    for (const s of students) {
      studentMap.set(s.id, { id: s.id, name: s.name, days: {} as Record<number, any[]> })
    }

    for (const j of jobs) {
      const student = studentMap.get(j.student_id)
      if (!student) continue
      if (!student.days[j.day]) student.days[j.day] = []
      student.days[j.day].push({
      jobId: j.job_id, accuracy: j.accuracy,
      reviewStatus: j.review_status, feedbackStatus: j.feedback_status,
      submittedAt: j.submitted_at, updatedAt: j.updated_at || j.submitted_at,
      totalQuestions: j.total_questions,
      correctCount: j.correct_count, errorCount: j.error_count,
      frozen: j.frozen === 1,
      })
    }

    groups.push({
      semester,
      students: Array.from(studentMap.values()),
    })
  }

  const maxDay = 24

  return c.json({ groups, maxDay, term })
})

/**
 * GET /api/dashboard/sort-prefs
 * 获取老师的排序偏好（三个 tab 各自独立）
 *
 * 参数：teacherId
 * 返回：{ all: { field, order }, 'pending-review': ..., 'pending-feedback': ... }
 */
app.get('/sort-prefs', (c) => {
  const teacherId = resolveTeacherId(c, c.req.query('teacherId'))
  if (!teacherId) return c.json({ error: '缺少 teacherId' }, 400)

  const db = getDb()
  const rows = db.prepare(`
    SELECT pref_key, pref_value FROM teacher_preferences
    WHERE teacher_id = ? AND (pref_key LIKE 'sort_%' OR pref_key = 'time_filter')
  `).all(teacherId) as any[]

  const defaults = { field: 'updatedAt', order: 'asc' }
  const prefs: Record<string, any> = {
    all: { ...defaults },
    'pending-review': { ...defaults },
    'pending-feedback': { ...defaults },
    timeFilter: 'all',
  }

  for (const row of rows) {
    if (row.pref_key === 'time_filter') {
      prefs.timeFilter = row.pref_value
    }
    else {
      const tab = row.pref_key.replace('sort_', '')
      if (prefs[tab]) {
        try { prefs[tab] = JSON.parse(row.pref_value) } catch {}
      }
    }
  }

  return c.json(prefs)
})

/**
 * POST /api/dashboard/sort-prefs
 * 保存某个 tab 的排序偏好
 *
 * Body: { teacherId, tab, field, order }
 */
app.post('/sort-prefs', async (c) => {
  const body = await c.req.json()
  const teacherId = resolveTeacherId(c, body.teacherId)

  if (!teacherId) return c.json({ error: '缺少 teacherId' }, 400)

  const db = getDb()
  const upsert = db.prepare(`
    INSERT INTO teacher_preferences (teacher_id, pref_key, pref_value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(teacher_id, pref_key) DO UPDATE SET pref_value = excluded.pref_value, updated_at = excluded.updated_at
  `)

  if (body.timeFilter !== undefined) {
    upsert.run(teacherId, 'time_filter', body.timeFilter)
  }

  if (body.tab && body.field && body.order) {
    upsert.run(teacherId, `sort_${body.tab}`, JSON.stringify({ field: body.field, order: body.order }))
  }

  return c.json({ ok: true })
})

/**
 * POST /api/dashboard/freeze
 * 冻结/解冻某个 job
 *
 * Body: { jobId, frozen: boolean }
 */
app.post('/freeze', async (c) => {
  const { jobId, frozen } = await c.req.json()
  if (!jobId || frozen === undefined) {
    return c.json({ error: '缺少 jobId 或 frozen' }, 400)
  }

  const db = getDb()
  const current = getCurrentTeacher(c)
  if (!current) return c.json({ error: '未登录' }, 401)

  if (!canSeeAll(current)) {
    const visible = db.prepare(`
      SELECT 1 FROM jobs
      WHERE job_id = ? AND teacher_id = ?
      LIMIT 1
    `).get(jobId, current.id)
    if (!visible) return c.json({ error: '无权操作该任务' }, 403)
  }

  db.prepare(`
    UPDATE jobs SET frozen = ?, updated_at = datetime('now')
    WHERE job_id = ?
  `).run(frozen ? 1 : 0, jobId)

  cacheInvalidate('dashboard:')
  return c.json({ ok: true })
})

/**
 * POST /api/dashboard/remind
 * 为未提交作业的学生生成提醒家长的文案（流式返回）
 *
 * Body: { studentName, semester, missingDays, submittedDays, totalDays }
 *   submittedDays: [{ day, accuracy }] — 已提交天的简要信息
 */
app.post('/remind', async (c) => {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    return c.json({ error: '缺少 ARK_API_KEY 配置' }, 500)
  }

  const body = await c.req.json<{
    studentName: string
    semester: string
    missingDays: number[]
    submittedDays: { day: number, accuracy: number }[]
    totalDays: number
    currentDay?: number
    instruction?: string
  }>()

  if (!body.studentName || !body.missingDays?.length) {
    return c.json({ error: '缺少必要参数' }, 400)
  }

  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]

  const DAY_LABELS: Record<number, string> = {
    22: '第一周易错点加练',
    23: '第二周易错点加练',
    24: '第三周易错点加练',
  }
  function dayLabel(d: number): string {
    return DAY_LABELS[d] || `第${d}天`
  }

  const submittedInfo = body.submittedDays?.length
    ? `已完成的作业及正确率：${body.submittedDays.map(d => `${dayLabel(d.day)}(${d.accuracy}%)`).join('、')}`
    : '目前尚未提交任何一天的作业'

  const missingStr = body.missingDays.map(d => dayLabel(d)).join('、')
  const missingCount = body.missingDays.length

  const prompt = `你是一位温暖专业的小学数学辅导老师助手，正在帮助老师生成提醒家长督促孩子交作业的文案。

## 天数说明
- 课程共 ${body.totalDays} 天，今天是服务第 ${body.currentDay ?? body.totalDays} 天（即截至今天，学生应该已完成第1天到第${body.currentDay ?? body.totalDays}天的作业）
- 其中第1天到第21天是每日常规作业
- 第22天 = 第一周易错点加练，第23天 = 第二周易错点加练，第24天 = 第三周易错点加练
- 在文案中请使用"第X天"来称呼常规作业（如"第1天""第15天"），使用完整名称来称呼加练（如"第一周易错点加练"）

## 当前信息
- 当前日期：${dateStr}（星期${weekDay}）
- 学生姓名：${body.studentName}
- 所在班级：${body.semester}
- ${submittedInfo}
- 未提交作业：共 ${missingCount} 项（${missingStr}）

## 生成要求
1. 生成一段可以直接发给家长的微信消息文案
2. 语气温暖友善，不要让家长有压力或被指责的感觉
3. 要体现出对学生的了解和关心，结合已提交作业的情况做正向引导
4. 明确提醒具体缺了哪些作业，使用正确的天数表述（"第X天"或加练名称）
5. 如果缺交较多，适当表达理解（可能有特殊情况），同时说明持续练习的重要性
6. 如果已交的部分正确率高，可以夸奖孩子表现好，鼓励继续保持
7. 如果已交的部分正确率偏低，可以委婉说"咱们一起帮孩子巩固一下"
8. 文案长度适中，3-5句话即可，不要太长
9. 不要有标题、不要有"提醒："等前缀，直接就是可以发的消息内容
10. 称呼家长为"${body.studentName}家长"或"${body.studentName}妈妈/爸爸"（默认用"家长"）${body.instruction ? `\n\n## 老师的补充指令（优先级最高，必须遵守）\n${body.instruction}` : ''}`

  console.log(`[Remind] 生成提醒文案，学生: ${body.studentName}，缺交: ${missingCount} 天${body.instruction ? `，补充指令: ${body.instruction}` : ''}`)

  const arkResponse = await fetch(ARK_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ARK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      reasoning_effort: 'minimal',
    }),
  })

  if (!arkResponse.ok) {
    const errText = await arkResponse.text()
    console.error(`[Remind] Ark API 错误: ${arkResponse.status}`, errText)
    return c.json({ error: `大模型 API 调用失败: ${arkResponse.status}` }, 502)
  }

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return streamText(c, async (stream) => {
    const reader = arkResponse.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          await stream.write('[DONE]')
          return
        }

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) await stream.write(content)
        }
        catch {}
      }
    }
  })
})

// ============================================================
// term-start: 期起始日期
// ============================================================

app.get('/term-start', (c) => {
  const teacherId = c.req.query('teacherId')
  const term = c.req.query('term')
  if (!teacherId || !term) return c.json({ error: '缺少参数' }, 400)

  const db = getDb()
  const key = `term_start_date:${term}`
  const row = db.prepare(
    'SELECT pref_value FROM teacher_preferences WHERE teacher_id = ? AND pref_key = ?'
  ).get(teacherId, key) as any

  return c.json({ startDate: row?.pref_value || null })
})

app.put('/term-start', async (c) => {
  const { teacherId, term, startDate } = await c.req.json<{
    teacherId: string
    term: string
    startDate: string
  }>()
  if (!teacherId || !term || !startDate) return c.json({ error: '缺少参数' }, 400)

  const db = getDb()
  const key = `term_start_date:${term}`
  db.prepare(`
    INSERT INTO teacher_preferences (teacher_id, pref_key, pref_value)
    VALUES (?, ?, ?)
    ON CONFLICT(teacher_id, pref_key) DO UPDATE SET
      pref_value = excluded.pref_value,
      updated_at = datetime('now')
  `).run(teacherId, key, startDate)

  return c.json({ ok: true })
})

export default app
