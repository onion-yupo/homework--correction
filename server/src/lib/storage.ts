import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { downloadImageObject, objectStorageEnabled, uploadImageObject } from './object-storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../data/jobs')

/**
 * 将"二年级上"等旧格式统一为"二上"简写
 * 已经是简写的直接返回
 */
export function normalizeSemester(raw: string): string {
  return raw.replace(/^([一二三四五六])年级(上|下)$/, '$1$2')
}

/** 确保存储目录存在 */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/**
 * 存储批改结果
 * @param jobId 腾讯云返回的任务 ID
 * @param data 完整的批改结果数据
 */
export function saveJob(jobId: string, data: Record<string, unknown>) {
  ensureDir()
  const filePath = path.join(DATA_DIR, `${jobId}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * 读取批改结果
 * @returns null 表示不存在
 */
export function loadJob(jobId: string): Record<string, unknown> | null {
  const filePath = path.join(DATA_DIR, `${jobId}.json`)
  if (!fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw)
}

/**
 * 存储下载的图片文件
 * @returns 本地文件路径
 */
export function saveImage(jobId: string, buffer: Buffer, ext: string): string {
  ensureDir()
  const imagesDir = path.resolve(__dirname, '../../data/images')
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }
  const filePath = path.join(imagesDir, `${jobId}.${ext}`)
  fs.writeFileSync(filePath, buffer)

  if (objectStorageEnabled()) {
    uploadImageObject(jobId, buffer, ext)
      .then((url) => {
        if (url) console.log(`[ObjectStorage] 图片已上传: ${jobId}.${ext} -> ${url}`)
      })
      .catch((err) => {
        console.error(`[ObjectStorage] 图片上传失败: ${jobId}.${ext}`, err)
      })
  }

  return filePath
}

/**
 * 读取图片文件
 * @returns null 表示不存在
 */
export function loadImage(jobId: string): { buffer: Buffer, ext: string } | null {
  const imagesDir = path.resolve(__dirname, '../../data/images')
  for (const ext of ['jpg', 'jpeg', 'png', 'bmp']) {
    const filePath = path.join(imagesDir, `${jobId}.${ext}`)
    if (fs.existsSync(filePath)) {
      return { buffer: fs.readFileSync(filePath), ext }
    }
  }
  return null
}

/** 优先读取本地图片；本地缺失时从对象存储回源并写回本地缓存 */
export async function loadImageAsync(jobId: string): Promise<{ buffer: Buffer, ext: string } | null> {
  const local = loadImage(jobId)
  if (local) return local

  if (!objectStorageEnabled()) return null

  for (const ext of ['jpg', 'jpeg', 'png', 'bmp']) {
    const buffer = await downloadImageObject(jobId, ext)
    if (buffer) {
      saveImage(jobId, buffer, ext)
      return { buffer, ext }
    }
  }

  return null
}

/** 读取图片文件并返回 base64 */
export function loadImageBase64(jobId: string): { base64: string, ext: string } | null {
  const img = loadImage(jobId)
  if (!img) return null
  return { base64: img.buffer.toString('base64'), ext: img.ext }
}

/** 读取图片并返回 base64；支持从对象存储回源 */
export async function loadImageBase64Async(jobId: string): Promise<{ base64: string, ext: string } | null> {
  const img = await loadImageAsync(jobId)
  if (!img) return null
  return { base64: img.buffer.toString('base64'), ext: img.ext }
}

/**
 * 加载图片并压缩后返回 base64（用于发给 LLM 多模态输入）
 * 长边限制 1200px，JPEG quality 70，大幅减少 token 消耗和响应时间
 */
export async function loadImageBase64Compressed(jobId: string): Promise<{ base64: string, ext: string } | null> {
  const img = await loadImageAsync(jobId)
  if (!img) return null

  try {
    const compressed = await sharp(img.buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer()
    console.log(`[ImageCompress] LLM 用图压缩: ${(img.buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB`)
    return { base64: compressed.toString('base64'), ext: 'jpg' }
  } catch (e) {
    console.warn(`[ImageCompress] 压缩失败，使用原图:`, e)
    return { base64: img.buffer.toString('base64'), ext: img.ext }
  }
}

/**
 * 消除图片 EXIF 旋转信息，输出正向 JPEG
 * 用于后端接收的图片（飞书/外部 URL），等效于前端 Canvas 重绘
 */
export async function normalizeImageRotation(buffer: Buffer): Promise<{ buffer: Buffer, ext: string }> {
  try {
    const result = await sharp(buffer).rotate().jpeg({ quality: 95 }).toBuffer()
    console.log(`[ImageNorm] EXIF 旋转已消除，${(buffer.length / 1024).toFixed(0)}KB → ${(result.length / 1024).toFixed(0)}KB`)
    return { buffer: result, ext: 'jpg' }
  }
  catch (err: any) {
    console.warn(`[ImageNorm] 处理失败，使用原始图片:`, err.message)
    return { buffer, ext: 'jpg' }
  }
}

const FEEDBACK_DIR = path.resolve(__dirname, '../../data/feedback')

function ensureFeedbackDir() {
  if (!fs.existsSync(FEEDBACK_DIR)) {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true })
  }
}

/** 保存反馈 Markdown 内容 */
export function saveFeedback(jobId: string, content: string) {
  ensureFeedbackDir()
  const filePath = path.join(FEEDBACK_DIR, `${jobId}.md`)
  fs.writeFileSync(filePath, content, 'utf-8')
}

/** 加载反馈 Markdown 内容 */
export function loadFeedback(jobId: string): string | null {
  const filePath = path.join(FEEDBACK_DIR, `${jobId}.md`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

/** 列出所有已存储的 job（按 savedAt 倒序） */
export function listJobs(): Array<Record<string, unknown>> {
  ensureDir()
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'))
  const jobs: Array<Record<string, unknown>> = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')
      const data = JSON.parse(raw)
      const jobId = file.replace('.json', '')
      const imagesDir = path.resolve(__dirname, '../../data/images')
      const hasImage = ['jpg', 'jpeg', 'png', 'bmp'].some(
        ext => fs.existsSync(path.join(imagesDir, `${jobId}.${ext}`)),
      )

      if (typeof data.semester === 'string') {
        const normalized = normalizeSemester(data.semester)
        if (normalized !== data.semester) {
          data.semester = normalized
          fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf-8')
        }
      }

      jobs.push({ ...data, jobId, hasImage })
    }
    catch { /* skip corrupt files */ }
  }

  jobs.sort((a, b) => {
    const ta = String(a.savedAt ?? '')
    const tb = String(b.savedAt ?? '')
    return tb.localeCompare(ta)
  })

  return jobs
}

/** 删除 job 及其关联的图片和反馈文件 */
export function deleteJob(jobId: string): boolean {
  let deleted = false

  const jobPath = path.join(DATA_DIR, `${jobId}.json`)
  if (fs.existsSync(jobPath)) {
    fs.unlinkSync(jobPath)
    deleted = true
  }

  const imagesDir = path.resolve(__dirname, '../../data/images')
  for (const ext of ['jpg', 'jpeg', 'png', 'bmp']) {
    const imgPath = path.join(imagesDir, `${jobId}.${ext}`)
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath)
      deleted = true
    }
  }

  const feedbackPath = path.join(FEEDBACK_DIR, `${jobId}.md`)
  if (fs.existsSync(feedbackPath)) {
    fs.unlinkSync(feedbackPath)
    deleted = true
  }

  return deleted
}
