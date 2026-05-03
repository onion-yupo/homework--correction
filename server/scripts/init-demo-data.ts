/**
 * 初始化 demo 数据
 *
 * 用法：npx tsx server/scripts/init-demo-data.ts
 *
 * 功能：
 * 1. 创建 demo 老师
 * 2. 从已有 jobs 数据中提取所有学生，自动创建归属关系
 * 3. 输出初始化报告
 */
import { getDb, closeDb } from '../src/lib/database.js'

const db = getDb()

// ============================================================
// 1. 创建 demo 老师
// ============================================================

const teachers = [
  { id: 'teacher-欣欣老师', name: '欣欣老师' },
]

for (const t of teachers) {
  db.prepare('INSERT OR IGNORE INTO teachers (id, name) VALUES (?, ?)').run(t.id, t.name)
}
console.log(`✓ 创建了 ${teachers.length} 位老师`)

// ============================================================
// 2. 从 jobs 表提取所有学生 × 学期组合，创建归属关系
// ============================================================

// 获取所有有效的学生 × 学期组合（排除测试数据）
const studentSemesters = db.prepare(`
  SELECT DISTINCT s.id as student_id, s.name, j.semester
  FROM jobs j
  JOIN students s ON j.student_id = s.id
  WHERE j.semester IN ('二上', '二下')
    AND s.name NOT IN ('联调测试', '吉吉', '段喆2', '段喆3')
  ORDER BY j.semester, s.name
`).all() as any[]

console.log(`\n找到 ${studentSemesters.length} 个学生×学期组合:`)

// 默认全部归属给丁老师
const defaultTeacher = 'teacher-欣欣老师'
const insertEnrollment = db.prepare(`
  INSERT OR IGNORE INTO enrollments (teacher_id, student_id, term, semester)
  VALUES (?, ?, ?, ?)
`)

const enrollTransaction = db.transaction(() => {
  for (const { student_id, name, semester } of studentSemesters) {
    insertEnrollment.run(defaultTeacher, student_id, '2026年3月', semester)
    console.log(`  ${name} → 2026年3月 · ${semester} → 欣欣老师`)
  }
})

enrollTransaction()
console.log(`\n✓ 创建了 ${studentSemesters.length} 条归属关系`)

// ============================================================
// 3. 输出报告
// ============================================================

console.log('\n=== 初始化报告 ===')

const teacherCount = db.prepare('SELECT COUNT(*) as cnt FROM teachers').get() as any
const studentCount = db.prepare('SELECT COUNT(*) as cnt FROM students').get() as any
const enrollmentCount = db.prepare('SELECT COUNT(*) as cnt FROM enrollments').get() as any
const jobCount = db.prepare('SELECT COUNT(*) as cnt FROM jobs').get() as any
const answerCount = db.prepare('SELECT COUNT(*) as cnt FROM answers').get() as any

console.log(`老师: ${teacherCount.cnt}`)
console.log(`学生: ${studentCount.cnt}`)
console.log(`归属关系: ${enrollmentCount.cnt}`)
console.log(`作业: ${jobCount.cnt}`)
console.log(`答案: ${answerCount.cnt}`)

// 按老师 × 学期统计
const enrollmentStats = db.prepare(`
  SELECT t.name as teacher_name, e.semester, COUNT(*) as student_count
  FROM enrollments e
  JOIN teachers t ON e.teacher_id = t.id
  GROUP BY t.name, e.semester
  ORDER BY t.name, e.semester
`).all() as any[]

console.log('\n按老师×学期:')
for (const s of enrollmentStats) {
  console.log(`  ${s.teacher_name} · ${s.semester}: ${s.student_count} 人`)
}

closeDb()
