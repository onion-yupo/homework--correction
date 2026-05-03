import { createOcrClient } from './ocr.js'
import { deleteJob, listJobs, loadImage, loadImageAsync, loadJob, saveImage, saveJob } from './storage.js'
import { uploadImageObject } from './object-storage.js'
import { syncJobToDb } from './db-sync.js'

type JobRecord = Record<string, any>

let advancing = false

export function isValidDay(day: unknown): boolean {
  const value = Number(String(day ?? '').trim())
  return Number.isInteger(value) && value >= 1 && value <= 24
}

export function normalizeJobListStatus(jobStatus: unknown): string {
  if (jobStatus === 'DONE') return 'done'
  if (jobStatus === 'FAIL') return 'fail'
  if (jobStatus === 'PROCESSING') return 'processing'
  if (jobStatus === 'NEEDS_DAY_CONFIRMATION') return 'needs-day'
  if (jobStatus === 'IGNORED') return 'ignored'
  return 'pending'
}

export function prepareSubmittedJob(jobId: string, job: JobRecord): JobRecord {
  const next = { ...job }
  if (!isValidDay(next.day)) {
    next.jobStatus = 'NEEDS_DAY_CONFIRMATION'
    next.errorMessage = '缺少有效的作业天数，需要老师确认后再批改'
    saveJob(jobId, next)
  }
  return next
}

async function refreshProcessingJobs(jobs: JobRecord[]): Promise<boolean> {
  const processingJobs = jobs.filter(j => j.jobStatus === 'PROCESSING')
  if (processingJobs.length === 0) return false

  let anyFinished = false

  try {
    const client = createOcrClient()

    await Promise.all(processingJobs.map(async (job) => {
      const jobId = String(job.jobId)
      try {
        const result = await client.DescribeQuestionMarkAgentJob({ JobId: jobId })
        console.log(`[Jobs] 刷新 ${jobId}: ${result.JobStatus}`)

        if (result.JobStatus === 'DONE' || result.JobStatus === 'FAIL') {
          const existing = loadJob(jobId)
          saveJob(jobId, {
            ...existing,
            jobStatus: result.JobStatus,
            errorCode: result.ErrorCode ?? '',
            errorMessage: result.ErrorMessage ?? '',
            angle: result.Angle ?? 0,
            markInfos: result.MarkInfos ?? [],
            savedAt: existing?.savedAt ?? new Date().toISOString(),
          })
          job.jobStatus = result.JobStatus
          anyFinished = true

          if (result.JobStatus === 'DONE') {
            const saved = loadJob(jobId)
            if (saved) syncJobToDb(jobId, saved as any)
          }
        }
      }
      catch (err) {
        console.error(`[Jobs] 刷新 ${jobId} 失败:`, err)
      }
    }))
  }
  catch (err) {
    console.error('[Jobs] OCR 客户端创建失败:', err)
  }

  return anyFinished
}

async function promoteNextPending(jobs: JobRecord[]) {
  const pendingJobs = jobs
    .filter(j => j.jobStatus === 'PENDING' && isValidDay(j.day))
    .sort((a, b) => String(a.savedAt ?? '').localeCompare(String(b.savedAt ?? '')))

  if (pendingJobs.length === 0) return

  const next = pendingJobs[0]
  const localId = String(next.jobId)

  const img = await loadImageAsync(localId)
  if (!img) {
    console.error(`[Queue] PENDING 任务 ${localId} 没有图片，标记为 FAIL`)
    saveJob(localId, { ...loadJob(localId), jobStatus: 'FAIL', errorMessage: '图片丢失' })
    next.jobStatus = 'FAIL'
    return
  }

  try {
    const client = createOcrClient()
    console.log(`[Queue] 推进队列，提交 PENDING 任务: ${localId}`)

    const imageUrl = await uploadImageObject(localId, img.buffer, img.ext).catch((err) => {
      console.warn(`[Queue] 上传 TOS 失败，回退 Base64: ${localId}`, err)
      return null
    })

    const result = await client.SubmitQuestionMarkAgentJob({
      ...(imageUrl ? { ImageUrl: imageUrl } : { ImageBase64: img.buffer.toString('base64') }),
      QuestionConfigMap: JSON.stringify({
        KnowledgePoints: true,
        TrueAnswer: true,
        ReturnAnswerPosition: true,
      }),
    })

    const newJobId = result.JobId!
    console.log(`[Queue] 任务已提交，旧ID: ${localId} -> 新JobId: ${newJobId}`)

    const existing = loadJob(localId) ?? {}
    saveJob(newJobId, {
      ...existing,
      jobStatus: 'PROCESSING',
      savedAt: existing.savedAt ?? new Date().toISOString(),
    })

    const oldImg = loadImage(localId)
    if (oldImg) {
      saveImage(newJobId, oldImg.buffer, oldImg.ext)
    }

    deleteJob(localId)

    next.jobId = newJobId
    next.jobStatus = 'PROCESSING'
  }
  catch (err: any) {
    console.error(`[Queue] 提交 PENDING 任务 ${localId} 失败:`, err)
    saveJob(localId, {
      ...loadJob(localId),
      jobStatus: 'FAIL',
      errorMessage: err?.message ?? '提交腾讯云失败',
    })
    next.jobStatus = 'FAIL'
  }
}

export async function advanceJobQueue() {
  if (advancing) return
  advancing = true
  try {
    const jobs = listJobs()
    await refreshProcessingJobs(jobs as JobRecord[])

    const stillProcessing = jobs.some(j => j.jobStatus === 'PROCESSING')
    if (!stillProcessing) {
      await promoteNextPending(jobs as JobRecord[])
    }
  }
  finally {
    advancing = false
  }
}

export function startJobQueueWorker() {
  const intervalMs = Number(process.env.JOB_QUEUE_INTERVAL_MS || 10_000)
  const timer = setInterval(() => {
    advanceJobQueue().catch(err => console.error('[QueueWorker] 推进队列失败:', err))
  }, intervalMs)
  timer.unref?.()
  console.log(`[QueueWorker] 已启动，间隔 ${intervalMs}ms`)
  advanceJobQueue().catch(err => console.error('[QueueWorker] 首次推进失败:', err))
  return timer
}
