/**
 * 从线上服务器拉取所有 job 数据并同步到本地 SQLite
 *
 * 用法：npx tsx server/scripts/sync-remote-data.ts
 *
 * 功能：
 * 1. 通过线上 API 拉取所有 job 列表
 * 2. 逐个拉取完整批改结果
 * 3. 保存 JSON 到本地 + 写入 SQLite
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb, closeDb } from '../src/lib/database.js'
import { syncJobToDb, ensureStudent } from '../src/lib/db-sync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JOBS_DIR = path.join(__dirname, '../data/jobs')
const IMAGES_DIR = path.join(__dirname, '../data/images')
const REMOTE_API = 'http://43.167.191.81/homework-api'

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`)
  return resp.json()
}

/**
 * 下载远程图片到本地 images 目录。
 */
async function downloadImage(jobId: string): Promise<boolean> {
  const remoteUrl = `${REMOTE_API}/correction/image/${jobId}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const resp = await fetch(remoteUrl, { signal: controller.signal })
    clearTimeout(timer)
    if (!resp.ok) return false
    const contentType = resp.headers.get('content-type') || ''
    const ext = contentType.includes('png') ? 'png' : 'jpg'
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length < 100) return false
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true })
    fs.writeFileSync(path.join(IMAGES_DIR, `${jobId}.${ext}`), buffer)
    return true
  }
  catch {
    return false
  }
}

/**
 * 检查本地是否已有该 job 的图片。
 */
function hasLocalImage(jobId: string): boolean {
  return ['jpg', 'jpeg', 'png', 'bmp'].some(
    ext => fs.existsSync(path.join(IMAGES_DIR, `${jobId}.${ext}`)),
  )
}

async function main() {
  // 初始化数据库
  getDb()

  // 1. 拉取线上 job 列表
  console.log('正在拉取线上 job 列表...')
  const jobsData = await fetchJson(`${REMOTE_API}/jobs`)
  const jobs = Array.isArray(jobsData) ? jobsData : jobsData.jobs || []
  console.log(`线上共 ${jobs.length} 个 job`)

  // 只处理已完成的二上/二下数据
  const targetJobs = jobs.filter((j: any) =>
    j.status === 'done' && ['二上', '二下'].includes(j.semester),
  )
  console.log(`其中二上/二下已完成: ${targetJobs.length} 个`)

  let synced = 0
  let skipped = 0
  let errors = 0

  for (const job of targetJobs) {
    const jobId = job.jobId
    const localPath = path.join(JOBS_DIR, `${jobId}.json`)

    // 检查本地是否已有
    if (fs.existsSync(localPath)) {
      // 本地已有，直接从本地同步到 SQLite
      try {
        const localData = JSON.parse(fs.readFileSync(localPath, 'utf-8'))
        syncJobToDb(jobId, localData)
        // 补下载缺失的图片
        if (!hasLocalImage(jobId)) {
          const imgOk = await downloadImage(jobId)
          if (imgOk) console.log(`  [补图] ${jobId} ✓`)
        }
        skipped++
      } catch (e: any) {
        console.error(`  ✗ 本地同步失败 ${jobId}: ${e.message}`)
        errors++
      }
      continue
    }

    // 从线上拉取完整数据
    try {
      process.stdout.write(`  [${synced + skipped + errors + 1}/${targetJobs.length}] ${job.studentName} ${job.semester} Day${job.day}...`)

      const result = await fetchJson(`${REMOTE_API}/correction/result/${jobId}`)

      // 保存到本地 JSON
      fs.writeFileSync(localPath, JSON.stringify(result, null, 2), 'utf-8')

      // 同步到 SQLite
      syncJobToDb(jobId, result)

      // 下载图片
      if (!hasLocalImage(jobId)) {
        const imgOk = await downloadImage(jobId)
        if (imgOk) process.stdout.write(' +img')
      }

      console.log(' ✓')
      synced++
    } catch (e: any) {
      console.log(` ✗ ${e.message}`)
      errors++
    }
  }

  console.log(`\n=== 同步完成 ===`)
  console.log(`新拉取: ${synced}`)
  console.log(`本地已有: ${skipped}`)
  console.log(`失败: ${errors}`)

  // 输出 SQLite 统计
  const db = getDb()
  const stats = db.prepare(`
    SELECT semester, COUNT(DISTINCT student_id) as students, COUNT(*) as jobs
    FROM jobs
    WHERE semester IN ('二上', '二下')
    GROUP BY semester
  `).all()
  console.log('\nSQLite 数据统计:')
  for (const s of stats as any[]) {
    console.log(`  ${s.semester}: ${s.students} 学生, ${s.jobs} 份作业`)
  }

  // 重新运行 init-demo-data 的归属逻辑
  console.log('\n更新归属关系...')
  const studentSemesters = db.prepare(`
    SELECT DISTINCT s.id as student_id, s.name, j.semester
    FROM jobs j
    JOIN students s ON j.student_id = s.id
    WHERE j.semester IN ('二上', '二下')
      AND s.name NOT LIKE '%测试%'
      AND s.name NOT LIKE '%段喆2%'
      AND s.name NOT LIKE '%段喆3%'
    ORDER BY j.semester, s.name
  `).all() as any[]

  const insertEnrollment = db.prepare(`
    INSERT OR IGNORE INTO enrollments (teacher_id, student_id, term, semester) VALUES (?, ?, ?, ?)
  `)
  const tx = db.transaction(() => {
    for (const { student_id, semester } of studentSemesters) {
      insertEnrollment.run('teacher-ding', student_id, '2026年3月', semester)
    }
  })
  tx()
  console.log(`✓ 更新了 ${studentSemesters.length} 条归属关系`)

  closeDb()
}

main().catch(console.error)
