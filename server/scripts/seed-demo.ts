/**
 * Demo 数据种子脚本
 * 用法：cd server && npx tsx scripts/seed-demo.ts
 *
 * 创建：3 位老师 + 12 位学生 + 归属关系 + 学生档案 + 模拟作业记录 + 答题详情
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env') })

const { getDb, closeDb } = await import('../src/lib/database.js')
const db = getDb()
const CAMP_ID = 'camp-calculation'
const COHORT_ID = 'cohort-calculation-2026-03'
const APP_CAMP_ID = 'camp-word-problem'
const APP_COHORT_ID = 'cohort-word-problem-2026-04'
const APP_TERM = '2026年4月'
const APP_DEMO_STUDENT_IDS = new Set(['student-lihua', 'student-wangfang', 'student-zhaolei'])

// ============================================================
// 1. 老师（含 mock feishu_open_id，方便测试）
// ============================================================
const TEACHERS = [
  { id: 'teacher-xinxin', name: '欣欣老师', feishu_open_id: 'ou_demo_xinxin_001' },
  { id: 'teacher-meimei', name: '美美老师', feishu_open_id: 'ou_demo_meimei_002' },
  { id: 'teacher-lili',   name: '丽丽老师', feishu_open_id: 'ou_demo_lili_003' },
]

for (const t of TEACHERS) {
  db.prepare(`
    INSERT OR IGNORE INTO teachers (id, name, role, feishu_open_id) VALUES (?, ?, 'tutor', ?)
  `).run(t.id, t.name, t.feishu_open_id)
}
console.log(`✓ 老师：${TEACHERS.map(t => t.name).join('、')}`)

// ============================================================
// 2. 学生（12 位，分布在不同学期）
// ============================================================
const TERM = '2026年3月'

const STUDENTS = [
  // 欣欣老师 · 二下
  { id: 'student-lihua',   name: '李华',   teacher: 'teacher-xinxin', semester: '二下' },
  { id: 'student-wangfang', name: '王芳',  teacher: 'teacher-xinxin', semester: '二下' },
  { id: 'student-zhaolei', name: '赵磊',   teacher: 'teacher-xinxin', semester: '二下' },
  { id: 'student-chenyue', name: '陈月',   teacher: 'teacher-xinxin', semester: '二下' },
  // 欣欣老师 · 三上
  { id: 'student-sunyan',  name: '孙燕',   teacher: 'teacher-xinxin', semester: '三上' },
  // 美美老师 · 二下
  { id: 'student-zhoujie', name: '周杰',   teacher: 'teacher-meimei', semester: '二下' },
  { id: 'student-wulin',   name: '吴琳',   teacher: 'teacher-meimei', semester: '二下' },
  { id: 'student-chenwei', name: '陈威',   teacher: 'teacher-meimei', semester: '二下' },
  // 美美老师 · 三上
  { id: 'student-liuyang', name: '刘洋',   teacher: 'teacher-meimei', semester: '三上' },
  // 丽丽老师 · 三上
  { id: 'student-tangna',  name: '唐娜',   teacher: 'teacher-lili',   semester: '三上' },
  { id: 'student-mawei',   name: '马威',   teacher: 'teacher-lili',   semester: '三上' },
  { id: 'student-hexiao',  name: '贺晓',   teacher: 'teacher-lili',   semester: '三上' },
]

for (const s of STUDENTS) {
  db.prepare('INSERT OR IGNORE INTO students (id, name) VALUES (?, ?)').run(s.id, s.name)
  db.prepare(`
    INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, term, semester)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(s.teacher, s.id, CAMP_ID, COHORT_ID, TERM, s.semester)
  if (s.teacher === 'teacher-xinxin' && APP_DEMO_STUDENT_IDS.has(s.id)) {
    db.prepare(`
      INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, term, semester)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(s.teacher, s.id, APP_CAMP_ID, APP_COHORT_ID, APP_TERM, s.semester)
  }
}
console.log(`✓ 学生：${STUDENTS.length} 位`)

// ============================================================
// 3. 学生档案（student_profiles）
// ============================================================
const PROFILES = [
  { student_id: 'student-lihua',    term: TERM, parent_name: '李爸爸', self_level: '良好',   weak_points: '分数计算、进退位减法', parent_concern: '做题速度太慢' },
  { student_id: 'student-wangfang', term: TERM, parent_name: '王妈妈', self_level: '优秀',   weak_points: '应用题审题', parent_concern: '希望养成检查习惯' },
  { student_id: 'student-zhaolei',  term: TERM, parent_name: '赵妈妈', self_level: '一般',   weak_points: '乘法口诀不熟练', parent_concern: '学习态度需要改善' },
  { student_id: 'student-chenyue', term: TERM, parent_name: '陈爸爸',  self_level: '良好',   weak_points: '几何图形', parent_concern: '数学思维训练' },
  { student_id: 'student-sunyan',  term: TERM, parent_name: '孙妈妈',  self_level: '较弱',   weak_points: '基本运算都不稳定', parent_concern: '希望提升基础' },
  { student_id: 'student-zhoujie', term: TERM, parent_name: '周爸爸',  self_level: '良好',   weak_points: '小数乘除', parent_concern: '提升计算准确率' },
  { student_id: 'student-wulin',   term: TERM, parent_name: '吴妈妈',  self_level: '优秀',   weak_points: '暂无明显薄弱', parent_concern: '希望适当拔高' },
  { student_id: 'student-liuyang', term: TERM, parent_name: '刘妈妈',  self_level: '一般',   weak_points: '方程解法', parent_concern: '逻辑思维' },
]

for (const p of PROFILES) {
  db.prepare(`
    INSERT OR IGNORE INTO student_profiles (student_id, camp_id, cohort_id, term, parent_name, self_level, weak_points, parent_concern)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.student_id, CAMP_ID, COHORT_ID, p.term, p.parent_name, p.self_level, p.weak_points, p.parent_concern)
  if (APP_DEMO_STUDENT_IDS.has(p.student_id)) {
    db.prepare(`
      INSERT OR IGNORE INTO student_profiles (student_id, camp_id, cohort_id, term, parent_name, self_level, weak_points, parent_concern, extra_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.student_id, APP_CAMP_ID, APP_COHORT_ID, APP_TERM, p.parent_name, p.self_level, p.weak_points, p.parent_concern, '应用题营 demo，暂复用计算营学生档案')
  }
}
console.log(`✓ 学生档案：${PROFILES.length} 份`)

// ============================================================
// 4. 模拟作业记录（jobs + answers）
// ============================================================
// 为前 5 位学生创建 Day 1-5 的作业，模拟不同完成度
function rnd(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const KNOWLEDGE_POINTS = ['进位加法', '退位减法', '乘法口诀', '分数化简', '应用题', '几何图形']
const ERROR_CAUSES = ['粗心计算错误', '概念理解偏差', '审题不仔细', '公式记忆错误']

const insertJob = db.prepare(`
  INSERT OR IGNORE INTO jobs
    (job_id, student_id, teacher_id, camp_id, cohort_id, term, semester, day, submitted_at,
     total_questions, correct_count, error_count, accuracy,
     review_status, feedback_status, feedback_content, image_path, created_at, updated_at)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertAnswer = db.prepare(`
  INSERT OR IGNORE INTO answers
    (job_id, answer_index, is_correct, source, student_answer, correct_answer,
     question_title, knowledge_points, answer_analysis)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

// 前 4 位学生（欣欣老师·二下）创建 day 1-7 作业
const DEMO_STUDENTS = STUDENTS.slice(0, 4)
let jobCount = 0
let answerCount = 0

for (const s of DEMO_STUDENTS) {
  const totalDays = s.id === 'student-lihua' ? 7 : s.id === 'student-wangfang' ? 5 : 3
  for (let day = 1; day <= totalDays; day++) {
    const totalQ = rnd(8, 12)
    const correctCount = rnd(Math.floor(totalQ * 0.5), totalQ)
    const errorCount = totalQ - correctCount
    const accuracy = correctCount / totalQ
    const submittedAt = new Date(Date.now() - (8 - day) * 24 * 3600 * 1000).toISOString()
    const jobId = `demo_${s.id}_day${day}_${crypto.randomBytes(3).toString('hex')}`
    const appJobId = APP_DEMO_STUDENT_IDS.has(s.id) && day <= 3 ? `app_${jobId}` : ''
    const reviewStatus = day <= 5 ? 'reviewed' : 'pending'
    const feedbackStatus = day <= 3 ? 'sent' : 'pending'
    const feedbackContent = feedbackStatus === 'sent'
      ? `### 整体评价\n今天表现${accuracy > 0.8 ? '不错' : '有进步空间'}，正确率 ${Math.round(accuracy * 100)}%。\n\n### 作业分析\n共 ${totalQ} 道题，对 ${correctCount} 题，错 ${errorCount} 题。\n\n### 家长反馈话术\n宝贝今天完成了数学作业，继续加油！`
      : null

    insertJob.run(
      jobId, s.id, s.teacher, CAMP_ID, COHORT_ID, TERM, s.semester, day, submittedAt,
      totalQ, correctCount, errorCount, accuracy,
      reviewStatus, feedbackStatus, feedbackContent,
      null, submittedAt, submittedAt
    )
    jobCount++
    if (appJobId) {
      insertJob.run(
        appJobId, s.id, s.teacher, APP_CAMP_ID, APP_COHORT_ID, APP_TERM, s.semester, day, submittedAt,
        totalQ, correctCount, errorCount, accuracy,
        reviewStatus, feedbackStatus, feedbackContent,
        null, submittedAt, submittedAt
      )
      jobCount++
    }

    // 答题详情
    for (let qi = 1; qi <= totalQ; qi++) {
      const isCorrect = qi <= correctCount ? 1 : 0
      const kp = KNOWLEDGE_POINTS[rnd(0, KNOWLEDGE_POINTS.length - 1)]
      const analysis = isCorrect ? '' : ERROR_CAUSES[rnd(0, ERROR_CAUSES.length - 1)]
      insertAnswer.run(
        jobId, String(qi), isCorrect, 'ai',
        isCorrect ? '√' : String(rnd(1, 20)),
        String(rnd(1, 20)),
        `第${qi}题`,
        kp,
        analysis
      )
      answerCount++
      if (appJobId) {
        insertAnswer.run(
          appJobId, String(qi), isCorrect, 'ai',
          isCorrect ? '√' : String(rnd(1, 20)),
          String(rnd(1, 20)),
          `第${qi}题`,
          kp,
          analysis
        )
        answerCount++
      }
    }
  }
}

console.log(`✓ 作业记录：${jobCount} 条，答题详情：${answerCount} 条`)

// ============================================================
// 5. 汇总报告
// ============================================================
console.log('\n========= Demo 数据初始化完成 =========')
const summary = {
  teachers: db.prepare('SELECT COUNT(*) as c FROM teachers').get() as any,
  students: db.prepare('SELECT COUNT(*) as c FROM students').get() as any,
  enrollments: db.prepare('SELECT COUNT(*) as c FROM enrollments').get() as any,
  student_profiles: db.prepare('SELECT COUNT(*) as c FROM student_profiles').get() as any,
  jobs: db.prepare('SELECT COUNT(*) as c FROM jobs').get() as any,
  answers: db.prepare('SELECT COUNT(*) as c FROM answers').get() as any,
}
console.table({
  老师: summary.teachers.c,
  学生: summary.students.c,
  归属关系: summary.enrollments.c,
  学生档案: summary.student_profiles.c,
  作业记录: summary.jobs.c,
  答题详情: summary.answers.c,
})

// 6. 输出用于测试的 token（需要 TOKEN_SECRET）
if (process.env.TOKEN_SECRET) {
  const { makeSubmitToken, makeEnrollToken } = await import('../src/lib/submit-token.js')
  const submitToken = makeSubmitToken('student-lihua', 'teacher-xinxin', TERM)
  const enrollToken = makeEnrollToken('teacher-xinxin', TERM)
  console.log('\n========= 测试链接 =========')
  console.log(`收作业表单（李华）：/homework/submit/${submitToken}`)
  console.log(`入营问卷（欣欣老师）：/homework/enroll/${enrollToken}`)
} else {
  console.log('\n⚠️  未设置 TOKEN_SECRET，跳过测试链接生成')
}

closeDb()
