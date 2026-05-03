/**
 * db-sync — 从 job JSON 提取结构化数据写入 SQLite
 *
 * 核心职责：
 * 1. 从 markInfos 递归提取所有答案（与前端 useCorrection.ts 的遍历顺序一致）
 * 2. 合并老师复核结果（reviewCorrections, hiddenAnswerIds, manualAnnotations）
 * 3. 确保或创建 student 记录
 * 4. 写入 jobs 表 + answers 表
 * 5. 支持单个 job 同步和全量同步
 */
import { getDb } from './database.js'
import { listJobs } from './storage.js'

// ============================================================
// 类型定义
// ============================================================

interface AnswerInfo {
  HandwriteInfo: string
  HandwriteInfoPositions: number[]
  IsCorrect: boolean
  AnswerAnalysis: string
  KnowledgePoints: string[]
  RightAnswer: string
}

interface MarkInfo {
  MarkItemTitle: string
  MarkInfos: MarkInfo[]
  AnswerInfos: AnswerInfo[]
}

interface ManualAnnotation {
  id: string
  positions: number[]
  isCorrect: boolean
}

interface JobData {
  jobStatus: string
  studentId?: string
  studentName: string
  term?: string
  teacherId?: string
  semester: string
  day: string | number
  savedAt: string
  markInfos: MarkInfo[]
  reviewCorrections?: Record<string, boolean>
  hiddenAnswerIds?: string[]
  manualAnnotations?: ManualAnnotation[]
  reviewed?: boolean
  feedbacked?: boolean
}

interface ExtractedAnswer {
  answer_index: string
  is_correct: number
  is_hidden: number
  source: string
  student_answer: string | null
  correct_answer: string | null
  question_title: string
  knowledge_points: string
  answer_analysis: string | null
  positions: string
}

// ============================================================
// 答案提取（与前端 buildReviewQuestions 遍历顺序一致）
// ============================================================

/**
 * 从 markInfos 递归提取所有答案，生成扁平的 Answer 列表
 * 遍历顺序必须与前端 useCorrection.ts 中的 buildReviewQuestions 完全一致
 */
export function extractAnswers(
  markInfos: MarkInfo[],
  reviewCorrections: Record<string, boolean> = {},
  hiddenAnswerIds: string[] = [],
  manualAnnotations: ManualAnnotation[] = [],
): ExtractedAnswer[] {
  const answers: ExtractedAnswer[] = []
  let answerIndex = 0

  /**
   * 处理单个 AnswerInfo
   */
  function processAnswer(ans: AnswerInfo, parentTitle: string): void {
    const indexKey = `a-${answerIndex}`
    const isOverridden = indexKey in reviewCorrections
    const finalCorrect = isOverridden ? reviewCorrections[indexKey] : ans.IsCorrect

    answers.push({
      answer_index: indexKey,
      is_correct: finalCorrect ? 1 : 0,
      is_hidden: hiddenAnswerIds.includes(indexKey) ? 1 : 0,
      source: isOverridden ? 'teacher_override' : 'ai',
      student_answer: ans.HandwriteInfo || null,
      correct_answer: ans.RightAnswer || null,
      question_title: parentTitle,
      knowledge_points: JSON.stringify(ans.KnowledgePoints || []),
      answer_analysis: ans.AnswerAnalysis || null,
      positions: JSON.stringify(ans.HandwriteInfoPositions || []),
    })
    answerIndex++
  }

  /**
   * 遍历逻辑与前端 buildReviewQuestions 一致：
   * - 顶层 markInfos 遍历
   *   - 先处理 item.AnswerInfos（directAnswers）
   *   - 再遍历 item.MarkInfos（subQuestions）
   *     - 处理 sub.AnswerInfos
   *     - 再遍历 sub.MarkInfos（subsub）
   *       - 处理 subsub.AnswerInfos
   */
  for (const item of markInfos) {
    const topTitle = item.MarkItemTitle || ''

    // 顶层直接答案
    if (item.AnswerInfos?.length) {
      for (const a of item.AnswerInfos) {
        processAnswer(a, topTitle)
      }
    }

    // 子题
    if (item.MarkInfos?.length) {
      for (const sub of item.MarkInfos) {
        const subOwnTitle = sub.MarkItemTitle || ''
        const subTitle = subOwnTitle && topTitle && subOwnTitle !== topTitle
          ? `${topTitle}\n${subOwnTitle}`
          : subOwnTitle || topTitle

        if (sub.AnswerInfos?.length) {
          for (const a of sub.AnswerInfos) {
            processAnswer(a, subTitle)
          }
        }

        // 子子题
        if (sub.MarkInfos?.length) {
          for (const subsub of sub.MarkInfos) {
            if (subsub.AnswerInfos?.length) {
              const subsubOwn = subsub.MarkItemTitle || ''
              const subsubTitle = subsubOwn && subsubOwn !== subTitle
                ? `${subTitle}\n${subsubOwn}`
                : subsubOwn || subTitle
              for (const a of subsub.AnswerInfos) {
                processAnswer(a, subsubTitle)
              }
            }
          }
        }
      }
    }
  }

  // 追加人工标注
  for (const ma of manualAnnotations || []) {
    answers.push({
      answer_index: ma.id,
      is_correct: ma.isCorrect ? 1 : 0,
      is_hidden: 0,
      source: 'manual_annotation',
      student_answer: null,
      correct_answer: null,
      question_title: '人工标注',
      knowledge_points: '[]',
      answer_analysis: null,
      positions: JSON.stringify(ma.positions || []),
    })
  }

  return answers
}

// ============================================================
// 学生管理（确保存在）
// ============================================================

/**
 * 确保学生记录存在，返回 student_id
 * 当前用姓名做唯一标识，id 格式为 "student-{name}"
 */
export function ensureStudent(name: string): string {
  const db = getDb()
  name = name.trim()
  const id = `student-${name}`

  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(id)
  if (!existing) {
    db.prepare('INSERT INTO students (id, name) VALUES (?, ?)').run(id, name)
  }

  return id
}

/**
 * 根据老师姓名确保 teacher 记录存在，返回 teacher_id
 * id 格式为 "teacher-{name}"
 */
export function ensureTeacher(name: string): string {
  const db = getDb()
  name = name.trim()
  const id = `teacher-${name}`

  const existing = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)
  if (!existing) {
    db.prepare('INSERT INTO teachers (id, name) VALUES (?, ?)').run(id, name)
  }

  return id
}

function resolveStudentId(jobData: JobData, teacherId: string, term: string): string {
  const db = getDb()
  if (jobData.studentId) {
    const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(jobData.studentId)
    if (existing) return jobData.studentId
  }

  const enrolled = db.prepare(`
    SELECT s.id
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.teacher_id = ? AND e.term = ? AND s.name = ?
    ORDER BY e.id DESC
    LIMIT 1
  `).get(teacherId, term, jobData.studentName.trim()) as { id: string } | undefined

  if (enrolled?.id) return enrolled.id
  return ensureStudent(jobData.studentName)
}

// ============================================================
// 单个 Job 同步
// ============================================================

/**
 * 将单个 job 的数据同步到 SQLite
 * 幂等操作：如果 job 已存在则更新，不存在则插入
 */
export function syncJobToDb(jobId: string, jobData: JobData): void {
  const db = getDb()

  if (jobData.jobStatus !== 'DONE') return
  if (!jobData.studentName || !jobData.semester) return

  const day = parseInt(String(jobData.day), 10)
  if (isNaN(day)) return

  // 提取答案
  const answers = extractAnswers(
    jobData.markInfos || [],
    jobData.reviewCorrections || {},
    jobData.hiddenAnswerIds || [],
    jobData.manualAnnotations || [],
  )

  // 计算统计（排除人工标注中隐藏的，与前端逻辑一致）
  const visibleAnswers = answers.filter(a => !a.is_hidden)
  const totalQuestions = visibleAnswers.length
  const correctCount = visibleAnswers.filter(a => a.is_correct === 1).length
  const errorCount = totalQuestions - correctCount
  const accuracy = totalQuestions > 0 ? correctCount / totalQuestions : 0

  // 工作流状态
  const reviewStatus = jobData.reviewed ? 'reviewed' : 'pending'
  const feedbackStatus = jobData.feedbacked ? 'sent' : 'pending'

  const term = jobData.term || '2026年4月'
  const teacherId = jobData.teacherId || 'teacher-欣欣老师'
  const studentId = resolveStudentId(jobData, teacherId, term)
  const scope = db.prepare(`
    SELECT camp_id, cohort_id
    FROM enrollments
    WHERE teacher_id = ? AND student_id = ? AND term = ? AND semester = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(teacherId, studentId, term, jobData.semester) as { camp_id: string; cohort_id: string } | undefined
  const cohort = scope || db.prepare(`
    SELECT camp_id, id AS cohort_id FROM cohorts
    WHERE term = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(term) as { camp_id: string; cohort_id: string } | undefined
  const campId = cohort?.camp_id || 'camp-calculation'
  const cohortId = cohort?.cohort_id || 'cohort-calculation-2026-03'

  // 使用事务保证原子性
  const syncTransaction = db.transaction(() => {
    // upsert job
    db.prepare(`
      INSERT INTO jobs (job_id, student_id, teacher_id, camp_id, cohort_id, term, semester, day, submitted_at,
                        total_questions, correct_count, error_count, accuracy,
                        review_status, feedback_status, raw_json_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        teacher_id = excluded.teacher_id,
        camp_id = excluded.camp_id,
        cohort_id = excluded.cohort_id,
        total_questions = excluded.total_questions,
        correct_count = excluded.correct_count,
        error_count = excluded.error_count,
        accuracy = excluded.accuracy,
        updated_at = excluded.submitted_at
    `).run(
      jobId, studentId, teacherId, campId, cohortId, term, jobData.semester, day,
      jobData.savedAt || new Date().toISOString(),
      totalQuestions, correctCount, errorCount, accuracy,
      reviewStatus, feedbackStatus,
      `jobs/${jobId}.json`,
    )

    // 确保 enrollment 记录存在（新学生/新期自动创建归属关系）
    db.prepare(`
      INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, semester, term)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(teacherId, studentId, campId, cohortId, jobData.semester, term)

    // 删除旧答案后重新插入（简单可靠）
    db.prepare('DELETE FROM answers WHERE job_id = ?').run(jobId)

    const insertAnswer = db.prepare(`
      INSERT INTO answers (job_id, answer_index, is_correct, is_hidden, source,
                           student_answer, correct_answer, question_title,
                           knowledge_points, answer_analysis, positions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const a of answers) {
      insertAnswer.run(
        jobId, a.answer_index, a.is_correct, a.is_hidden, a.source,
        a.student_answer, a.correct_answer, a.question_title,
        a.knowledge_points, a.answer_analysis, a.positions,
      )
    }
  })

  syncTransaction()
}

// ============================================================
// 部分更新（老师操作时调用，避免全量重写）
// ============================================================

/**
 * 更新 job 的工作流状态（核对/反馈标记）
 */
export function updateJobFlags(jobId: string, reviewed?: boolean, feedbacked?: boolean): void {
  const db = getDb()
  if (reviewed !== undefined) {
    db.prepare('UPDATE jobs SET review_status = ?, updated_at = datetime(?) WHERE job_id = ?')
      .run(reviewed ? 'reviewed' : 'pending', new Date().toISOString(), jobId)
  }
  if (feedbacked !== undefined) {
    db.prepare('UPDATE jobs SET feedback_status = ?, updated_at = datetime(?) WHERE job_id = ?')
      .run(feedbacked ? 'sent' : 'pending', new Date().toISOString(), jobId)
  }
}

/**
 * 更新 job 的反馈内容
 */
export function updateJobFeedback(jobId: string, content: string): void {
  const db = getDb()
  db.prepare('UPDATE jobs SET feedback_content = ?, updated_at = datetime(?) WHERE job_id = ?')
    .run(content, new Date().toISOString(), jobId)
}

/**
 * 更新单个答案的判定结果
 */
export function updateAnswerCorrectness(jobId: string, answerIndex: string, isCorrect: boolean): void {
  const db = getDb()
  db.prepare(`
    UPDATE answers SET is_correct = ?, source = 'teacher_override'
    WHERE job_id = ? AND answer_index = ?
  `).run(isCorrect ? 1 : 0, jobId, answerIndex)

  // 重新计算 job 统计
  recalculateJobStats(jobId)
}

/**
 * 更新答案的隐藏状态
 */
export function updateAnswerHidden(jobId: string, answerIndex: string, isHidden: boolean): void {
  const db = getDb()
  db.prepare('UPDATE answers SET is_hidden = ? WHERE job_id = ? AND answer_index = ?')
    .run(isHidden ? 1 : 0, jobId, answerIndex)

  recalculateJobStats(jobId)
}

/**
 * 重新计算 job 的统计数据
 */
function recalculateJobStats(jobId: string): void {
  const db = getDb()
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct,
      SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as errors
    FROM answers
    WHERE job_id = ? AND is_hidden = 0
  `).get(jobId) as any

  if (stats) {
    const accuracy = stats.total > 0 ? stats.correct / stats.total : 0
    db.prepare(`
      UPDATE jobs SET total_questions = ?, correct_count = ?, error_count = ?, accuracy = ?, updated_at = datetime('now')
      WHERE job_id = ?
    `).run(stats.total, stats.correct, stats.errors, accuracy, jobId)
  }
}

// ============================================================
// 全量同步（从文件系统同步所有 job 到 SQLite）
// ============================================================

/**
 * 将文件系统中所有已完成的 job 同步到 SQLite
 * 用于初始化或数据修复
 */
export function syncAllJobsToDb(): { synced: number; skipped: number; errors: string[] } {
  const jobs = listJobs()
  let synced = 0
  let skipped = 0
  const errors: string[] = []

  for (const job of jobs) {
    try {
      const jobId = job.jobId as string
      if (!jobId) { skipped++; continue }

      if (job.jobStatus !== 'DONE') {
        skipped++
        continue
      }

      syncJobToDb(jobId, job as unknown as JobData)
      synced++
    } catch (err: any) {
      const jobId = (job as any).jobId || 'unknown'
      errors.push(`${jobId}: ${err.message}`)
    }
  }

  return { synced, skipped, errors }
}
