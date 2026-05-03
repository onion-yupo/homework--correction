/**
 * 初始化脚本：将 15 个辅导老师的飞书 open_id 写入 teachers 表
 *
 * 使用方式：
 *   cd server
 *   npx tsx scripts/init-teacher-feishu.ts
 *
 * 说明：
 *   1. 先运行此脚本查看当前 teachers 列表
 *   2. 在下方 FEISHU_OPEN_IDS 映射中填入真实飞书 open_id
 *   3. 再次运行脚本，写入数据库
 *
 * 如何获取飞书 open_id：
 *   - 老师授权飞书 OAuth 后，系统会在 /api/auth/callback 中打印 open_id
 *   - 或者在飞书开放平台"开发者工具 > API 调试台"中调用 authen/v1/user_info
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env') })

// 动态导入避免循环依赖
const { getDb, closeDb } = await import('../src/lib/database.js')

const db = getDb()

/**
 * ============================================================
 * 在此填写每位老师的飞书 open_id
 *
 * 格式：{ teacherId: 'teacher-xxx', feishuOpenId: 'ou_xxxxxx' }
 *
 * open_id 获取方法：
 *   老师首次飞书登录后，查看后端日志中 [auth] 输出的 openId
 *   或在飞书开放平台 API 调试台调用 authen/v1/user_info
 * ============================================================
 */
const FEISHU_OPEN_IDS: { teacherId: string; feishuOpenId: string }[] = [
  // 示例（请替换为真实 open_id）：
  // { teacherId: 'teacher-ding', feishuOpenId: 'ou_xxxxxxxxxxxxxxxxxxxxxxxx' },
  // { teacherId: 'teacher-b',    feishuOpenId: 'ou_yyyyyyyyyyyyyyyyyyyyyyyy' },
]

// 打印当前所有老师
const teachers = db.prepare('SELECT id, name, feishu_open_id FROM teachers').all() as any[]
console.log('\n当前 teachers 表：')
console.table(teachers.map(t => ({
  id: t.id,
  name: t.name,
  feishu_open_id: t.feishu_open_id || '（未设置）',
})))

if (FEISHU_OPEN_IDS.length === 0) {
  console.log('\n⚠️  FEISHU_OPEN_IDS 为空，请编辑脚本后重新运行。')
  console.log('   操作步骤：')
  console.log('   1. 每位老师打开 /homework/login 页面，完成飞书 OAuth 授权')
  console.log('   2. 授权失败时后端会打印 openId（白名单校验报错前可见）')
  console.log('   3. 或直接在飞书开放平台 API 调试台获取 open_id')
  closeDb()
  process.exit(0)
}

// 批量写入
const stmt = db.prepare('UPDATE teachers SET feishu_open_id = ? WHERE id = ?')
let updated = 0
for (const row of FEISHU_OPEN_IDS) {
  const result = stmt.run(row.feishuOpenId, row.teacherId) as { changes: number }
  if (result.changes > 0) {
    console.log(`✓ ${row.teacherId} → ${row.feishuOpenId}`)
    updated++
  } else {
    console.warn(`✗ ${row.teacherId} 未找到，跳过`)
  }
}

console.log(`\n完成：更新了 ${updated} 条记录`)

// 打印更新后结果
const updatedTeachers = db.prepare('SELECT id, name, feishu_open_id FROM teachers').all() as any[]
console.log('\n更新后 teachers 表：')
console.table(updatedTeachers.map(t => ({
  id: t.id,
  name: t.name,
  feishu_open_id: t.feishu_open_id || '（未设置）',
})))

closeDb()
