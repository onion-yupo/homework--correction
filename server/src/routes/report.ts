/**
 * report 路由 — 周报生成 & PDF 导出
 *
 * POST /api/report/generate-weekly  生成周学习报告（流式）
 * GET  /api/report/weekly           获取已保存的周报
 * GET  /api/report/status           批量查询报告状态
 * GET  /api/report/export-pdf       Puppeteer 服务端渲染 PDF
 */
import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { streamText } from 'hono/streaming'
import { getDb } from '../lib/database.js'
import { assertStudentVisible, canSeeAll, getCurrentTeacher } from '../lib/access.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_MODEL = 'doubao-seed-2-0-lite-260215'

const app = new Hono()

import { cacheInvalidate } from '../lib/cache.js'

function getReportScope(db: ReturnType<typeof getDb>, studentId: string, term: string, semester: string) {
  return db.prepare(`
    SELECT camp_id, cohort_id FROM enrollments
    WHERE student_id = ? AND term = ? AND semester = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(studentId, term, semester) as { camp_id: string | null; cohort_id: string | null } | undefined
}

const WEEK_RANGES: Record<number, [number, number]> = { 1: [1, 7], 2: [8, 14], 3: [15, 21] }
const LATEST_JOB_FILTER = `
  j.rowid = (
    SELECT j2.rowid FROM jobs j2
    WHERE j2.student_id = j.student_id AND j2.term = j.term AND j2.semester = j.semester AND j2.day = j.day
    ORDER BY j2.submitted_at DESC LIMIT 1
  )
`

const DAY_LABELS: Record<number, string> = { 22: '第一周易错点加练', 23: '第二周易错点加练', 24: '第三周易错点加练' }
function dayLabel(d: number): string { return DAY_LABELS[d] || `第${d}天` }

interface DailyData {
  day: number; accuracy: number; totalQuestions: number
  correctCount: number; errorCount: number; isPerfect: boolean
  feedbackContent: string | null
}

interface ErrorDetail {
  day: number; questionTitle: string; studentAnswer: string
  correctAnswer: string; knowledgePoints: string[]; answerAnalysis: string
}

interface KnowledgeStat {
  name: string; total: number; correct: number; accuracy: number
}

/* ===== 批量生成进度追踪 ===== */
interface BatchProgress {
  total: number
  completed: number
  failed: number
  running: boolean
  currentStudent: string | null
}
const batchJobs = new Map<string, BatchProgress>()

/**
 * 非流式生成单个学生的周报并保存到 reports 表。
 * 从 generate-weekly 提取的核心逻辑，供批量生成复用。
 */
async function generateReportSync(
  studentId: string,
  semester: string,
  term: string,
  week: number,
): Promise<boolean> {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) return false

  const range = WEEK_RANGES[week]
  if (!range) return false

  const db = getDb()

  const student = db.prepare('SELECT name FROM students WHERE id = ?').get(studentId) as any
  if (!student) return false

  const jobs = db.prepare(`
    SELECT j.* FROM jobs j
    WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND j.day BETWEEN ? AND ?
      AND ${LATEST_JOB_FILTER}
    ORDER BY j.day
  `).all(studentId, term, semester, range[0], range[1]) as any[]

  if (!jobs.length) return false

  const dailyData: DailyData[] = jobs.map(j => ({
    day: j.day, accuracy: j.accuracy, totalQuestions: j.total_questions,
    correctCount: j.correct_count, errorCount: j.error_count,
    isPerfect: j.accuracy >= 0.999, feedbackContent: j.feedback_content || null,
  }))

  const jobIds = jobs.map(j => j.job_id)
  const ph = jobIds.map(() => '?').join(',')
  const answers = db.prepare(`
    SELECT a.*, j.day FROM answers a JOIN jobs j ON a.job_id = j.job_id
    WHERE a.job_id IN (${ph}) AND a.is_hidden = 0
    ORDER BY j.day, a.answer_index
  `).all(...jobIds) as any[]

  const errorList: ErrorDetail[] = answers.filter(a => !a.is_correct).map(a => ({
    day: a.day, questionTitle: a.question_title || '', studentAnswer: a.student_answer || '',
    correctAnswer: a.correct_answer || '',
    knowledgePoints: (() => { try { return JSON.parse(a.knowledge_points || '[]') } catch { return [] } })(),
    answerAnalysis: a.answer_analysis || '',
  }))

  const kpMap = new Map<string, { total: number; correct: number }>()
  for (const a of answers) {
    try {
      const points: string[] = JSON.parse(a.knowledge_points || '[]')
      for (const p of points) {
        if (!kpMap.has(p)) kpMap.set(p, { total: 0, correct: 0 })
        const stat = kpMap.get(p)!
        stat.total++
        if (a.is_correct) stat.correct++
      }
    } catch { /* skip */ }
  }
  const knowledgeStats: KnowledgeStat[] = Array.from(kpMap.entries())
    .map(([name, s]) => ({ name, total: s.total, correct: s.correct, accuracy: s.total > 0 ? s.correct / s.total : 0 }))
    .sort((a, b) => b.accuracy - a.accuracy)

  const totalDays = dailyData.length
  const totalQuestions = dailyData.reduce((s, d) => s + d.totalQuestions, 0)
  const totalCorrect = dailyData.reduce((s, d) => s + d.correctCount, 0)
  const totalErrors = dailyData.reduce((s, d) => s + d.errorCount, 0)
  const avgAccuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0
  const perfectDays = dailyData.filter(d => d.isPerfect).length

  function extractWritingSection(feedbackContent: string): string {
    const pattern = /### 二、书写评价\s*\n([\s\S]*?)(?=\n### [一二三四五六七八九十]|$)/
    const match = feedbackContent.match(pattern)
    if (match) return match[1].trim()
    return feedbackContent.slice(0, 500)
  }

  const writingFeedbacks = dailyData
    .filter(d => d.feedbackContent)
    .map(d => `${dayLabel(d.day)}:\n${extractWritingSection(d.feedbackContent!)}`)
    .join('\n\n')

  const reportData = {
    meta: { studentName: student.name, semester, term, week, dayRange: range, generatedAt: new Date().toISOString() },
    stats: { totalDays, totalQuestions, avgAccuracy, perfectDays, totalCorrect, totalErrors },
    dailyData, errors: errorList, knowledge: knowledgeStats,
  }

  const dayLines = dailyData.map(d => {
    const acc = Math.round(d.accuracy * 100)
    return `${dayLabel(d.day)}: 正确率${acc}%, ${d.totalQuestions}题(对${d.correctCount}错${d.errorCount})${d.isPerfect ? ' ★满分' : ''}`
  }).join('\n')

  const errorLines = errorList.map(e => {
    const kp = e.knowledgePoints.join('、') || '未分类'
    return `${dayLabel(e.day)} | 题目: ${e.questionTitle} | 正确答案: ${e.correctAnswer} | 学生答案: ${e.studentAnswer} | 知识点: ${kp} | 错因: ${e.answerAnalysis}`
  }).join('\n')

  const kpLines = knowledgeStats.map(k =>
    `${k.name}: 正确率${Math.round(k.accuracy * 100)}% (${k.correct}/${k.total})`
  ).join('\n')

  const prompt = `你是一位小学数学辅导老师，正在为学生撰写本周计算练习学习报告。报告面向家长，语气温暖鼓励、内容具体有细节、不笼统空洞。

重要格式规则：
- 禁止使用任何 markdown 格式符号（如 **粗体**、*斜体*、__下划线__ 等）
- 直接用纯文本表达，不要加任何标记符号
- 严格按照下面每个 === 区域要求的格式输出

## 学生信息
- 姓名：${student.name}
- 学期：${semester}
- 周次：第${week}周（${dayLabel(range[0])} 到 ${dayLabel(range[1])}）

## 本周每日数据
${dayLines}

总计：${totalDays}天练习，${totalQuestions}题，正确${totalCorrect}题，错误${totalErrors}题
总体正确率：${Math.round(avgAccuracy * 100)}%，满分${perfectDays}次

## 错题详情（${errorList.length}道）
${errorLines || '本周全部正确，无错题'}

## 知识点掌握
${kpLines || '暂无知识点数据'}

## 每日书写评价（来自每天反馈建议的"书写评价"模块，三维度：整体书写/字迹清晰度/卷面整洁度）
${writingFeedbacks || '暂无书写反馈'}

---

请严格按以下格式输出（每个部分用 ===SECTION=== 标记分隔）：

===HIGHLIGHTS===
本周亮点，3-5条，每条以 [STAR] 开头。从数据中挖掘闪光点，如正确率高的天数、满分表现、某类题型全对、坚持每天练习等。不要用"进步""退步"等比较性表述，因为每天题目难度不同不具备直接对比性。

===KNOWLEDGE_TEXT===
掌握的知识点，3-6条，每条以 [DOT] 开头。格式：[DOT] 知识点名 — 一句话描述孩子在该知识点的表现。只列正确率≥70%且有代表性的知识点，用文字自然描述（不需要百分比数据）。

===PRAISE===
值得称赞的细节，3-4条，每条以 [DOT] 开头。从具体题目和数据中发现亮点，用温暖的语言表达。

===WRITING===
书写评价，先输出3行（格式：维度|评价词）：
整体书写|评价词
字迹清晰度|评价词
卷面整洁度|评价词
然后空一行，输出2-3句书写评语。如果没有书写反馈信息，则根据正确率和练习表现合理推测。

===ERROR_TIPS===
对每道错题生成简洁的题目描述和学习技巧（最多8道最有代表性的）。格式：
### ${dayLabel(range[0])} · 题目大类
题目：xxx
[技巧] 一段学习技巧或记忆方法（用孩子能理解的语言，具体、可操作、有趣味性）

注意：只需要「题目」和「技巧」两项，不需要列出正确答案、学生答案、错误类型。
如果本周无错题，则输出：本周全部正确，太棒了！

===ENCOURAGEMENT===
鼓励话语，2-3句温暖鼓励的话，给孩子和家长信心。语气像一位温柔的老师在和家长说话。

===GROWTH===
成长空间，2-3条，每条以 [>>>] 开头。指出可以进一步提升的方向，语气正面积极（"如果能…就更棒了"而不是"需要改进…"）。

===PRACTICE===
练习建议，2-3条，每条以 [>>>] 开头。具体可执行的练习方式，适合家长配合孩子完成的。

===REMARK===
练习总结概况，一段话（80-120字），概括本周整体表现和值得关注的点。不要使用"进步""退步"等比较性表述。`

  console.log(`[Report][Batch] 生成: ${student.name} ${semester} 第${week}周`)

  const arkResponse = await fetch(ARK_BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ARK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      reasoning_effort: 'low',
    }),
    signal: AbortSignal.timeout(600_000),
  })

  if (!arkResponse.ok || !arkResponse.body) {
    console.error(`[Report][Batch] LLM 调用失败: ${arkResponse.status}`)
    return false
  }

  const reader = arkResponse.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

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
      if (data === '[DONE]') break

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (delta?.reasoning_content) continue
        const content = delta?.content
        if (content) fullText += content
      } catch { /* skip */ }
    }
  }

  if (!fullText.trim()) return false

  try {
    const scope = getReportScope(db, studentId, term, semester)
    db.prepare(`
      INSERT OR REPLACE INTO reports (student_id, camp_id, cohort_id, semester, term, report_type, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(studentId, scope?.camp_id || 'camp-calculation', scope?.cohort_id || 'cohort-calculation-2026-03', semester, term, `week${week}`, JSON.stringify({ ...reportData, generatedText: fullText }))
    cacheInvalidate('dashboard:')
    console.log(`[Report][Batch] 完成: ${student.name} ${semester} 第${week}周`)
    return true
  } catch (e) {
    console.error(`[Report][Batch] 保存失败:`, e)
    return false
  }
}

/**
 * POST /api/report/generate-weekly
 *
 * 聚合结构化数据 + 调用大模型流式生成周报文案
 * 流式输出格式：先发一行 JSON 结构化数据（以 __DATA__ 开头），再流式输出大模型文本
 */
app.post('/generate-weekly', async (c) => {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) return c.json({ error: '缺少 ARK_API_KEY 配置' }, 500)

  const { studentId, semester, term, week, instruction } = await c.req.json<{
    studentId: string; semester: string; term: string; week: number; instruction?: string
  }>()

  if (!studentId || !semester || !term || !week) {
    return c.json({ error: '缺少必要参数' }, 400)
  }
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权生成该学生周报' }, 403)
  }

  const range = WEEK_RANGES[week]
  if (!range) return c.json({ error: '无效的周次（1/2/3）' }, 400)

  const db = getDb()

  const student = db.prepare('SELECT name FROM students WHERE id = ?').get(studentId) as any
  if (!student) return c.json({ error: '学生不存在' }, 404)

  const jobs = db.prepare(`
    SELECT j.* FROM jobs j
    WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND j.day BETWEEN ? AND ?
      AND ${LATEST_JOB_FILTER}
    ORDER BY j.day
  `).all(studentId, term, semester, range[0], range[1]) as any[]

  if (!jobs.length) return c.json({ error: '该周暂无提交数据' }, 404)

  // ===== 聚合结构化数据 =====
  const dailyData: DailyData[] = jobs.map(j => ({
    day: j.day,
    accuracy: j.accuracy,
    totalQuestions: j.total_questions,
    correctCount: j.correct_count,
    errorCount: j.error_count,
    isPerfect: j.accuracy >= 0.999,
    feedbackContent: j.feedback_content || null,
  }))

  const jobIds = jobs.map(j => j.job_id)
  const ph = jobIds.map(() => '?').join(',')
  const answers = db.prepare(`
    SELECT a.*, j.day FROM answers a
    JOIN jobs j ON a.job_id = j.job_id
    WHERE a.job_id IN (${ph}) AND a.is_hidden = 0
    ORDER BY j.day, a.answer_index
  `).all(...jobIds) as any[]

  const errorList: ErrorDetail[] = answers.filter(a => !a.is_correct).map(a => ({
    day: a.day,
    questionTitle: a.question_title || '',
    studentAnswer: a.student_answer || '',
    correctAnswer: a.correct_answer || '',
    knowledgePoints: (() => { try { return JSON.parse(a.knowledge_points || '[]') } catch { return [] } })(),
    answerAnalysis: a.answer_analysis || '',
  }))

  const kpMap = new Map<string, { total: number; correct: number }>()
  for (const a of answers) {
    try {
      const points: string[] = JSON.parse(a.knowledge_points || '[]')
      for (const p of points) {
        if (!kpMap.has(p)) kpMap.set(p, { total: 0, correct: 0 })
        const stat = kpMap.get(p)!
        stat.total++
        if (a.is_correct) stat.correct++
      }
    } catch { /* skip */ }
  }
  const knowledgeStats: KnowledgeStat[] = Array.from(kpMap.entries())
    .map(([name, s]) => ({ name, total: s.total, correct: s.correct, accuracy: s.total > 0 ? s.correct / s.total : 0 }))
    .sort((a, b) => b.accuracy - a.accuracy)

  const totalDays = dailyData.length
  const totalQuestions = dailyData.reduce((s, d) => s + d.totalQuestions, 0)
  const totalCorrect = dailyData.reduce((s, d) => s + d.correctCount, 0)
  const totalErrors = dailyData.reduce((s, d) => s + d.errorCount, 0)
  const avgAccuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0
  const perfectDays = dailyData.filter(d => d.isPerfect).length

  /**
   * 从每天的 feedback_content 中精确提取 "### 二、书写评价" 模块内容。
   * 如果找不到新格式，降级为截取旧格式整篇前 500 字。
   */
  function extractWritingSection(feedbackContent: string): string {
    const pattern = /### 二、书写评价\s*\n([\s\S]*?)(?=\n### [一二三四五六七八九十]|$)/
    const match = feedbackContent.match(pattern)
    if (match) return match[1].trim()
    return feedbackContent.slice(0, 500)
  }

  const writingFeedbacks = dailyData
    .filter(d => d.feedbackContent)
    .map(d => `${dayLabel(d.day)}:\n${extractWritingSection(d.feedbackContent!)}`)
    .join('\n\n')

  const reportData = {
    meta: { studentName: student.name, semester, term, week, dayRange: range, generatedAt: new Date().toISOString() },
    stats: { totalDays, totalQuestions, avgAccuracy, perfectDays, totalCorrect, totalErrors },
    dailyData,
    errors: errorList,
    knowledge: knowledgeStats,
  }

  // ===== 构造 LLM Prompt =====
  const dayLines = dailyData.map(d => {
    const acc = Math.round(d.accuracy * 100)
    return `${dayLabel(d.day)}: 正确率${acc}%, ${d.totalQuestions}题(对${d.correctCount}错${d.errorCount})${d.isPerfect ? ' ★满分' : ''}`
  }).join('\n')

  const errorLines = errorList.map(e => {
    const kp = e.knowledgePoints.join('、') || '未分类'
    return `${dayLabel(e.day)} | 题目: ${e.questionTitle} | 正确答案: ${e.correctAnswer} | 学生答案: ${e.studentAnswer} | 知识点: ${kp} | 错因: ${e.answerAnalysis}`
  }).join('\n')

  const kpLines = knowledgeStats.map(k =>
    `${k.name}: 正确率${Math.round(k.accuracy * 100)}% (${k.correct}/${k.total})`
  ).join('\n')

  const prompt = `你是一位小学数学辅导老师，正在为学生撰写本周计算练习学习报告。报告面向家长，语气温暖鼓励、内容具体有细节、不笼统空洞。

重要格式规则：
- 禁止使用任何 markdown 格式符号（如 **粗体**、*斜体*、__下划线__ 等）
- 直接用纯文本表达，不要加任何标记符号
- 严格按照下面每个 === 区域要求的格式输出

## 学生信息
- 姓名：${student.name}
- 学期：${semester}
- 周次：第${week}周（${dayLabel(range[0])} 到 ${dayLabel(range[1])}）

## 本周每日数据
${dayLines}

总计：${totalDays}天练习，${totalQuestions}题，正确${totalCorrect}题，错误${totalErrors}题
总体正确率：${Math.round(avgAccuracy * 100)}%，满分${perfectDays}次

## 错题详情（${errorList.length}道）
${errorLines || '本周全部正确，无错题'}

## 知识点掌握
${kpLines || '暂无知识点数据'}

## 每日书写评价（来自每天反馈建议的"书写评价"模块，三维度：整体书写/字迹清晰度/卷面整洁度）
${writingFeedbacks || '暂无书写反馈'}

---

请严格按以下格式输出（每个部分用 ===SECTION=== 标记分隔）：

===HIGHLIGHTS===
本周亮点，3-5条，每条以 [STAR] 开头。从数据中挖掘闪光点，如正确率高的天数、满分表现、某类题型全对、坚持每天练习等。不要用"进步""退步"等比较性表述，因为每天题目难度不同不具备直接对比性。

===KNOWLEDGE_TEXT===
掌握的知识点，3-6条，每条以 [DOT] 开头。格式：[DOT] 知识点名 — 一句话描述孩子在该知识点的表现。只列正确率≥70%且有代表性的知识点，用文字自然描述（不需要百分比数据）。

===PRAISE===
值得称赞的细节，3-4条，每条以 [DOT] 开头。从具体题目和数据中发现亮点，用温暖的语言表达。

===WRITING===
书写评价，先输出3行（格式：维度|评价词）：
整体书写|评价词
字迹清晰度|评价词
卷面整洁度|评价词
然后空一行，输出2-3句书写评语。如果没有书写反馈信息，则根据正确率和练习表现合理推测。

===ERROR_TIPS===
对每道错题生成简洁的题目描述和学习技巧（最多8道最有代表性的）。格式：
### ${dayLabel(range[0])} · 题目大类
题目：xxx
[技巧] 一段学习技巧或记忆方法（用孩子能理解的语言，具体、可操作、有趣味性）

注意：只需要「题目」和「技巧」两项，不需要列出正确答案、学生答案、错误类型。
如果本周无错题，则输出：本周全部正确，太棒了！

===ENCOURAGEMENT===
鼓励话语，2-3句温暖鼓励的话，给孩子和家长信心。语气像一位温柔的老师在和家长说话。

===GROWTH===
成长空间，2-3条，每条以 [>>>] 开头。指出可以进一步提升的方向，语气正面积极（"如果能…就更棒了"而不是"需要改进…"）。

===PRACTICE===
练习建议，2-3条，每条以 [>>>] 开头。具体可执行的练习方式，适合家长配合孩子完成的。

===REMARK===
练习总结概况，一段话（80-120字），概括本周整体表现和值得关注的点。不要使用"进步""退步"等比较性表述。${instruction ? `\n\n---\n## 老师的补充指令（优先级最高，必须遵守）\n${instruction}` : ''}`

  console.log(`[Report] 生成周报: ${student.name} ${semester} 第${week}周, 数据: ${totalDays}天 ${totalQuestions}题 ${errorList.length}道错题`)

  // ===== 流式输出 =====
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
      reasoning_effort: 'low',
    }),
    signal: AbortSignal.timeout(600_000),
  })

  if (!arkResponse.ok || !arkResponse.body) {
    return c.json({ error: `大模型调用失败: ${arkResponse.status}` }, 502)
  }

  return streamText(c, async (stream) => {
    await stream.write(`__DATA__${JSON.stringify(reportData)}\n`)

    const reader = arkResponse.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

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
          // 保存到 reports 表
          try {
            const scope = getReportScope(db, studentId, term, semester)
            db.prepare(`
              INSERT OR REPLACE INTO reports (student_id, camp_id, cohort_id, semester, term, report_type, content, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `).run(studentId, scope?.camp_id || 'camp-calculation', scope?.cohort_id || 'cohort-calculation-2026-03', semester, term, `week${week}`, JSON.stringify({ ...reportData, generatedText: fullText }))
          } catch (e) {
            console.error('[Report] 保存失败:', e)
          }
          await stream.write('\n[DONE]')
          return
        }

        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          // 跳过思考阶段的 reasoning_content，只转发正式 content
          if (delta?.reasoning_content) continue
          const content = delta?.content
          if (content) {
            fullText += content
            await stream.write(content)
          }
        } catch { /* skip parse errors */ }
      }
    }
  })
})

/**
 * GET /api/report/weekly
 *
 * 获取已保存的周报
 */
app.get('/weekly', (c) => {
  const studentId = c.req.query('studentId')
  const semester = c.req.query('semester')
  const term = c.req.query('term')
  const week = c.req.query('week')

  if (!studentId || !semester || !term || !week) {
    return c.json({ error: '缺少参数' }, 400)
  }
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权查看该学生周报' }, 403)
  }

  const db = getDb()
  const report = db.prepare(
    'SELECT * FROM reports WHERE student_id = ? AND semester = ? AND term = ? AND report_type = ?'
  ).get(studentId, semester, term, `week${week}`) as any

  if (!report) return c.json({ exists: false })

  return c.json({ exists: true, content: JSON.parse(report.content || '{}'), createdAt: report.created_at })
})

/**
 * GET /api/report/status
 *
 * 批量查询某学生的报告生成状态
 */
app.get('/status', (c) => {
  const studentId = c.req.query('studentId')
  const semester = c.req.query('semester')
  const term = c.req.query('term')

  if (!studentId || !semester || !term) return c.json({ error: '缺少参数' }, 400)
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权查看该学生周报状态' }, 403)
  }

  const db = getDb()
  const reports = db.prepare(
    'SELECT report_type, created_at FROM reports WHERE student_id = ? AND semester = ? AND term = ?'
  ).all(studentId, semester, term) as any[]

  const status: Record<string, string> = {}
  for (const r of reports) {
    status[r.report_type] = r.created_at
  }

  return c.json({ status })
})

/**
 * GET /api/report/status-batch
 *
 * 批量查询某期所有学生的报告状态
 * ?term=xxx
 */
app.get('/status-batch', (c) => {
  const term = c.req.query('term')
  if (!term) return c.json({ error: '缺少 term 参数' }, 400)

  const db = getDb()
  const teacher = getCurrentTeacher(c)
  if (!teacher) return c.json({ error: '未登录' }, 401)
  const reports = canSeeAll(teacher)
    ? db.prepare(
      'SELECT student_id, semester, report_type, created_at FROM reports WHERE term = ?'
    ).all(term) as { student_id: string; semester: string; report_type: string; created_at: string }[]
    : db.prepare(`
      SELECT r.student_id, r.semester, r.report_type, r.created_at
      FROM reports r
      JOIN enrollments e ON e.student_id = r.student_id AND e.term = r.term AND e.semester = r.semester
      WHERE r.term = ? AND e.teacher_id = ?
    `).all(term, teacher.id) as { student_id: string; semester: string; report_type: string; created_at: string }[]

  const result: Record<string, Record<string, string>> = {}
  for (const r of reports) {
    const key = `${r.student_id}_${r.semester}`
    if (!result[key]) result[key] = {}
    result[key][r.report_type] = r.created_at
  }

  return c.json({ statuses: result })
})

/**
 * Puppeteer 浏览器单例 — 复用实例避免反复启动 Chrome 导致服务器卡死
 */
let _browser: any = null
let _browserClosingTimer: ReturnType<typeof setTimeout> | null = null
const BROWSER_IDLE_MS = 60_000

async function getBrowser() {
  if (_browserClosingTimer) { clearTimeout(_browserClosingTimer); _browserClosingTimer = null }
  if (_browser?.connected) return _browser
  const puppeteer = await import('puppeteer')
  _browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
  })
  _browser.on('disconnected', () => { _browser = null })
  return _browser
}

function scheduleBrowserClose() {
  if (_browserClosingTimer) clearTimeout(_browserClosingTimer)
  _browserClosingTimer = setTimeout(async () => {
    if (_browser?.connected) {
      await _browser.close().catch(() => {})
      _browser = null
      console.log('[Report] Puppeteer 浏览器闲置关闭')
    }
  }, BROWSER_IDLE_MS)
}

/**
 * GET /api/report/export-pdf
 *
 * 服务端生成 HTML → Puppeteer 渲染 PDF（复用浏览器实例）
 */
app.get('/export-pdf', async (c) => {
  const studentId = c.req.query('studentId')
  const semester = c.req.query('semester')
  const term = c.req.query('term')
  const week = c.req.query('week')

  if (!studentId || !semester || !term || !week) {
    return c.json({ error: '缺少参数' }, 400)
  }
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权导出该学生周报' }, 403)
  }

  const db = getDb()
  const report = db.prepare(
    'SELECT * FROM reports WHERE student_id = ? AND semester = ? AND term = ? AND report_type = ?'
  ).get(studentId, semester, term, `week${week}`) as any

  if (!report) return c.json({ error: '报告尚未生成，请先生成报告' }, 404)

  const content = JSON.parse(report.content || '{}')
  const html = buildReportHtml(content)

  const studentName = content.meta?.studentName || studentId

  console.log(`[Report] PDF导出: ${studentName} ${semester} 第${week}周`)

  const tmpHtmlPath = path.resolve(__dirname, `../../../.tmp-report-${Date.now()}.html`)
  let page: any = null

  try {
    fs.writeFileSync(tmpHtmlPath, html, 'utf-8')

    const browser = await getBrowser()
    page = await browser.newPage()
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.evaluateHandle('document.fonts.ready')
    await new Promise(r => setTimeout(r, 1000))

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', bottom: '8mm', left: '6mm', right: '6mm' },
    })

    const filename = `周报_${studentName}_${semester}_第${week}周.pdf`

    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(pdf.byteLength),
      },
    })
  } catch (e: any) {
    console.error('[Report] PDF导出失败:', e)
    return c.json({ error: `PDF生成失败: ${e.message}` }, 500)
  } finally {
    if (page) await page.close().catch(() => {})
    try { fs.unlinkSync(tmpHtmlPath) } catch { /* ignore */ }
    scheduleBrowserClose()
  }
})

/* ===================================================================
 * 服务端 HTML 模板：完整独立的周报页面（内嵌 CSS + Google Fonts）
 * =================================================================== */

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function pct(v: number): string { return `${Math.round(v * 100)}%` }

function parseSections(text: string): Record<string, string> {
  const markers = [
    'HIGHLIGHTS', 'KNOWLEDGE_TEXT', 'KNOWLEDGE', 'PRAISE', 'WRITING', 'ERROR_TIPS',
    'ENCOURAGEMENT', 'GROWTH', 'PRACTICE', 'REMARK',
    'SUGGESTIONS', 'SUMMARY',
  ]
  const result: Record<string, string> = {}
  for (let i = 0; i < markers.length; i++) {
    const start = text.indexOf(`===${markers[i]}===`)
    if (start === -1) continue
    const contentStart = start + markers[i].length + 6
    let end = text.length
    for (let j = i + 1; j < markers.length; j++) {
      const next = text.indexOf(`===${markers[j]}===`)
      if (next !== -1) { end = next; break }
    }
    result[markers[i]] = text.slice(contentStart, end).trim()
  }
  return result
}

function parseList(raw: string | undefined, prefix: string): string[] {
  if (!raw) return []
  return raw.split('\n').filter(l => l.includes(prefix)).map(l => esc(l.slice(l.indexOf(prefix) + prefix.length).trim()))
}

function buildReportHtml(content: any): string {
  const meta = content.meta || {}
  const stats = content.stats || {}
  const dailyData: DailyData[] = content.dailyData || []
  const generatedText: string = content.generatedText || ''
  const sections = parseSections(generatedText)

  const highlights = parseList(sections.HIGHLIGHTS, '[STAR]')
  const knowledgeTextItems = parseList(sections.KNOWLEDGE_TEXT || sections.KNOWLEDGE, '[DOT]')
  const praiseItems = parseList(sections.PRAISE, '[DOT]')
  const encouragement = esc(sections.ENCOURAGEMENT || '')
  const growthItems = parseList(sections.GROWTH, '[>>>]')
  const practiceItems = parseList(sections.PRACTICE, '[>>>]')
  const legacySuggestions = parseList(sections.SUGGESTIONS, '[>>>]')
  const remark = esc(sections.REMARK || sections.SUMMARY || '')

  const writingDimensions: { label: string; value: string }[] = []
  let writingComment = ''
  if (sections.WRITING) {
    const wLines = sections.WRITING.split('\n').filter((l: string) => l.trim())
    let ci = 0
    for (let i = 0; i < wLines.length; i++) {
      if (wLines[i].includes('|')) {
        const parts = wLines[i].split('|').map((s: string) => s.trim())
        if (parts.length >= 2) writingDimensions.push({ label: parts[0], value: parts[1] })
        ci = i + 1
      } else { break }
    }
    writingComment = esc(wLines.slice(ci).join(' ').trim())
  }

  interface ParsedError { title: string; question: string; technique: string }
  const errorTips: ParsedError[] = []
  if (sections.ERROR_TIPS) {
    const blocks = sections.ERROR_TIPS.split('###').filter((b: string) => b.trim())
    for (const block of blocks) {
      const lines = block.split('\n').filter((l: string) => l.trim())
      const title = (lines[0]?.trim() || '').replace(/[·・]\s*本题\s*$/, '')
      const find = (prefix: string) => lines.find((l: string) => l.trim().startsWith(prefix))?.trim().slice(prefix.length).trim() || ''
      if (title) errorTips.push({
        title: esc(title),
        question: esc(find('题目：') || find('题目:')),
        technique: esc(find('[技巧]')),
      })
    }
  }

  const dailyRowsHtml = dailyData.map((d: DailyData) => {
    const acc = d.accuracy
    const tagClass = acc >= 1 ? 'tag-perfect' : acc >= 0.9 ? 'tag-great' : acc >= 0.8 ? 'tag-ok' : 'tag-warn'
    return `<tr><td class="day-col">${esc(dayLabel(d.day))}</td><td>${d.totalQuestions}</td><td>${d.correctCount}</td><td>${d.errorCount}</td><td><span class="acc-tag ${tagClass}">${pct(acc)}</span></td></tr>`
  }).join('')

  const highlightsHtml = highlights.map(h => `<li>${h}</li>`).join('')
  const knowledgeTextHtml = knowledgeTextItems.map(k => `<li>${k}</li>`).join('')
  const praiseHtml = praiseItems.map(p => `<li>${p}</li>`).join('')
  const writingTagsHtml = writingDimensions.map(d => `<div class="wc"><div class="wc-icon">${d.label === '整体书写' ? '📝' : d.label === '字迹清晰度' ? '👁' : '✨'}</div><div class="wc-v">${esc(d.value)}</div><div class="wc-l">${esc(d.label)}</div></div>`).join('')

  const errorTipsHtml = errorTips.slice(0, 8).map((t, i) => `
    <div class="et-card">
      <div class="et-hdr"><span class="et-num">${i + 1}</span><b>${t.title}</b></div>
      ${t.question ? `<div class="et-q"><strong>题目：</strong>${t.question}</div>` : ''}
      ${t.technique ? `<div class="et-tip"><span class="et-bulb">💡</span> ${t.technique}</div>` : ''}
    </div>
  `).join('')

  const hasNewSuggFormat = growthItems.length > 0 || practiceItems.length > 0
  let suggestionsBlockHtml = ''
  if (hasNewSuggFormat) {
    suggestionsBlockHtml = `
      ${encouragement ? `<div class="sg-sub"><h4 class="sg-sub-t">💪 鼓励话语</h4><p class="sg-enc">${encouragement}</p></div>` : ''}
      ${growthItems.length ? `<div class="sg-sub"><h4 class="sg-sub-t">🌱 成长空间</h4>${growthItems.map(g => `<div class="sg-item"><span class="sg-arr">▸</span><span>${g}</span></div>`).join('')}</div>` : ''}
      ${practiceItems.length ? `<div class="sg-sub"><h4 class="sg-sub-t">📝 练习建议</h4>${practiceItems.map(p => `<div class="sg-item"><span class="sg-arr">▸</span><span>${p}</span></div>`).join('')}</div>` : ''}
    `
  } else if (legacySuggestions.length) {
    suggestionsBlockHtml = legacySuggestions.map(s => `<div class="sg-item"><span class="sg-arr">▸</span><span>${s}</span></div>`).join('')
  }

  const dayRangeStr = meta.dayRange ? `${dayLabel(meta.dayRange[0])} ~ ${dayLabel(meta.dayRange[1])}` : ''

  const fontsDir = path.resolve(__dirname, '../../../public/fonts')
  const logoWhitePath = path.resolve(__dirname, '../../../public/logo-white.png')
  const logoDarkPath = path.resolve(__dirname, '../../../public/logo-dark.png')

  const logoWhiteB64 = fs.existsSync(logoWhitePath) ? `data:image/png;base64,${fs.readFileSync(logoWhitePath).toString('base64')}` : ''
  const logoDarkB64 = fs.existsSync(logoDarkPath) ? `data:image/png;base64,${fs.readFileSync(logoDarkPath).toString('base64')}` : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
@font-face{font-family:'AlibabaPuHuiTi';src:url('file://${fontsDir}/AlibabaPuHuiTi-2-55-Regular.ttf') format('truetype');font-weight:400}
@font-face{font-family:'AlibabaPuHuiTi';src:url('file://${fontsDir}/AlibabaPuHuiTi-2-65-Medium.ttf') format('truetype');font-weight:500}
@font-face{font-family:'AlibabaPuHuiTi';src:url('file://${fontsDir}/AlibabaPuHuiTi-2-85-Bold.ttf') format('truetype');font-weight:700}
@font-face{font-family:'AlibabaPuHuiTi';src:url('file://${fontsDir}/AlibabaPuHuiTi-2-95-ExtraBold.ttf') format('truetype');font-weight:800}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'AlibabaPuHuiTi','PingFang SC',sans-serif;color:#333;font-size:13px;line-height:1.6;background:#fff}
.page{padding:32px 40px;page-break-after:always;min-height:0;position:relative}
.page:last-child{page-break-after:avoid}

.cover{background:linear-gradient(135deg,#4A90E2 0%,#5BA0F0 50%,#7AB8FF 100%);border-radius:16px;padding:24px 28px;text-align:center;color:#fff;margin-bottom:18px;position:relative;overflow:hidden}
.cover::before{content:'';position:absolute;inset:0;background:linear-gradient(60deg,transparent 40%,rgba(255,255,255,.08) 40%,rgba(255,255,255,.08) 42%,transparent 42%),linear-gradient(-60deg,transparent 40%,rgba(255,255,255,.06) 40%,rgba(255,255,255,.06) 42%,transparent 42%);pointer-events:none}
.cover-logo{height:28px;margin-bottom:4px;position:relative}
.cover-week-num{font-size:64px;font-weight:800;line-height:1;position:relative;letter-spacing:-2px;margin-bottom:0}
.cover-week-label{font-size:13px;font-weight:700;letter-spacing:6px;opacity:.7;position:relative;margin-bottom:6px}
.cover-title{font-size:18px;font-weight:700;margin-bottom:4px;position:relative;opacity:.95}
.cover-meta{font-size:12px;opacity:.8;position:relative}

.sh{font-size:15px;font-weight:700;color:#4A90E2;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #4A90E2;display:flex;align-items:center;gap:8px}
.sh .num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#4A90E2;color:#fff;font-size:12px;font-weight:700}
.section{margin-bottom:20px}
.sub-title{font-size:14px;font-weight:600;color:#2a3b4c;margin:16px 0 8px;display:flex;align-items:center;gap:6px}

/* 基本信息卡片 */
.info-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.info-card{background:linear-gradient(135deg,#f8f9fa,#eef2f7);border:1px solid #f0f5ff;border-radius:10px;padding:14px 10px;text-align:center}
.info-lbl{font-size:11px;color:#66758c;margin-bottom:4px}
.info-val{font-size:20px;font-weight:700;color:#2a3b4c}
.info-card.hl{background:linear-gradient(135deg,#4A90E2,#5BA0F0);border:none}
.info-card.hl .info-val{color:#fff}
.info-card.hl .info-lbl{color:rgba(255,255,255,.85)}

/* 进步速览 */
.progress-box{background:#f0fdf4;border-radius:12px;padding:14px 18px;border:1px solid #bbf7d0}
table{width:100%;border-collapse:collapse;font-size:12px}
th{padding:5px 8px;background:#ecfdf5;border:1px solid #d1fae5;font-weight:700;color:#065f46;font-size:11px}
td{padding:5px 8px;border:1px solid #d1fae5;text-align:center;background:#fff}
.day-col{font-weight:700;color:#333;text-align:left}
.acc-tag{font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;display:inline-block}
.tag-perfect{color:#059669;background:#d1fae5}
.tag-great{color:#0369a1;background:#dbeafe}
.tag-ok{color:#d97706;background:#fef3c7}
.tag-warn{color:#FF4D4F;background:#fee2e2}

/* 精彩表现列表 */
.hl-list,.nl-list{list-style:none;margin:0 0 8px;padding:0}
.hl-list li{padding:8px 14px;font-size:13px;line-height:1.7;background:#fff9e6;border-radius:8px;margin-bottom:8px}
.hl-list li::before{content:"★";color:#ffc107;margin-right:8px}
.nl-list li{padding:8px 14px;font-size:13px;line-height:1.7;background:#f0f8ff;border-radius:8px;margin-bottom:8px}
.nl-list li::before{content:"●";color:#4A90E2;margin-right:8px;font-size:8px;vertical-align:middle}

/* 书写评价 */
.wc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:10px}
.wc{text-align:center;padding:16px 10px;background:linear-gradient(135deg,#f0f9eb,#e6f7e0);border-radius:10px;border:1px solid #e6f7e0}
.wc-icon{font-size:22px;margin-bottom:6px}
.wc-v{font-size:15px;font-weight:700;color:#52c41a}
.wc-l{font-size:11px;color:#666;margin-top:2px}
.w-comment{font-size:13px;color:#2a3b4c;line-height:1.8;margin-top:10px}

/* 易错汇总 */
.et-card{background:linear-gradient(135deg,#fff7e6,#fff3cd);border-left:4px solid #fa8c16;padding:16px 18px;margin-bottom:14px;border-radius:0 10px 10px 0;break-inside:avoid}
.et-hdr{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:14px;color:#fa8c16}
.et-num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#fa8c16;color:#fff;font-size:12px;font-weight:700;flex-shrink:0}
.et-hdr b{color:#8c4c14}
.et-q{font-size:13px;color:#8c4c14;line-height:1.6;margin-bottom:8px}
.et-tip{font-size:13px;color:#4A90E2;line-height:1.7;background:rgba(74,144,226,.06);border-radius:8px;padding:10px 14px;display:flex;align-items:flex-start;gap:6px}
.et-bulb{flex-shrink:0}

/* 学习建议 */
.sg-sub{margin-bottom:14px}
.sg-sub-t{font-size:14px;font-weight:600;color:#2a3b4c;margin-bottom:6px}
.sg-enc{font-size:13px;color:#666;line-height:1.8;background:#f0fdf4;border-radius:10px;padding:12px 16px;border:1px solid #bbf7d0}
.sg-item{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;font-size:13px;line-height:1.7}
.sg-arr{color:#4A90E2;font-weight:700;flex-shrink:0}

/* 备注 */
.remark-box{background:linear-gradient(135deg,#f0f8ff,#e8f4f8);border-radius:10px;padding:18px 22px;border:1px solid #e8f4f8;font-size:13px;color:#2a3b4c;line-height:1.8}

.brand-footer{position:absolute;bottom:24px;left:40px;right:40px;display:flex;align-items:center;justify-content:center;gap:8px;padding-top:12px;border-top:1px solid #f0f0f0}
.brand-footer img{height:20px}
.brand-footer span{font-size:11px;color:#999;font-weight:500}
</style>
</head>
<body>

<!-- P1: 封面 + 基本信息 + 每周速览 -->
<div class="page">
  <div class="cover">
    ${logoWhiteB64 ? `<img src="${logoWhiteB64}" class="cover-logo" />` : ''}
    <div class="cover-week-num">${meta.week || ''}</div>
    <div class="cover-week-label">W E E K</div>
    <div class="cover-title">计算练习学习报告</div>
    <div class="cover-meta">${esc(meta.semester || '')} · ${esc(meta.studentName || '')}</div>
  </div>

  <div class="section">
    <div class="sh"><span class="num">1</span> 基本信息</div>
    <div class="info-grid">
      <div class="info-card"><div class="info-lbl">统计周期</div><div class="info-val" style="font-size:13px">${esc(dayRangeStr)}</div></div>
      <div class="info-card"><div class="info-lbl">练习天数</div><div class="info-val">${stats.totalDays || 0}天</div></div>
      <div class="info-card"><div class="info-lbl">题目总数</div><div class="info-val">${stats.totalQuestions || 0}</div></div>
      <div class="info-card"><div class="info-lbl">正确数</div><div class="info-val">${stats.totalCorrect || 0}</div></div>
      <div class="info-card hl"><div class="info-lbl">总体正确率</div><div class="info-val">${pct(stats.avgAccuracy || 0)}</div></div>
    </div>
  </div>

  ${dailyData.length ? `
  <div class="section">
    <div class="progress-box">
      <div class="sh" style="border:none;padding:0;margin-bottom:10px;color:#065f46">📊 每周进步速览</div>
      <table><thead><tr><th>天</th><th>题数</th><th>正确</th><th>错误</th><th>正确率</th></tr></thead>
      <tbody>${dailyRowsHtml}</tbody></table>
    </div>
  </div>` : ''}
</div>

<!-- P2: 精彩表现 -->
<div class="page">
  <div class="section">
    <div class="sh"><span class="num">2</span> 精彩表现</div>

    ${highlights.length ? `
    <div class="sub-title">⭐ 本周亮点</div>
    <ul class="hl-list">${highlightsHtml}</ul>` : ''}

    ${knowledgeTextItems.length ? `
    <div class="sub-title">📖 掌握的知识点</div>
    <ul class="nl-list">${knowledgeTextHtml}</ul>` : ''}

    ${praiseItems.length ? `
    <div class="sub-title">👍 值得称赞的细节</div>
    <ul class="nl-list">${praiseHtml}</ul>` : ''}

    ${writingDimensions.length ? `
    <div class="sub-title">✍️ 书写评价</div>
    <div class="wc-grid">${writingTagsHtml}</div>
    ${writingComment ? `<p class="w-comment">${writingComment}</p>` : ''}` : ''}
  </div>
</div>

<!-- P3: 易错汇总 -->
${errorTips.length ? `
<div class="page">
  <div class="section">
    <div class="sh"><span class="num">3</span> 易错汇总</div>
    ${errorTipsHtml}
  </div>
</div>` : ''}

<!-- P4: 学习建议 + 备注 -->
<div class="page">
  ${suggestionsBlockHtml ? `
  <div class="section">
    <div class="sh"><span class="num">4</span> 学习建议</div>
    ${suggestionsBlockHtml}
  </div>` : ''}

  ${remark ? `
  <div class="section">
    <div class="sh"><span class="num">5</span> 老师备注</div>
    <div class="remark-box">${remark}</div>
  </div>` : ''}

  <div class="brand-footer">
    ${logoDarkB64 ? `<img src="${logoDarkB64}" />` : ''}
    <span>洋葱学园 · 计算营 AI Copilot</span>
  </div>
</div>

</body>
</html>`
}

/**
 * GET /api/report/summary-video
 *
 * 获取学期总结视频文件
 * ?studentId=xxx&semester=xxx&term=xxx
 */
app.get('/summary-video', (c) => {
  const studentId = c.req.query('studentId')
  const semester = c.req.query('semester')
  const term = c.req.query('term')

  if (!studentId || !semester || !term) return c.json({ error: '缺少参数' }, 400)
  if (!assertStudentVisible(c, studentId, term, semester)) {
    return c.json({ error: '无权查看该学生总结视频' }, 403)
  }

  const db = getDb()
  const report = db.prepare(
    'SELECT content FROM reports WHERE student_id = ? AND semester = ? AND term = ? AND report_type = ?'
  ).get(studentId, semester, term, 'summary') as any

  if (!report) return c.json({ error: '总结视频尚未生成' }, 404)

  let content: any
  try { content = JSON.parse(report.content) } catch { return c.json({ error: '报告数据异常' }, 500) }

  if (content.type !== 'video' || !content.videoPath) {
    return c.json({ error: '非视频类型报告' }, 400)
  }

  const projectRoot = path.resolve(__dirname, '../../../')
  const videoAbsPath = path.resolve(projectRoot, content.videoPath)

  if (!fs.existsSync(videoAbsPath)) {
    return c.json({ error: '视频文件不存在', path: content.videoPath }, 404)
  }

  const stat = fs.statSync(videoAbsPath)
  const stream = fs.createReadStream(videoAbsPath)

  return new Response(stream as any, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(videoAbsPath))}"`,
    },
  })
})

/**
 * POST /api/report/generate-batch
 *
 * 一键批量生成某学期某周的周报。后台串行执行，立即返回。
 * Body: { term, semester, week }
 * week: 1/2/3
 */
app.post('/generate-batch', async (c) => {
  const { term, semester, week } = await c.req.json<{
    term: string; semester: string; week: number
  }>()

  if (!term || !semester || !week) return c.json({ error: '缺少参数' }, 400)
  const range = WEEK_RANGES[week]
  if (!range) return c.json({ error: '无效的周次（1/2/3）' }, 400)
  const teacher = getCurrentTeacher(c)
  if (!teacher) return c.json({ error: '未登录' }, 401)

  const batchKey = `${teacher.id}:${term}:${semester}:week${week}`

  const existing = batchJobs.get(batchKey)
  if (existing?.running) {
    return c.json({ status: 'already_running', progress: existing })
  }

  const db = getDb()

  const students = db.prepare(`
    SELECT DISTINCT e.student_id, s.name
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    WHERE e.term = ? AND e.semester = ?
      AND (? = 1 OR e.teacher_id = ?)
    ORDER BY s.name
  `).all(term, semester, canSeeAll(teacher) ? 1 : 0, teacher.id) as { student_id: string; name: string }[]

  const alreadyGenerated = new Set(
    (db.prepare(
      'SELECT student_id FROM reports WHERE term = ? AND semester = ? AND report_type = ?'
    ).all(term, semester, `week${week}`) as { student_id: string }[]).map(r => r.student_id)
  )

  const eligible: { studentId: string; name: string }[] = []
  for (const stu of students) {
    if (alreadyGenerated.has(stu.student_id)) continue
    const jobCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM jobs j
      WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND j.day BETWEEN ? AND ?
        AND ${LATEST_JOB_FILTER}
    `).get(stu.student_id, term, semester, range[0], range[1]) as any)?.cnt || 0
    if (jobCount > 0) eligible.push({ studentId: stu.student_id, name: stu.name })
  }

  if (!eligible.length) {
    return c.json({ status: 'nothing_to_generate', total: 0 })
  }

  const progress: BatchProgress = {
    total: eligible.length, completed: 0, failed: 0,
    running: true, currentStudent: null,
  }
  batchJobs.set(batchKey, progress)

  ;(async () => {
    for (const stu of eligible) {
      progress.currentStudent = stu.name
      try {
        const ok = await generateReportSync(stu.studentId, semester, term, week)
        if (ok) progress.completed++
        else progress.failed++
      } catch (e) {
        console.error(`[Report][Batch] 异常: ${stu.name}`, e)
        progress.failed++
      }
    }
    progress.running = false
    progress.currentStudent = null
    console.log(`[Report][Batch] 完成 ${batchKey}: ${progress.completed}/${progress.total} 成功, ${progress.failed} 失败`)
  })()

  return c.json({ status: 'started', batchKey, progress })
})

/**
 * GET /api/report/batch-progress
 *
 * 查询批量生成进度
 * ?term=xxx&semester=xxx&week=1
 */
app.get('/batch-progress', (c) => {
  const term = c.req.query('term')
  const semester = c.req.query('semester')
  const week = c.req.query('week')

  if (!term || !semester || !week) return c.json({ error: '缺少参数' }, 400)

  const teacher = getCurrentTeacher(c)
  if (!teacher) return c.json({ error: '未登录' }, 401)
  const batchKey = `${teacher.id}:${term}:${semester}:week${week}`
  const progress = batchJobs.get(batchKey)
  if (!progress) return c.json({ status: 'idle' })
  return c.json({ status: progress.running ? 'running' : 'done', progress })
})

export default app
