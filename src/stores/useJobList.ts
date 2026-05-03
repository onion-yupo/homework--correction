import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { compressImage } from '~/composables/useImageCompress'

const API = import.meta.env.VITE_API_BASE || '/api'

export interface JobItem {
  jobId: string
  studentName: string
  semester: string
  day: string
  status: 'pending' | 'processing' | 'done' | 'fail'
  savedAt: string
  hasImage: boolean
}

export const useJobList = defineStore('jobList', () => {
  const jobs = ref<JobItem[]>([])
  const isLoading = ref(false)

  /** 当前正在处理中的 jobId（用于并发控制） */
  const processingJobId = computed(() =>
    jobs.value.find(j => j.status === 'processing')?.jobId ?? null,
  )

  let pollTimer: ReturnType<typeof setInterval> | null = null

  /** 从服务端拉取作业列表 */
  async function fetchJobs() {
    try {
      const res = await fetch(`${API}/jobs`)
      if (!res.ok) return
      const data: JobItem[] = await res.json()
      jobs.value = data
    }
    catch { /* ignore */ }
  }

  /** 删除作业记录 */
  async function deleteJob(jobId: string) {
    try {
      const res = await fetch(`${API}/jobs/${jobId}/delete`, { method: 'POST' })
      if (res.ok) {
        jobs.value = jobs.value.filter(j => j.jobId !== jobId)
      }
    }
    catch { /* ignore */ }
  }

  /**
   * 提交新的批改任务
   * 无论是否有 processing 任务，都立即上传图片并在列表中创建记录
   * 后端会异步处理，前端通过轮询更新状态
   */
  async function submitJob(file: File, studentName: string, semester: string, day: string) {
    try {
      console.log(`[Submit] 开始压缩图片，原始大小: ${(file.size / 1024).toFixed(1)}KB`)
      let imageFile: File
      try {
        imageFile = await compressImage(file)
        console.log(`[Submit] 压缩完成，大小: ${(imageFile.size / 1024).toFixed(1)}KB`)
      }
      catch (compressErr) {
        console.warn('[Submit] 压缩失败，使用原始文件:', compressErr)
        imageFile = file
      }

      const formData = new FormData()
      formData.append('image', imageFile)
      formData.append('studentName', studentName)
      formData.append('semester', semester)
      formData.append('day', day)

      const t0 = performance.now()
      console.log('[Submit] 开始上传...')
      const res = await fetch(`${API}/correction/submit`, {
        method: 'POST',
        body: formData,
      })
      const uploadMs = Math.round(performance.now() - t0)

      if (!res.ok) {
        const err = await res.json()
        console.error(`[Submit] 提交失败 (${uploadMs}ms):`, err.error)
        return
      }

      const data = await res.json()
      console.log(`[Submit] 上传成功 (${uploadMs}ms):`, data.jobId)

      jobs.value.unshift({
        jobId: data.jobId,
        studentName,
        semester,
        day,
        status: data.queued ? 'pending' : 'processing',
        savedAt: new Date().toISOString(),
        hasImage: true,
      })

      startPolling()
    }
    catch (err: any) {
      console.error('[Submit] 异常:', err)
    }
  }

  /** 开始轮询列表状态 */
  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
      await fetchJobs()

      const hasUnfinished = jobs.value.some(j => j.status === 'processing' || j.status === 'pending')
      if (!hasUnfinished) {
        stopPolling()
      }
    }, 3000)
  }

  /** 停止轮询 */
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** 初始化：拉取列表，如有 processing 任务则开始轮询 */
  async function init() {
    isLoading.value = true
    await fetchJobs()
    isLoading.value = false

    if (jobs.value.some(j => j.status === 'processing' || j.status === 'pending')) {
      startPolling()
    }
  }

  return {
    jobs,
    isLoading,
    processingJobId,
    fetchJobs,
    deleteJob,
    submitJob,
    startPolling,
    stopPolling,
    init,
  }
})
