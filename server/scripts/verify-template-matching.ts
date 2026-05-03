/**
 * 校验标准题模板与作业答案的匹配情况。
 *
 * 用法：
 *   npx tsx scripts/verify-template-matching.ts 二下 13
 *   npx tsx scripts/verify-template-matching.ts 二下 13 --remote
 *
 * 说明：
 * - 默认优先使用本地 SQLite 中已有的 jobs + answers 做校验。
 * - 传入 --remote 时，如果本地没有样本，会尝试从线上 API 拉取对应样本做临时校验。
 * - 匹配锚点使用归一化后的 correct_answer，而不是 answer_index。
 */
import { getDb, closeDb } from '../src/lib/database.js'
import { extractAnswers } from '../src/lib/db-sync.js'

const REMOTE_API = 'http://43.167.191.81/homework-api'

interface TemplateRow {
  id: number
  question_index: number
  parent_title: string
  sub_title: string
  correct_answer: string
}

interface AnswerRow {
  answer_index: string
  correct_answer: string | null
  question_title: string
}

interface JobRow {
  job_id: string
  student_id: string
  student_name: string
  submitted_at: string
}

interface RemoteJobListItem {
  jobId: string
  studentName: string
  semester: string
  day: string | number
  status: string
}

interface TemporaryAnswerRow extends AnswerRow {
  job_id: string
  student_name: string
}

/**
 * 归一化答案文本，用于跨来源匹配。
 */
function normalizeAnswer(answer: string | null | undefined): string {
  if (!answer) return ''

  return String(answer)
    .replace(/\$/g, '')
    .replace(/[ \t\n\r]+/g, '')
    .replace(/[，,].*$/g, '')
    .replace(/○/g, '')
    .replace(/[<>]/g, s => (s === '<' ? '＜' : '＞'))
    .trim()
}

/**
 * 读取指定天的标准题模板。
 */
function loadTemplates(semester: string, day: number): TemplateRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, question_index, parent_title, sub_title, correct_answer
    FROM question_templates
    WHERE semester = ? AND day = ?
    ORDER BY question_index
  `).all(semester, day) as TemplateRow[]
}

/**
 * 读取本地 SQLite 中指定天的作业。
 */
function loadLocalJobs(semester: string, day: number): JobRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT j.job_id, j.student_id, s.name AS student_name, j.submitted_at
    FROM jobs j
    JOIN students s ON s.id = j.student_id
    WHERE j.semester = ? AND j.day = ?
    ORDER BY j.submitted_at DESC
  `).all(semester, day) as JobRow[]
}

/**
 * 读取本地 SQLite 中某份作业的答案。
 */
function loadLocalAnswers(jobId: string): AnswerRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT answer_index, correct_answer, question_title
    FROM answers
    WHERE job_id = ? AND source != 'manual_annotation'
    ORDER BY CAST(REPLACE(answer_index, 'a-', '') AS INTEGER)
  `).all(jobId) as AnswerRow[]
}

/**
 * 拉取远端某一天的作业列表。
 */
async function loadRemoteJobs(semester: string, day: number): Promise<RemoteJobListItem[]> {
  const resp = await fetch(`${REMOTE_API}/jobs`)
  if (!resp.ok) throw new Error(`拉取线上 jobs 失败: HTTP ${resp.status}`)

  const data = await resp.json() as RemoteJobListItem[] | { jobs?: RemoteJobListItem[] }
  const jobs = Array.isArray(data) ? data : (data.jobs || [])

  return jobs.filter(job =>
    job.status === 'done'
    && job.semester === semester
    && Number(job.day) === day,
  )
}

/**
 * 拉取远端作业结果并提取答案。
 */
async function loadRemoteAnswers(jobId: string, studentName: string): Promise<TemporaryAnswerRow[]> {
  const resp = await fetch(`${REMOTE_API}/correction/result/${jobId}`)
  if (!resp.ok) throw new Error(`拉取线上 result 失败: ${jobId}, HTTP ${resp.status}`)

  const data = await resp.json() as {
    markInfos?: any[]
    reviewCorrections?: Record<string, boolean>
    hiddenAnswerIds?: string[]
    manualAnnotations?: Array<{ id: string, positions: number[], isCorrect: boolean }>
  }

  const answers = extractAnswers(
    data.markInfos || [],
    data.reviewCorrections || {},
    data.hiddenAnswerIds || [],
    data.manualAnnotations || [],
  )

  return answers
    .filter(answer => answer.source !== 'manual_annotation')
    .map(answer => ({
      job_id: jobId,
      student_name: studentName,
      answer_index: answer.answer_index,
      correct_answer: answer.correct_answer,
      question_title: answer.question_title,
    }))
}

/**
 * 按归一化答案执行贪心匹配。
 */
function matchAnswers(templates: TemplateRow[], answers: AnswerRow[]) {
  const templatePool = templates.map(template => ({
    ...template,
    normalized_answer: normalizeAnswer(template.correct_answer),
    used: false,
  }))

  const matched: Array<{
    answer_index: string
    answer: string
    template_index: number
    template_answer: string
  }> = []
  const unmatchedAnswers: Array<{ answer_index: string, answer: string, question_title: string }> = []

  for (const answer of answers) {
    const normalizedAnswer = normalizeAnswer(answer.correct_answer)
    if (!normalizedAnswer) {
      unmatchedAnswers.push({
        answer_index: answer.answer_index,
        answer: '',
        question_title: answer.question_title,
      })
      continue
    }

    const exactTemplate = templatePool.find(template => !template.used && template.normalized_answer === normalizedAnswer)
    if (exactTemplate) {
      exactTemplate.used = true
      matched.push({
        answer_index: answer.answer_index,
        answer: normalizedAnswer,
        template_index: exactTemplate.question_index,
        template_answer: exactTemplate.correct_answer,
      })
      continue
    }

    const includeTemplate = templatePool.find(template =>
      !template.used
      && template.normalized_answer
      && (template.normalized_answer.includes(normalizedAnswer) || normalizedAnswer.includes(template.normalized_answer)),
    )

    if (includeTemplate) {
      includeTemplate.used = true
      matched.push({
        answer_index: answer.answer_index,
        answer: normalizedAnswer,
        template_index: includeTemplate.question_index,
        template_answer: includeTemplate.correct_answer,
      })
      continue
    }

    unmatchedAnswers.push({
      answer_index: answer.answer_index,
      answer: normalizedAnswer,
      question_title: answer.question_title,
    })
  }

  const unusedTemplates = templatePool
    .filter(template => !template.used)
    .map(template => ({
      question_index: template.question_index,
      sub_title: template.sub_title,
      correct_answer: template.correct_answer,
    }))

  return {
    matched,
    unmatchedAnswers,
    unusedTemplates,
  }
}

/**
 * 输出单份作业的校验结果。
 */
function printJobReport(label: string, templates: TemplateRow[], answers: AnswerRow[]): void {
  const result = matchAnswers(templates, answers)
  const matchRate = answers.length ? (result.matched.length / answers.length * 100).toFixed(1) : '0.0'

  console.log(`\n=== ${label} ===`)
  console.log(`模板数: ${templates.length}`)
  console.log(`答案数: ${answers.length}`)
  console.log(`匹配数: ${result.matched.length}`)
  console.log(`匹配率: ${matchRate}%`)
  console.log(`未匹配答案数: ${result.unmatchedAnswers.length}`)
  console.log(`未使用模板数: ${result.unusedTemplates.length}`)

  if (result.unmatchedAnswers.length) {
    console.log('未匹配答案:')
    for (const item of result.unmatchedAnswers.slice(0, 10)) {
      console.log(`  - ${item.answer_index} | ${item.question_title} | ${item.answer}`)
    }
  }

  if (result.unusedTemplates.length) {
    console.log('未使用模板:')
    for (const item of result.unusedTemplates.slice(0, 10)) {
      console.log(`  - q${item.question_index} | ${item.sub_title} | ${item.correct_answer}`)
    }
  }
}

/**
 * 主流程。
 */
async function main(): Promise<void> {
  const semester = process.argv[2] || '二下'
  const day = Number(process.argv[3] || '13')
  const useRemote = process.argv.includes('--remote')
  const latestOnly = process.argv.includes('--latest')

  if (!day) {
    console.error('用法: npx tsx scripts/verify-template-matching.ts [semester] [day] [--remote]')
    process.exit(1)
  }

  const templates = loadTemplates(semester, day)
  if (!templates.length) {
    throw new Error(`未找到 question_templates: ${semester} Day${day}`)
  }

  console.log(`开始校验 ${semester} Day${day}`)
  console.log(`标准模板数: ${templates.length}`)

  const localJobs = loadLocalJobs(semester, day)
  if (localJobs.length) {
    const jobsToCheck = latestOnly ? localJobs.slice(0, 1) : localJobs
    console.log(`\n本地样本数: ${localJobs.length}${latestOnly ? '（本次只校验最新 1 份）' : ''}`)
    for (const job of jobsToCheck) {
      const answers = loadLocalAnswers(job.job_id)
      printJobReport(`本地 ${job.student_name} ${job.job_id}`, templates, answers)
    }
    closeDb()
    return
  }

  console.log('\n本地没有该天样本。')

  if (!useRemote) {
    console.log('未启用 --remote，校验结束。')
    closeDb()
    return
  }

  const remoteJobs = await loadRemoteJobs(semester, day)
  console.log(`线上样本数: ${remoteJobs.length}`)

  if (!remoteJobs.length) {
    console.log('线上也没有该天样本，当前只能先保留模板与校验脚本。')
    closeDb()
    return
  }

  for (const job of remoteJobs) {
    const answers = await loadRemoteAnswers(job.jobId, job.studentName)
    printJobReport(`线上 ${job.studentName} ${job.jobId}`, templates, answers)
  }

  closeDb()
}

main().catch(error => {
  console.error(error)
  closeDb()
  process.exit(1)
})
