/**
 * analytics 路由 — 学情分析数据接口
 */
import process from 'node:process'
import { Hono } from 'hono'
import { streamText } from 'hono/streaming'
import { getDb } from '../lib/database.js'
import { cacheGet, cacheSet } from '../lib/cache.js'
import { assertStudentVisible, resolveTeacherId } from '../lib/access.js'

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_MODEL = 'doubao-seed-2-0-lite-260215'

const app = new Hono()

/**
 * 归一化题目文本，用于高频错题去重。
 * 处理 OCR 产生的格式差异：题号前缀、LaTeX 装饰、全角半角、包装语等。
 */
function normalizeQuestionTitle(title: string): string {
  // 多行标题（顶层题干\n子题）：逐行归一化后拼接
  const lines = title.split('\n').map(line => normalizeLine(line)).filter(Boolean)
  return lines.join('\n')
}

/** 归一化单行题目文本 */
function normalizeLine(title: string): string {
  let s = title
  // 题号前缀：(1) (2) （1） 1. 2. 等
  s = s.replace(/^[\s]*[（(]\d+[)）][\s.]*/g, '')
  s = s.replace(/^[\s]*\d+\.[\s]*/g, '')
  // LaTeX $...$ 去壳（保留内部文本）
  s = s.replace(/\$([^$]*)\$/g, '$1')
  // LaTeX 空格命令 → 空格
  s = s.replace(/\\(?:quad|enspace|thinspace|[;,!]|\s)/g, ' ')
  // LaTeX 环境标签
  s = s.replace(/\\(?:begin|end)\{[^}]*\}/g, '')
  // LaTeX 数学符号 → Unicode 对应物（必须在通用 \command 清除之前）
  // 用 (?![a-zA-Z]) 替代 \b，因为 \div7 中 v 和 7 都是 \w，\b 不匹配
  s = s.replace(/\\div(?![a-zA-Z])/g, '÷')
  s = s.replace(/\\times(?![a-zA-Z])/g, '×')
  s = s.replace(/\\(?:cdots|ldots)(?![a-zA-Z])/g, '…')
  s = s.replace(/\\(?:bigcirc|circ)(?![a-zA-Z])/g, '○')
  s = s.replace(/\\square(?![a-zA-Z])/g, '□')
  s = s.replace(/\\dot\{([^}])\}/g, '$1')
  // 剩余 \command
  s = s.replace(/\\[a-zA-Z]+/g, '')
  // 反斜杠残留
  s = s.replace(/\\/g, '')
  // 省略号归一
  s = s.replace(/…{2,}/g, '…').replace(/……/g, '…')
  // 全角 → 半角
  s = s.replace(/（/g, '(').replace(/）/g, ')').replace(/，/g, ',').replace(/：/g, ':')
  // 常见包装语前缀
  s = s.replace(/^你会算[^?？]*[?？]?\s*/g, '')
  s = s.replace(/^计算\s*/g, '')
  // 常见包装语后缀（含后续内容一并去掉）
  s = s.replace(/[,，]?\s*(?:并?列竖式计算|竖式计算结果|竖式计算|列竖式求解|并列竖式计算).*$/g, '')
  // 括号内空格归一
  s = s.replace(/\(\s+\)/g, '()')
  // 末尾 = 或 =() 归一（"647+583=" 和 "647+583" 视为同题）
  s = s.replace(/=\s*(\(\))?$/, '')
  // 连续空格
  s = s.replace(/\s+/g, ' ')
  s = s.trim()
  // 纯指令行：以运算指令开头 + 可选修饰语（"下列各题"/"下面各题"等），无实际题目内容
  // 也匹配被 ^计算 去除后的残留（如 "下列算式"、"下列各题"）
  if (/^((口算|笔算|计算|列竖式计算|竖式计算|估算|脱式计算|简便计算|解方程)?(下列|下面)?(各|的)?(算式|各题|题目|题|计算题))[^a-zA-Z0-9\u4e00-\u9fff]*$/i.test(s)) return ''
  return s
}

/**
 * 取每个学生每天的"代表 job"（最新一次提交）
 * 用于聚合查询，避免同天多次提交重复计入
 */
const LATEST_JOB_FILTER = `
  j.rowid = (
    SELECT j2.rowid FROM jobs j2
    WHERE j2.student_id = j.student_id AND j2.term = j.term AND j2.semester = j.semester AND j2.day = j.day
    ORDER BY j2.submitted_at DESC LIMIT 1
  )
`

/**
 * GET /api/analytics/student-trend
 * 个人正确率趋势
 *
 * 参数：studentId, semester
 */
app.get('/student-trend', (c) => {
  const studentId = c.req.query('studentId')
  const term = c.req.query('term')
  const semester = c.req.query('semester')

  if (!studentId || !term || !semester) {
    return c.json({ error: '缺少 studentId、term 或 semester' }, 400)
  }
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权查看该学生' }, 403)
  }

  const db = getDb()
  const trend = db.prepare(`
    SELECT j.day, j.accuracy, j.total_questions, j.correct_count, j.error_count
    FROM jobs j
    WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND ${LATEST_JOB_FILTER}
    ORDER BY j.day
  `).all(studentId, term, semester)

  return c.json({ studentId, semester, trend })
})

/**
 * GET /api/analytics/student-errors
 * 个人错题列表
 *
 * 参数：studentId, semester, day(可选), knowledgePoint(可选)
 */
app.get('/student-errors', (c) => {
  const studentId = c.req.query('studentId')
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  const day = c.req.query('day')
  const kp = c.req.query('knowledgePoint')

  if (!studentId || !term || !semester) {
    return c.json({ error: '缺少 studentId、term 或 semester' }, 400)
  }
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权查看该学生' }, 403)
  }

  const db = getDb()
  let sql = `
    SELECT a.question_title, a.student_answer, a.correct_answer,
           a.knowledge_points, a.answer_analysis, j.day, j.job_id
    FROM answers a
    JOIN jobs j ON a.job_id = j.job_id
    WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND a.is_correct = 0 AND a.is_hidden = 0
      AND ${LATEST_JOB_FILTER}
  `
  const params: any[] = [studentId, term, semester]

  if (day) {
    sql += ' AND j.day = ?'
    params.push(Number(day))
  }
  if (kp) {
    sql += ' AND a.knowledge_points LIKE ?'
    params.push(`%${kp}%`)
  }

  sql += ' ORDER BY j.day, a.answer_index'

  const errors = db.prepare(sql).all(...params)
  return c.json({ studentId, semester, errors, total: errors.length })
})

/**
 * GET /api/analytics/student-knowledge
 * 个人知识点掌握情况
 *
 * 参数：studentId, semester
 */
app.get('/student-knowledge', (c) => {
  const studentId = c.req.query('studentId')
  const term = c.req.query('term')
  const semester = c.req.query('semester')

  if (!studentId || !term || !semester) {
    return c.json({ error: '缺少 studentId、term 或 semester' }, 400)
  }
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权查看该学生' }, 403)
  }

  const db = getDb()

  // 获取该学生所有答案（最新提交），按知识点聚合
  const answers = db.prepare(`
    SELECT a.knowledge_points, a.is_correct
    FROM answers a
    JOIN jobs j ON a.job_id = j.job_id
    WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND a.is_hidden = 0
      AND a.knowledge_points != '[]'
      AND ${LATEST_JOB_FILTER}
  `).all(studentId, term, semester) as any[]

  // 按知识点聚合
  const kpMap = new Map<string, { total: number; correct: number }>()
  for (const a of answers) {
    try {
      const points: string[] = JSON.parse(a.knowledge_points)
      for (const p of points) {
        if (!kpMap.has(p)) kpMap.set(p, { total: 0, correct: 0 })
        const stat = kpMap.get(p)!
        stat.total++
        if (a.is_correct) stat.correct++
      }
    } catch { /* skip invalid JSON */ }
  }

  // 转为数组并排序
  const knowledge = Array.from(kpMap.entries())
    .map(([name, stat]) => ({
      name,
      total: stat.total,
      correct: stat.correct,
      errors: stat.total - stat.correct,
      accuracy: stat.total > 0 ? stat.correct / stat.total : 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy) // 掌握最差的排前面

  return c.json({ studentId, semester, knowledge })
})

/**
 * GET /api/analytics/class-overview
 * 全班概览
 *
 * 参数：term, semester, teacherId(可选), day(可选)
 */
app.get('/class-overview', (c) => {
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  const teacherId = resolveTeacherId(c, c.req.query('teacherId'))
  const day = c.req.query('day')

  if (!term || !semester) {
    return c.json({ error: '缺少 term 或 semester' }, 400)
  }

  const cacheKey = `analytics:class-overview:${term}:${semester}:${teacherId}:${day}`
  const cached = cacheGet<any>(cacheKey)
  if (cached) return c.json(cached)

  const db = getDb()

  // 构建查询条件
  let enrollFilter = ''
  const params: any[] = [term, semester]

  if (teacherId) {
    enrollFilter = `
      AND j.student_id IN (
        SELECT student_id FROM enrollments WHERE teacher_id = ? AND term = ? AND semester = ?
      )
    `
    params.push(teacherId, term, semester)
  }

  // 每个学生的平均正确率（取每天最新提交）
  let sql = `
    SELECT s.id as student_id, s.name,
           AVG(j.accuracy) as avg_accuracy,
           COUNT(j.job_id) as total_days,
           SUM(j.correct_count) as total_correct,
           SUM(j.error_count) as total_errors
    FROM jobs j
    JOIN students s ON j.student_id = s.id
    WHERE j.term = ? AND j.semester = ? ${enrollFilter}
      AND ${LATEST_JOB_FILTER}
  `

  if (day) {
    sql += ' AND j.day = ?'
    params.push(Number(day))
  }

  sql += ' GROUP BY j.student_id ORDER BY avg_accuracy DESC'

  const students = db.prepare(sql).all(...params)

  // 全班平均正确率趋势（按天）
  const trendParams: any[] = [term, semester]
  if (teacherId) {
    trendParams.push(teacherId, term, semester)
  }

  let trendSql = `
    SELECT j.day,
           AVG(j.accuracy) as avg_accuracy,
           COUNT(DISTINCT j.student_id) as student_count
    FROM jobs j
    WHERE j.term = ? AND j.semester = ? ${enrollFilter}
      AND ${LATEST_JOB_FILTER}
    GROUP BY j.day
    ORDER BY j.day
  `

  const trend = db.prepare(trendSql).all(...trendParams)

  // 满分天次：accuracy >= 0.999 的 job 数量
  const perfectParams: any[] = [term, semester]
  if (teacherId) perfectParams.push(teacherId, term, semester)
  const perfectResult = db.prepare(`
    SELECT COUNT(*) as cnt FROM jobs j
    WHERE j.term = ? AND j.semester = ? ${enrollFilter}
      AND ${LATEST_JOB_FILTER}
      AND j.accuracy >= 0.999
  `).get(...perfectParams) as any

  const result = { semester, students, trend, perfectDays: perfectResult?.cnt || 0 }
  cacheSet(cacheKey, result, 60_000)
  return c.json(result)
})

/**
 * GET /api/analytics/class-knowledge-top
 * 全班知识点错误率 TOP N
 *
 * 参数：semester, teacherId(可选), limit(默认10)
 */
app.get('/class-knowledge-top', (c) => {
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  const teacherId = resolveTeacherId(c, c.req.query('teacherId'))
  const limit = Number(c.req.query('limit') || 10)

  if (!term || !semester) {
    return c.json({ error: '缺少 term 或 semester' }, 400)
  }

  const limitStr = c.req.query('limit')
  const cacheKey = `analytics:class-knowledge:${term}:${semester}:${teacherId}:${limitStr}`
  const cached = cacheGet<any>(cacheKey)
  if (cached) return c.json(cached)

  const db = getDb()

  let enrollFilter = ''
  const params: any[] = [term, semester]

  if (teacherId) {
    enrollFilter = `
      AND j.student_id IN (
        SELECT student_id FROM enrollments WHERE teacher_id = ? AND term = ? AND semester = ?
      )
    `
    params.push(teacherId, term, semester)
  }

  const answers = db.prepare(`
    SELECT a.knowledge_points, a.is_correct, j.student_id
    FROM answers a
    JOIN jobs j ON a.job_id = j.job_id
    WHERE j.term = ? AND j.semester = ? ${enrollFilter}
      AND a.is_hidden = 0
      AND a.knowledge_points != '[]'
      AND ${LATEST_JOB_FILTER}
  `).all(...params) as any[]

  // 按知识点聚合（同时追踪涉及的学生）
  const kpMap = new Map<string, { total: number; errors: number; students: Set<string> }>()
  for (const a of answers as any[]) {
    try {
      const points: string[] = JSON.parse(a.knowledge_points)
      for (const p of points) {
        if (!kpMap.has(p)) kpMap.set(p, { total: 0, errors: 0, students: new Set() })
        const stat = kpMap.get(p)!
        stat.total++
        if (!a.is_correct) {
          stat.errors++
          if (a.student_id) stat.students.add(a.student_id)
        }
      }
    } catch { /* skip */ }
  }

  let allKnowledge = Array.from(kpMap.entries())
    .map(([name, stat]) => ({
      name,
      total: stat.total,
      errors: stat.errors,
      errorRate: stat.total > 0 ? stat.errors / stat.total : 0,
      studentCount: stat.students.size,
    }))
    .sort((a, b) => b.errorRate - a.errorRate)

  const returnAll = limitStr === 'all'
  if (!returnAll) {
    allKnowledge = allKnowledge.filter(k => k.errors > 0).slice(0, limit)
  }

  const result = { semester, topKnowledge: allKnowledge }
  cacheSet(cacheKey, result, 60_000)
  return c.json(result)
})

/**
 * GET /api/analytics/class-error-questions
 * 全班高频错题 TOP N（按具体题目聚合）
 *
 * 参数：term, semester, teacherId(可选), limit(默认10)
 */
app.get('/class-error-questions', (c) => {
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  const teacherId = resolveTeacherId(c, c.req.query('teacherId'))
  const limit = Number(c.req.query('limit') || 10)

  if (!term || !semester) {
    return c.json({ error: '缺少 term 或 semester' }, 400)
  }

  const cacheKey = `analytics:class-errors:${term}:${semester}:${teacherId}:${limit}`
  const cached = cacheGet<any>(cacheKey)
  if (cached) return c.json(cached)

  const db = getDb()

  let enrollFilter = ''
  const params: any[] = [term, semester]

  if (teacherId) {
    enrollFilter = `
      AND j.student_id IN (
        SELECT student_id FROM enrollments WHERE teacher_id = ? AND term = ? AND semester = ?
      )
    `
    params.push(teacherId, term, semester)
  }

  // 查出每天的提交人数（作为错题的分母）
  const dayStudentCounts = db.prepare(`
    SELECT j.day, COUNT(DISTINCT j.student_id) as student_count
    FROM jobs j
    WHERE j.term = ? AND j.semester = ? ${enrollFilter}
      AND ${LATEST_JOB_FILTER}
    GROUP BY j.day
  `).all(...params) as any[]
  const dayCountMap = new Map<number, number>()
  for (const r of dayStudentCounts) dayCountMap.set(r.day, r.student_count)

  // 取学生粒度的答题数据，JS 层归并后按人统计错误
  const rawRows = db.prepare(`
    SELECT j.day, a.question_title, a.correct_answer, a.knowledge_points as kp,
           j.student_id, a.is_correct
    FROM answers a
    JOIN jobs j ON a.job_id = j.job_id
    WHERE j.term = ? AND j.semester = ? ${enrollFilter}
      AND a.is_hidden = 0
      AND ${LATEST_JOB_FILTER}
  `).all(...params) as any[]

  // --- JS 层按归一化 key 二次归并，按人统计 ---
  interface MergedEntry {
    day: number
    normalizedKey: string
    titles: string[]
    correctAnswers: string[]
    rawPairs: Array<{ title: string, answer: string }>
    kp: string
    /** 做了这道题的学生集合 */
    studentIds: Set<string>
    /** 至少有一个空做错的学生集合 */
    errorStudentIds: Set<string>
  }
  const mergedMap = new Map<string, MergedEntry>()
  for (const r of rawRows) {
    const nk = normalizeQuestionTitle(r.question_title)
    const key = `${nk}|${r.day}`
    const existing = mergedMap.get(key)
    if (existing) {
      if (!existing.titles.includes(r.question_title)) {
        existing.titles.push(r.question_title)
      }
      if (!existing.correctAnswers.includes(r.correct_answer)) {
        existing.correctAnswers.push(r.correct_answer)
      }
      if (!existing.rawPairs.some(p => p.title === r.question_title && p.answer === r.correct_answer)) {
        existing.rawPairs.push({ title: r.question_title, answer: r.correct_answer })
      }
      existing.studentIds.add(r.student_id)
      if (r.is_correct === 0) existing.errorStudentIds.add(r.student_id)
      if ((!existing.kp || existing.kp === '[]') && r.kp && r.kp !== '[]') {
        existing.kp = r.kp
      }
    } else {
      const entry: MergedEntry = {
        day: r.day,
        normalizedKey: nk,
        titles: [r.question_title],
        correctAnswers: [r.correct_answer],
        rawPairs: [{ title: r.question_title, answer: r.correct_answer }],
        kp: r.kp || '[]',
        studentIds: new Set([r.student_id]),
        errorStudentIds: new Set(),
      }
      if (r.is_correct === 0) entry.errorStudentIds.add(r.student_id)
      mergedMap.set(key, entry)
    }
  }

  const mergedRows = [...mergedMap.values()]
    .map(m => {
      const dayTotal = dayCountMap.get(m.day) || m.studentIds.size
      const errorCount = m.errorStudentIds.size
      return { ...m, totalAttempts: dayTotal, errorCount, errorRate: dayTotal > 0 ? errorCount / dayTotal : 0 }
    })
    .filter(m => m.errorCount > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, limit)

  // --- errorStudents：用所有原始 (title, answer) 对查询 ---
  const allPairs = mergedRows.flatMap(m =>
    m.rawPairs.map(p => ({ ...p, day: m.day })),
  )
  const errorStudentRows = allPairs.length > 0
    ? db.prepare(`
        SELECT a.question_title, a.correct_answer, j.day, s.name, a.student_answer, j.job_id
        FROM answers a
        JOIN jobs j ON a.job_id = j.job_id
        JOIN students s ON j.student_id = s.id
        WHERE a.is_correct = 0 AND a.is_hidden = 0
          AND j.term = ? AND j.semester = ?
          AND ${LATEST_JOB_FILTER}
          AND (${allPairs.map(() => '(a.question_title = ? AND a.correct_answer = ? AND j.day = ?)').join(' OR ')})
        ORDER BY a.question_title, j.day, s.name
      `).all(term, semester, ...allPairs.flatMap(p => [p.title, p.answer, p.day])) as any[]
    : []

  // 按归一化 key（不含 correct_answer）聚合学生
  const errorStudentMap = new Map<string, any[]>()
  for (const es of errorStudentRows) {
    const nk = normalizeQuestionTitle(es.question_title)
    const key = `${nk}|${es.day}`
    if (!errorStudentMap.has(key)) errorStudentMap.set(key, [])
    const arr = errorStudentMap.get(key)!
    if (!arr.some((x: any) => x.name === es.name)) {
      arr.push({ name: es.name, student_answer: es.student_answer, job_id: es.job_id })
    }
  }

  const questions = mergedRows.map((m) => {
    const key = `${m.normalizedKey}|${m.day}`
    const shortest = m.titles.reduce((a, b) => a.length <= b.length ? a : b)
    return {
      day: m.day,
      subTitle: shortest || '未知题目',
      correctAnswer: m.correctAnswers.join('、'),
      knowledgePoints: m.kp,
      totalAttempts: m.totalAttempts,
      errorCount: m.errorCount,
      errorRate: m.errorRate,
      errorStudents: errorStudentMap.get(key) || [],
    }
  })

  const result = { semester, questions }
  cacheSet(cacheKey, result, 60_000)
  return c.json(result)
})

/**
 * GET /api/analytics/class-advice
 * 加载已保存的全班教研建议
 */
app.get('/class-advice', (c) => {
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  if (!term || !semester) return c.json({ error: '缺少参数' }, 400)

  const db = getDb()
  const row = db.prepare(
    `SELECT content, created_at FROM reports WHERE student_id = '__class__' AND term = ? AND semester = ? AND report_type = 'class_advice' ORDER BY created_at DESC LIMIT 1`,
  ).get(term, semester) as any

  return c.json({ advice: row?.content || '', createdAt: row?.created_at || null })
})

/**
 * POST /api/analytics/class-advice/save
 * 保存全班教研建议
 */
app.post('/class-advice/save', async (c) => {
  const { term, semester, content } = await c.req.json()
  if (!term || !semester || !content) return c.json({ error: '缺少参数' }, 400)

  const db = getDb()
  db.prepare(
    `DELETE FROM reports WHERE student_id = '__class__' AND term = ? AND semester = ? AND report_type = 'class_advice'`,
  ).run(term, semester)
  db.prepare(
    `INSERT INTO reports (student_id, semester, term, report_type, content, created_at) VALUES ('__class__', ?, ?, 'class_advice', ?, datetime('now'))`,
  ).run(semester, term, content)

  return c.json({ ok: true })
})

/**
 * POST /api/analytics/class-teaching-advice
 * AI 教研建议（流式）
 *
 * Body: { term, semester, stats, weakKnowledge, errorQuestions, anomalyDays, instruction? }
 */
app.post('/class-teaching-advice', async (c) => {
  const body = await c.req.json()
  const { term, semester, stats, weakKnowledge, errorQuestions, anomalyDays, instruction } = body

  const prompt = `你是一位资深的小学数学教研员，正在分析一期计算营班课的教学数据，为下一期同 level 班课的优化提供建议。

## 班课基本数据
- 学期：${semester}，期数：${term}
- 参与学生：${stats?.studentCount || 0}名
- 总提交天次：${stats?.totalSubmissions || 0}，总题数：${stats?.totalQuestions || 0}
- 全班平均正确率：${stats?.avgAccuracy || 0}%
- 满分天次：${stats?.perfectDays || 0}

## 薄弱知识点 TOP 5
${weakKnowledge || '暂无数据'}

## 高频错题 TOP 5
${errorQuestions || '暂无数据'}

## 难度异常天
${anomalyDays || '无明显异常'}

## 要求
1. 基于以上数据，给出 3-5 条具体的教研优化建议
2. 每条建议要具体可执行，指出问题在哪、建议怎么改
3. 可以涉及：题目难度调整、知识点训练侧重、练习顺序优化、教学重点提示
4. 语气专业、简洁，面向教研团队
5. 不要用 markdown 格式
${instruction ? `\n## 老师补充指令（优先级最高）\n${instruction}` : ''}`

  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) return c.json({ error: '未配置 ARK_API_KEY' }, 500)

  const resp = await fetch(ARK_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ARK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      reasoning_effort: 'low',
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    return c.json({ error: `LLM 错误: ${resp.status}`, detail: errText }, 500)
  }

  return streamText(c, async (stream) => {
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') break
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta
          if (delta?.reasoning_content) continue
          const content = delta?.content
          if (content) await stream.write(content)
        } catch { /* skip */ }
      }
    }
  })
})

export default app
