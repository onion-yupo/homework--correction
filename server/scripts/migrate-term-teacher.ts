/**
 * 数据清洗脚本：补全 term（班课月份）和 teacher_id（负责老师）
 *
 * 用法：cd server && npx tsx scripts/migrate-term-teacher.ts
 *
 * 规则：
 * - job_id < '1434123067537629184' → term = '2026年3月'
 * - job_id >= '1434123067537629184' → term = '2026年4月'
 * - 所有数据的 teacher_id 统一设为 'teacher-欣欣老师'
 * - 清理其他老师记录
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb, closeDb } from '../src/lib/database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BOUNDARY_JOB_ID = '1434123067537629184'
const TEACHER_ID = 'teacher-欣欣老师'
const TEACHER_NAME = '欣欣老师'

const db = getDb()

console.log('=== 开始数据清洗 ===\n')

// ============================================================
// 1. 确保欣欣老师记录存在
// ============================================================
db.prepare('INSERT OR IGNORE INTO teachers (id, name) VALUES (?, ?)').run(TEACHER_ID, TEACHER_NAME)
console.log(`✓ 确保老师记录: ${TEACHER_ID} (${TEACHER_NAME})`)

// ============================================================
// 2. 清洗 jobs 表的 term 字段
// ============================================================
const updateTermMarch = db.prepare(`UPDATE jobs SET term = '2026年3月' WHERE job_id < ?`)
const updateTermApril = db.prepare(`UPDATE jobs SET term = '2026年4月' WHERE job_id >= ?`)

const marchResult = updateTermMarch.run(BOUNDARY_JOB_ID)
const aprilResult = updateTermApril.run(BOUNDARY_JOB_ID)
console.log(`✓ term 清洗: ${marchResult.changes} 条 → 2026年3月, ${aprilResult.changes} 条 → 2026年4月`)

// ============================================================
// 3. 所有 jobs 的 teacher_id 设为欣欣老师
// ============================================================
const updateTeacher = db.prepare(`UPDATE jobs SET teacher_id = ?`)
const teacherResult = updateTeacher.run(TEACHER_ID)
console.log(`✓ teacher_id 清洗: ${teacherResult.changes} 条 → ${TEACHER_ID}`)

// ============================================================
// 4. 清理 enrollments 表 + 补全缺失的 term 归属
// ============================================================
const updateEnrollments = db.prepare(`UPDATE enrollments SET teacher_id = ?`)
const enrollResult = updateEnrollments.run(TEACHER_ID)
console.log(`✓ enrollments 清洗: ${enrollResult.changes} 条 → ${TEACHER_ID}`)

const insertMissing = db.prepare(`
  INSERT OR IGNORE INTO enrollments (teacher_id, student_id, semester, term)
  SELECT DISTINCT ?, student_id, semester, term FROM jobs
`)
const insertResult = insertMissing.run(TEACHER_ID)
console.log(`✓ enrollments 补全: ${insertResult.changes} 条新增（从 jobs 表同步）`)

// ============================================================
// 5. 删除非欣欣老师的 teachers 记录
// ============================================================
const deleteOthers = db.prepare(`DELETE FROM teachers WHERE id != ?`)
const deleteResult = deleteOthers.run(TEACHER_ID)
console.log(`✓ 删除其他老师: ${deleteResult.changes} 条`)

// ============================================================
// 6. 遍历 JSON 文件，补写 term 和 teacherId
// ============================================================
const JOBS_DIR = path.resolve(__dirname, '../data/jobs')

if (fs.existsSync(JOBS_DIR)) {
  const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'))
  let updated = 0

  for (const file of files) {
    const filePath = path.join(JOBS_DIR, file)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw)
      let changed = false

      const jobId = data.jobId || file.replace('.json', '')

      if (!data.term) {
        data.term = jobId >= BOUNDARY_JOB_ID ? '2026年4月' : '2026年3月'
        changed = true
      }

      if (!data.teacherId) {
        data.teacherId = TEACHER_ID
        changed = true
      }

      if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
        updated++
      }
    } catch (e: any) {
      console.error(`  ✗ ${file}: ${e.message}`)
    }
  }

  console.log(`✓ JSON 文件补写: ${updated}/${files.length} 个文件已更新`)
} else {
  console.log(`⚠ data/jobs/ 目录不存在，跳过 JSON 文件清洗`)
}

// ============================================================
// 7. 输出清洗报告
// ============================================================
console.log('\n=== 清洗报告 ===')

const teacherCount = db.prepare('SELECT COUNT(*) as cnt FROM teachers').get() as any
const jobCount = db.prepare('SELECT COUNT(*) as cnt FROM jobs').get() as any
const marchCount = db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE term = '2026年3月'").get() as any
const aprilCount = db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE term = '2026年4月'").get() as any
const withTeacher = db.prepare('SELECT COUNT(*) as cnt FROM jobs WHERE teacher_id IS NOT NULL').get() as any

console.log(`老师数: ${teacherCount.cnt}`)
console.log(`作业总数: ${jobCount.cnt}`)
console.log(`  2026年3月: ${marchCount.cnt}`)
console.log(`  2026年4月: ${aprilCount.cnt}`)
console.log(`  有 teacher_id: ${withTeacher.cnt}`)

const teachers = db.prepare('SELECT id, name FROM teachers').all() as any[]
console.log(`\n老师列表:`)
for (const t of teachers) {
  console.log(`  ${t.id} → ${t.name}`)
}

closeDb()
console.log('\n=== 清洗完成 ===')

