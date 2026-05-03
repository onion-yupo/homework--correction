import process from 'node:process'
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { saveJob, loadJob, saveImage, loadImageAsync, listJobs, normalizeSemester, normalizeImageRotation } from '../lib/storage.js'
import { createOcrClient } from '../lib/ocr.js'
import { syncJobToDb, ensureTeacher } from '../lib/db-sync.js'

type OcrClient = ReturnType<typeof createOcrClient>

/**
 * 轮询批改结果直到完成
 * @returns 完整的批改结果
 */
async function pollUntilDone(client: OcrClient, jobId: string, maxRetries = 60, interval = 3000) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await client.DescribeQuestionMarkAgentJob({ JobId: jobId })
    console.log(`[Poll] JobId: ${jobId}, Status: ${result.JobStatus}, Attempt: ${i + 1}`)

    if (result.JobStatus === 'DONE' || result.JobStatus === 'FAIL') {
      return result
    }

    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error('批改超时')
}

const app = new Hono()

/**
 * POST /api/correction/submit
 * 接收图片文件后，先把图片和元数据落盘，再由 /api/jobs 轮询异步推进腾讯云批改。
 * 这样前端可以在图片上传成功后立即拿到记录，不会卡在提交接口等待腾讯云返回。
 */
app.post('/submit', async (c) => {
  const body = await c.req.parseBody()
  const file = body.image

  if (!file || !(file instanceof File)) {
    return c.json({ error: '请上传图片文件' }, 400)
  }

  const studentName = String(body.studentName ?? '')
  const semester = normalizeSemester(String(body.semester ?? ''))
  const day = String(body.day ?? '')

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const ext = file.type?.includes('png') ? 'png' : 'jpg'

  const localId = `pending_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  saveImage(localId, buffer, ext)
  saveJob(localId, {
    jobStatus: 'PENDING',
    studentName,
    semester,
    day,
    savedAt: new Date().toISOString(),
  })

  const hasProcessing = listJobs().some(j => j.jobStatus === 'PROCESSING')

  console.log(`[Submit] 图片已上传并落盘，localId: ${localId}，大小: ${(arrayBuffer.byteLength / 1024).toFixed(1)}KB，学生: ${studentName || '未知'}，当前${hasProcessing ? '进入排队' : '等待立即推进'}`)

  return c.json({
    jobId: localId,
    queued: true,
  })
})

/**
 * GET /api/correction/query?jobId=xxx
 * 查询批改任务结果
 */
app.get('/query', async (c) => {
  const jobId = c.req.query('jobId')

  if (!jobId) {
    return c.json({ error: '缺少 jobId 参数' }, 400)
  }

  const client = createOcrClient()

  const result = await client.DescribeQuestionMarkAgentJob({ JobId: jobId })

  console.log(`[Query] JobId: ${jobId}, Status: ${result.JobStatus}, Angle: ${result.Angle ?? 0}`)

  const responseData = {
    jobStatus: result.JobStatus,
    errorCode: result.ErrorCode ?? '',
    errorMessage: result.ErrorMessage ?? '',
    angle: result.Angle ?? 0,
    markInfos: result.MarkInfos ?? [],
  }

  if (result.JobStatus === 'DONE' || result.JobStatus === 'FAIL') {
    const existing = loadJob(jobId)
    saveJob(jobId, {
      ...existing,
      ...responseData,
      savedAt: existing?.savedAt ?? new Date().toISOString(),
    })
    console.log(`[Query] 结果已持久化: ${jobId}, 状态: ${result.JobStatus}`)

    // 双写 SQLite
    if (result.JobStatus === 'DONE') {
      try {
        const saved = loadJob(jobId)
        if (saved) syncJobToDb(jobId, saved as any)
      } catch (e) { console.error('[Query] SQLite 同步失败:', e) }
    }
  }

  return c.json(responseData)
})

/**
 * POST /api/correction/submit-url
 * 接收图片 URL，下载后提交腾讯云批改，同步轮询直到完成，返回结果 + 链接
 * 供外部系统（如 OpenClaw）调用
 */
app.post('/submit-url', async (c) => {
  const body = await c.req.json<{
    imageUrl: string
    studentName?: string
    semester?: string
    day?: number | string
  }>()

  const { imageUrl, studentName } = body
  const rawSemester = body.semester ? normalizeSemester(String(body.semester)) : ''
  const semester = /^[一二三四五六](上|下)$/.test(rawSemester) ? rawSemester : undefined
  const day = /^\d+$/.test(String(body.day ?? '')) ? body.day : undefined

  if (!imageUrl) {
    return c.json({ error: '缺少 imageUrl 参数' }, 400)
  }

  console.log(`[SubmitURL] 开始处理，学生: ${studentName ?? '未知'}，学期: ${semester ?? '未知'}，第${day ?? '?'}天`)

  const imgRes = await fetch(imageUrl, { redirect: 'follow' })
  if (!imgRes.ok) {
    return c.json({ error: `图片下载失败: ${imgRes.status}` }, 400)
  }

  const arrayBuffer = await imgRes.arrayBuffer()
  const rawBuffer = Buffer.from(arrayBuffer)

  console.log(`[SubmitURL] 图片已下载，大小: ${(rawBuffer.length / 1024).toFixed(1)}KB`)

  const normalized = await normalizeImageRotation(rawBuffer)
  const buffer = normalized.buffer
  const ext = normalized.ext

  const base64 = buffer.toString('base64')

  const client = createOcrClient()

  const submitResult = await client.SubmitQuestionMarkAgentJob({
    ImageBase64: base64,
    QuestionConfigMap: JSON.stringify({
      KnowledgePoints: true,
      TrueAnswer: true,
      ReturnAnswerPosition: true,
    }),
  })

  const jobId = submitResult.JobId!
  console.log(`[SubmitURL] 任务已提交，JobId: ${jobId}`)

  saveImage(jobId, buffer, ext)

  const pollResult = await pollUntilDone(client, jobId)

  const responseData = {
    jobId,
    jobStatus: pollResult.JobStatus as string,
    errorCode: pollResult.ErrorCode ?? '',
    errorMessage: pollResult.ErrorMessage ?? '',
    angle: pollResult.Angle ?? 0,
    markInfos: pollResult.MarkInfos ?? [],
  }

  if (pollResult.JobStatus === 'DONE') {
    saveJob(jobId, {
      ...responseData,
      imageUrl,
      studentName: studentName ?? '',
      semester: semester ?? '',
      day: day ?? '',
      savedAt: new Date().toISOString(),
    })
    console.log(`[SubmitURL] 批改完成，结果已持久化`)

    // 双写 SQLite
    try {
      const saved = loadJob(jobId)
      if (saved) syncJobToDb(jobId, saved as any)
    } catch (e) { console.error('[SubmitURL] SQLite 同步失败:', e) }
  }

  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3100}`
  const link = `${baseUrl}/correction?jobId=${jobId}`

  return c.json({
    status: pollResult.JobStatus === 'DONE' ? '已完成' : '处理失败',
    link,
    ...responseData,
  })
})

/**
 * POST /api/correction/submit-async
 * 异步批改接口：立即返回 jobId，后台完成批改后回调飞书 Webhook
 * 供飞书多维表格自动化调用
 */
app.post('/submit-async', async (c) => {
  const body = await c.req.json<{
    imageUrl: string
    studentName?: string
    semester?: string
    day?: number | string
    term?: string
    teacherName?: string
    callbackUrl?: string
    recordId?: string
  }>()

  const { imageUrl, studentName, callbackUrl } = body
  const rawSemester = body.semester ? normalizeSemester(String(body.semester)) : ''
  const semester = /^[一二三四五六](上|下)$/.test(rawSemester) ? rawSemester : undefined
  const day = /^\d+$/.test(String(body.day ?? '')) ? body.day : undefined
  const term = body.term || undefined
  const teacherId = body.teacherName ? ensureTeacher(body.teacherName) : undefined

  if (!imageUrl) {
    return c.json({ error: '缺少 imageUrl 参数' }, 400)
  }

  console.log(`[SubmitAsync] 开始处理，学生: ${studentName ?? '未知'}，学期: ${semester ?? '未知'}，第${day ?? '?'}天，期: ${term ?? '未知'}，老师: ${body.teacherName ?? '未知'}，回调: ${callbackUrl ? '有' : '无'}`)

  let imgBuffer: Buffer
  let ext = 'jpg'
  try {
    const imgRes = await fetch(imageUrl, { redirect: 'follow' })
    if (!imgRes.ok) {
      return c.json({ error: `图片下载失败: ${imgRes.status}` }, 400)
    }
    const arrayBuffer = await imgRes.arrayBuffer()
    const rawBuffer = Buffer.from(arrayBuffer)
    console.log(`[SubmitAsync] 图片已下载，大小: ${(rawBuffer.length / 1024).toFixed(1)}KB`)
    const normalized = await normalizeImageRotation(rawBuffer)
    imgBuffer = normalized.buffer
    ext = normalized.ext
  }
  catch (err: any) {
    console.error(`[SubmitAsync] 图片下载异常:`, err.message)
    return c.json({ error: `图片下载异常: ${err.message}` }, 400)
  }

  const base64 = imgBuffer.toString('base64')
  const client = createOcrClient()

  let jobId: string
  try {
    const submitResult = await client.SubmitQuestionMarkAgentJob({
      ImageBase64: base64,
      QuestionConfigMap: JSON.stringify({
        KnowledgePoints: true,
        TrueAnswer: true,
        ReturnAnswerPosition: true,
      }),
    })
    jobId = submitResult.JobId!
    console.log(`[SubmitAsync] 任务已提交，JobId: ${jobId}`)
  }
  catch (err: any) {
    console.error(`[SubmitAsync] 腾讯云提交失败:`, err.message)
    return c.json({ error: `批改任务提交失败: ${err.message}` }, 500)
  }

  saveImage(jobId, imgBuffer, ext)

  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3100}`
  const link = `${baseUrl}/correction?jobId=${jobId}`

  // 后台异步轮询 + 回调，不阻塞响应
  ;(async () => {
    try {
      const pollResult = await pollUntilDone(client, jobId)
      const status = pollResult.JobStatus === 'DONE' ? '已完成' : '处理失败'

      const responseData = {
        jobId,
        jobStatus: pollResult.JobStatus as string,
        errorCode: pollResult.ErrorCode ?? '',
        errorMessage: pollResult.ErrorMessage ?? '',
        angle: pollResult.Angle ?? 0,
        markInfos: pollResult.MarkInfos ?? [],
      }

      if (pollResult.JobStatus === 'DONE') {
        saveJob(jobId, {
          ...responseData,
          imageUrl,
          studentName: studentName ?? '',
          semester: semester ?? '',
          day: day ?? '',
          term: term ?? '',
          teacherId: teacherId ?? '',
          savedAt: new Date().toISOString(),
        })
        console.log(`[SubmitAsync] 批改完成，结果已持久化`)

        // 双写 SQLite
        try {
          const saved = loadJob(jobId)
          if (saved) syncJobToDb(jobId, saved as any)
        } catch (e) { console.error('[SubmitAsync] SQLite 同步失败:', e) }
      }

      if (callbackUrl) {
        try {
          const callbackBody = {
            jobId,
            status,
            link,
          }
          console.log(`[SubmitAsync] 回调飞书 Webhook: ${callbackUrl}`, callbackBody)
          const cbRes = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(callbackBody),
          })
          console.log(`[SubmitAsync] 回调响应: ${cbRes.status}`)
        }
        catch (cbErr: any) {
          console.error(`[SubmitAsync] 回调失败:`, cbErr.message)
        }
      }
    }
    catch (err: any) {
      console.error(`[SubmitAsync] 后台批改异常:`, err.message)
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobId,
              status: '处理失败',
              link,
            }),
          })
        }
        catch { /* 回调失败不再重试 */ }
      }
    }
  })()

  return c.json({
    jobId,
    status: '处理中',
    link,
  })
})

/**
 * POST /api/correction/submit-file
 * 接收 multipart 文件上传 + 学生信息，同步轮询直到完成，返回结果 + 链接
 * 供 OpenClaw 等外部系统调用（先下载图片到本地，再 curl -F 上传）
 */
app.post('/submit-file', async (c) => {
  const body = await c.req.parseBody()
  const file = body.image

  if (!file || !(file instanceof File)) {
    return c.json({ error: '请上传图片文件（字段名 image）' }, 400)
  }

  const studentName = String(body.studentName ?? '')
  const semester = normalizeSemester(String(body.semester ?? ''))
  const day = String(body.day ?? '')

  console.log(`[SubmitFile] 开始处理，学生: ${studentName || '未知'}，学期: ${semester || '未知'}，第${day || '?'}天`)

  const arrayBuffer = await file.arrayBuffer()
  const rawBuffer = Buffer.from(arrayBuffer)

  console.log(`[SubmitFile] 图片大小: ${(rawBuffer.length / 1024).toFixed(1)}KB`)

  const normalized = await normalizeImageRotation(rawBuffer)
  const buffer = normalized.buffer
  const ext = normalized.ext

  const base64 = buffer.toString('base64')
  const client = createOcrClient()

  const submitResult = await client.SubmitQuestionMarkAgentJob({
    ImageBase64: base64,
    QuestionConfigMap: JSON.stringify({
      KnowledgePoints: true,
      TrueAnswer: true,
      ReturnAnswerPosition: true,
    }),
  })

  const jobId = submitResult.JobId!
  console.log(`[SubmitFile] 任务已提交，JobId: ${jobId}`)

  saveImage(jobId, buffer, ext)

  const pollResult = await pollUntilDone(client, jobId)

  const responseData = {
    jobId,
    jobStatus: pollResult.JobStatus as string,
    errorCode: pollResult.ErrorCode ?? '',
    errorMessage: pollResult.ErrorMessage ?? '',
    angle: pollResult.Angle ?? 0,
    markInfos: pollResult.MarkInfos ?? [],
  }

  if (pollResult.JobStatus === 'DONE') {
    saveJob(jobId, {
      ...responseData,
      studentName,
      semester,
      day,
      savedAt: new Date().toISOString(),
    })
    console.log(`[SubmitFile] 批改完成，结果已持久化`)

    // 双写 SQLite
    try {
      const saved = loadJob(jobId)
      if (saved) syncJobToDb(jobId, saved as any)
    } catch (e) { console.error('[SubmitFile] SQLite 同步失败:', e) }
  }

  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3100}`
  const link = `${baseUrl}/correction?jobId=${jobId}`

  return c.json({
    jobId,
    status: pollResult.JobStatus === 'DONE' ? '已完成' : '处理失败',
    link,
    totalCount: (pollResult.MarkInfos ?? []).reduce((sum: number, m: any) => {
      const countAnswers = (info: any): number => {
        let c = (info.AnswerInfos?.length ?? 0)
        if (info.MarkInfos) for (const sub of info.MarkInfos) c += countAnswers(sub)
        return c
      }
      return sum + countAnswers(m)
    }, 0),
    correctCount: (pollResult.MarkInfos ?? []).reduce((sum: number, m: any) => {
      const countCorrect = (info: any): number => {
        let c = (info.AnswerInfos ?? []).filter((a: any) => a.IsCorrect).length
        if (info.MarkInfos) for (const sub of info.MarkInfos) c += countCorrect(sub)
        return c
      }
      return sum + countCorrect(m)
    }, 0),
  })
})

/**
 * GET /api/correction/result/:jobId
 * 返回已持久化的批改结果（供前端通过链接加载）
 */
app.get('/result/:jobId', async (c) => {
  const jobId = c.req.param('jobId')

  const data = loadJob(jobId)
  if (!data) {
    return c.json({ error: '未找到该批改记录' }, 404)
  }

  return c.json(data)
})

/**
 * GET /api/correction/image/:jobId
 * 返回已存储的作业图片
 */
app.get('/image/:jobId', async (c) => {
  const jobId = c.req.param('jobId')

  const img = await loadImageAsync(jobId)
  if (!img) {
    return c.json({ error: '未找到该作业图片' }, 404)
  }

  const contentType = img.ext === 'png' ? 'image/png' : 'image/jpeg'
  return new Response(img.buffer, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
  })
})

export default app
