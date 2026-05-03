import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FlatQuestion, ManualAnnotation, MarkInfo, QueryJobResponse, ReviewAnswer, ReviewQuestion, ReviewSubQuestion } from '~/types'
import { compressImage } from '~/composables/useImageCompress'

const API = import.meta.env.VITE_API_BASE || '/api'

let _answerIdCounter = 0

function buildAnswer(answer: MarkInfo['AnswerInfos'][number]): ReviewAnswer {
  return {
    id: `a-${_answerIdCounter++}`,
    handwriteInfo: answer.HandwriteInfo,
    positions: answer.HandwriteInfoPositions ?? [],
    isCorrect: answer.IsCorrect,
    reviewedCorrect: answer.IsCorrect,
    rightAnswer: answer.RightAnswer,
    knowledgePoints: answer.KnowledgePoints ?? [],
    analysis: answer.AnswerAnalysis,
  }
}

/** 将 API 返回的嵌套 MarkInfos 转为层级结构（面板用） */
function buildReviewQuestions(markInfos: MarkInfo[]): ReviewQuestion[] {
  _answerIdCounter = 0
  return markInfos.map((item, idx) => {
    const subQuestions: ReviewSubQuestion[] = []
    const directAnswers: ReviewAnswer[] = []

    if (item.AnswerInfos?.length) {
      for (const a of item.AnswerInfos) directAnswers.push(buildAnswer(a))
    }

    if (item.MarkInfos?.length) {
      for (const sub of item.MarkInfos) {
        const answers: ReviewAnswer[] = []
        if (sub.AnswerInfos?.length) {
          for (const a of sub.AnswerInfos) answers.push(buildAnswer(a))
        }
        if (sub.MarkInfos?.length) {
          for (const subsub of sub.MarkInfos) {
            if (subsub.AnswerInfos?.length) {
              for (const a of subsub.AnswerInfos) answers.push(buildAnswer(a))
            }
          }
        }
        subQuestions.push({ title: sub.MarkItemTitle, answers })
      }
    }

    return {
      index: idx + 1,
      title: item.MarkItemTitle,
      subQuestions,
      directAnswers,
    }
  })
}

/** 从层级结构中提取扁平列表（图片标注用） */
function flattenFromReview(reviewQuestions: ReviewQuestion[]): FlatQuestion[] {
  const result: FlatQuestion[] = []
  for (const q of reviewQuestions) {
    for (const a of q.directAnswers) {
      result.push({ ...a, id: a.id, title: q.title })
    }
    for (const sub of q.subQuestions) {
      for (const a of sub.answers) {
        result.push({ ...a, id: a.id, title: `${q.title} > ${sub.title}` })
      }
    }
  }
  return result
}

export const useCorrection = defineStore('correction', () => {
  const imageFile = ref<File | null>(null)
  const imagePreviewUrl = ref('')
  const jobId = ref('')
  const jobStatus = ref<'idle' | 'uploading' | 'polling' | 'done' | 'fail'>('idle')
  const errorMessage = ref('')
  /** 层级结构（面板用） */
  const reviewQuestions = ref<ReviewQuestion[]>([])
  const imageNaturalSize = ref({ width: 0, height: 0 })
  /** API 返回的图片旋转角度（顺时针，度） */
  const imageAngle = ref(0)

  /** 学生元数据（从服务端加载时填充） */
  const studentName = ref('')
  const studentSemester = ref('')
  const studentDay = ref<number | string>('')

  /** 手动标注 */
  const manualAnnotations = ref<ManualAnnotation[]>([])

  /** 工作流状态标记 */
  const reviewed = ref(false)
  const feedbacked = ref(false)

  /** 反馈建议相关状态 */
  const feedbackStatus = ref<'idle' | 'loading' | 'streaming' | 'done' | 'fail'>('idle')
  const feedbackContent = ref('')
  const feedbackError = ref('')
  let feedbackAbortController: AbortController | null = null

  /** 扁平列表（图片标注用），从层级结构派生 */
  const questions = computed(() => flattenFromReview(reviewQuestions.value))

  const totalCount = computed(() => questions.value.length + manualAnnotations.value.length)
  const correctCount = computed(() =>
    questions.value.filter(q => q.reviewedCorrect).length
    + manualAnnotations.value.filter(a => a.isCorrect).length,
  )
  const wrongCount = computed(() => totalCount.value - correctCount.value)
  const accuracy = computed(() => {
    if (totalCount.value === 0) return 0
    return Math.round((correctCount.value / totalCount.value) * 100)
  })

  async function submitImage(file: File) {
    imageFile.value = file
    jobStatus.value = 'uploading'
    errorMessage.value = ''
    reviewQuestions.value = []

    try {
      const originalSize = (file.size / 1024 / 1024).toFixed(1)
      const compressed = await compressImage(file)
      const compressedSize = (compressed.size / 1024 / 1024).toFixed(1)
      console.log(`[图片压缩] ${originalSize}MB → ${compressedSize}MB`)

      imagePreviewUrl.value = URL.createObjectURL(compressed)

      const formData = new FormData()
      formData.append('image', compressed)

      const res = await fetch(`${API}/correction/submit`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '提交失败')
      }

      const data = await res.json()
      jobId.value = data.jobId
      jobStatus.value = 'polling'

      await pollResult()
    }
    catch (err: any) {
      jobStatus.value = 'fail'
      errorMessage.value = err.message || '提交失败'
    }
  }

  async function pollResult() {
    const maxRetries = 60
    const interval = 3000

    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`${API}/correction/query?jobId=${jobId.value}`)
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || '查询失败')
        }

        const data: QueryJobResponse = await res.json()

        if (data.jobStatus === 'DONE') {
          imageAngle.value = data.angle ?? 0
          reviewQuestions.value = buildReviewQuestions(data.markInfos)
          jobStatus.value = 'done'
          return
        }

        if (data.jobStatus === 'FAIL') {
          jobStatus.value = 'fail'
          errorMessage.value = data.errorMessage || '批改任务失败'
          return
        }

        await new Promise(resolve => setTimeout(resolve, interval))
      }
      catch (err: any) {
        jobStatus.value = 'fail'
        errorMessage.value = err.message || '查询失败'
        return
      }
    }

    jobStatus.value = 'fail'
    errorMessage.value = '批改超时，请重试'
  }

  /** 添加手动标注 */
  function addManualAnnotation(positions: number[], isCorrect: boolean) {
    const anno: ManualAnnotation = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      positions,
      isCorrect,
    }
    manualAnnotations.value.push(anno)
    saveManualAnnotationsToServer()
    return anno
  }

  /** 删除手动标注 */
  function removeManualAnnotation(id: string) {
    manualAnnotations.value = manualAnnotations.value.filter(a => a.id !== id)
    saveManualAnnotationsToServer()
  }

  /** 切换手动标注的对错 */
  function toggleManualAnnotation(id: string) {
    const anno = manualAnnotations.value.find(a => a.id === id)
    if (anno) {
      anno.isCorrect = !anno.isCorrect
      saveManualAnnotationsToServer()
    }
  }


  /** 持久化手动标注到服务端 */
  async function saveManualAnnotationsToServer() {
    if (!jobId.value) return
    try {
      await fetch(`${API}/jobs/${jobId.value}/manual-annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: manualAnnotations.value }),
      })
    }
    catch { /* 保存失败不阻塞 UI */ }
  }

  /** 持久化的复核修改记录：answerId → 老师最终判定 */
  const reviewCorrections = ref<Record<string, boolean>>({})
  /** 持久化的隐藏答案 ID 列表 */
  const persistedHiddenIds = ref<string[]>([])

  /** 老师切换某道答案的判定（同步更新层级结构中的数据） */
  function toggleCorrect(answerId: string) {
    for (const q of reviewQuestions.value) {
      for (const a of q.directAnswers) {
        if (a.id === answerId) {
          a.reviewedCorrect = !a.reviewedCorrect
          reviewCorrections.value[a.id] = a.reviewedCorrect
          saveReviewStateToServer()
          return
        }
      }
      for (const sub of q.subQuestions) {
        for (const a of sub.answers) {
          if (a.id === answerId) {
            a.reviewedCorrect = !a.reviewedCorrect
            reviewCorrections.value[a.id] = a.reviewedCorrect
            saveReviewStateToServer()
            return
          }
        }
      }
    }
  }

  /** 保存隐藏状态（由外部调用） */
  function setHiddenAnswerIds(ids: string[]) {
    persistedHiddenIds.value = ids
    saveReviewStateToServer()
  }

  /** 持久化复核状态到服务端 */
  let _reviewSaveTimer: ReturnType<typeof setTimeout> | null = null
  async function saveReviewStateToServer() {
    if (!jobId.value) return
    if (_reviewSaveTimer) clearTimeout(_reviewSaveTimer)
    _reviewSaveTimer = setTimeout(async () => {
      try {
        await fetch(`${API}/jobs/${jobId.value}/review-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewCorrections: reviewCorrections.value,
            hiddenAnswerIds: persistedHiddenIds.value,
          }),
        })
      }
      catch { /* 保存失败不阻塞 UI */ }
    }, 500)
  }

  /** 更新工作流状态标记（持久化到服务端） */
  async function setFlag(flag: 'reviewed' | 'feedbacked', value: boolean) {
    if (flag === 'reviewed') reviewed.value = value
    else feedbacked.value = value

    if (!jobId.value) return
    try {
      await fetch(`${API}/jobs/${jobId.value}/flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [flag]: value }),
      })
    }
    catch { /* 保存失败不阻塞 UI */ }
  }

  /**
   * 调用大模型生成反馈建议（流式）
   * @param studentName 学生姓名
   * @param grade 年级
   */
  /**
   * 构建反馈 payload，过滤掉隐藏的答案并重新计算统计
   */
  function buildFeedbackPayload(studentNameParam: string, grade: string, hiddenIds?: Set<string>) {
    const mapAnswer = (a: any) => ({
      handwriteInfo: a.handwriteInfo,
      isCorrect: a.isCorrect,
      reviewedCorrect: a.reviewedCorrect,
      rightAnswer: a.rightAnswer,
      knowledgePoints: a.knowledgePoints,
      analysis: a.analysis,
    })

    const isHidden = (a: any) => hiddenIds && hiddenIds.has(a.id)

    const questions = reviewQuestions.value.map(q => ({
      title: q.title,
      answers: [
        ...q.directAnswers.filter(a => !isHidden(a)).map(mapAnswer),
        ...q.subQuestions.flatMap(sub =>
          sub.answers.filter(a => !isHidden(a)).map(mapAnswer),
        ),
      ],
    })).filter(q => q.answers.length > 0)

    let total = 0
    let correct = 0
    for (const q of questions) {
      for (const a of q.answers) {
        total++
        if (a.reviewedCorrect) correct++
      }
    }
    const wrong = total - correct
    const acc = total > 0 ? Math.round(correct / total * 100) : 100

    const manualCorrect = manualAnnotations.value.filter(a => a.isCorrect).length
    const manualWrong = manualAnnotations.value.length - manualCorrect

    return {
      jobId: jobId.value,
      studentName: studentNameParam,
      grade,
      totalCount: total + manualAnnotations.value.length,
      correctCount: correct + manualCorrect,
      wrongCount: wrong + manualWrong,
      accuracy: (total + manualAnnotations.value.length) > 0
        ? Math.round((correct + manualCorrect) / (total + manualAnnotations.value.length) * 100)
        : 100,
      questions,
      manualAnnotationCount: manualAnnotations.value.length,
      manualCorrectCount: manualCorrect,
      manualWrongCount: manualWrong,
    }
  }

  async function generateFeedback(studentNameParam: string, grade: string, hiddenIds?: Set<string>) {
    if (feedbackAbortController) {
      feedbackAbortController.abort()
    }
    const ac = new AbortController()
    feedbackAbortController = ac

    feedbackStatus.value = 'loading'
    feedbackContent.value = ''
    feedbackError.value = ''

    const payload = buildFeedbackPayload(studentNameParam, grade, hiddenIds)

    try {
      const res = await fetch(`${API}/feedback/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '反馈生成失败')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (chunk.includes('[DONE]')) {
          feedbackContent.value += chunk.replace('[DONE]', '')
          break
        }
        feedbackContent.value += chunk
        if (feedbackStatus.value === 'loading' && feedbackContent.value.length > 0) {
          feedbackStatus.value = 'streaming'
        }
      }

      feedbackStatus.value = 'done'

      if (jobId.value && feedbackContent.value) {
        saveFeedbackToServer(jobId.value, feedbackContent.value)
      }
    }
    catch (err: any) {
      if (err.name === 'AbortError') return
      feedbackStatus.value = 'fail'
      feedbackError.value = err.message || '反馈生成失败'
    }
  }

  /** 将反馈内容保存到服务端（fire-and-forget） */
  async function saveFeedbackToServer(id: string, content: string) {
    try {
      await fetch(`${API}/feedback/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: id, content }),
      })
    }
    catch {
      // 保存失败不影响用户体验
    }
  }

  /** 从服务端加载已保存的反馈内容 */
  async function loadFeedbackFromServer(id: string) {
    try {
      const res = await fetch(`${API}/feedback/load/${id}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.content) {
        feedbackContent.value = data.content
        feedbackStatus.value = 'done'
      }
    }
    catch {
      // 加载失败不影响，用户可手动生成
    }
  }

  /**
   * 从服务端加载已持久化的批改结果（通过 URL 参数 jobId 进入时调用）
   */
  async function loadFromServer(id: string) {
    if (feedbackAbortController) {
      feedbackAbortController.abort()
      feedbackAbortController = null
    }

    if (imagePreviewUrl.value && imagePreviewUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreviewUrl.value)
    }
    jobId.value = id
    jobStatus.value = 'polling'
    errorMessage.value = ''
    reviewQuestions.value = []
    feedbackStatus.value = 'idle'
    feedbackContent.value = ''
    feedbackError.value = ''

    try {
      const res = await fetch(`${API}/correction/result/${id}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '加载批改结果失败')
      }

      const data = await res.json()

      if (data.jobStatus !== 'DONE') {
        jobStatus.value = 'fail'
        errorMessage.value = data.errorMessage || '该批改任务未完成'
        return
      }

      imageAngle.value = data.angle ?? 0
      reviewQuestions.value = buildReviewQuestions(data.markInfos)
      imagePreviewUrl.value = `${API}/correction/image/${id}`
      studentName.value = data.studentName ?? ''
      studentSemester.value = data.semester ?? ''
      studentDay.value = data.day ?? ''
      reviewed.value = data.reviewed ?? false
      feedbacked.value = data.feedbacked ?? false
      manualAnnotations.value = data.manualAnnotations ?? []

      const savedCorrections: Record<string, boolean> = data.reviewCorrections ?? {}
      reviewCorrections.value = savedCorrections
      persistedHiddenIds.value = data.hiddenAnswerIds ?? []

      if (Object.keys(savedCorrections).length > 0) {
        for (const q of reviewQuestions.value) {
          for (const a of q.directAnswers) {
            if (a.id in savedCorrections) a.reviewedCorrect = savedCorrections[a.id]
          }
          for (const sub of q.subQuestions) {
            for (const a of sub.answers) {
              if (a.id in savedCorrections) a.reviewedCorrect = savedCorrections[a.id]
            }
          }
        }
      }

      await loadFeedbackFromServer(id)

      jobStatus.value = 'done'
    }
    catch (err: any) {
      jobStatus.value = 'fail'
      errorMessage.value = err.message || '加载失败'
    }
  }

  function reset() {
    if (imagePreviewUrl.value && imagePreviewUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreviewUrl.value)
    }
    imageFile.value = null
    imagePreviewUrl.value = ''
    jobId.value = ''
    jobStatus.value = 'idle'
    errorMessage.value = ''
    reviewQuestions.value = []
    manualAnnotations.value = []
    reviewCorrections.value = {}
    persistedHiddenIds.value = []
    imageAngle.value = 0
    studentName.value = ''
    studentSemester.value = ''
    studentDay.value = ''
    reviewed.value = false
    feedbacked.value = false
    feedbackStatus.value = 'idle'
    feedbackContent.value = ''
    feedbackError.value = ''
  }

  return {
    imageFile,
    imagePreviewUrl,
    jobId,
    jobStatus,
    errorMessage,
    reviewQuestions,
    questions,
    manualAnnotations,
    imageNaturalSize,
    imageAngle,
    studentName,
    studentSemester,
    studentDay,
    totalCount,
    correctCount,
    wrongCount,
    accuracy,
    reviewed,
    feedbacked,
    feedbackStatus,
    feedbackContent,
    feedbackError,
    submitImage,
    loadFromServer,
    persistedHiddenIds,
    toggleCorrect,
    setHiddenAnswerIds,
    addManualAnnotation,
    removeManualAnnotation,
    toggleManualAnnotation,
    generateFeedback,
    buildFeedbackPayload,
    saveFeedback: () => {
      if (jobId.value && feedbackContent.value) {
        saveFeedbackToServer(jobId.value, feedbackContent.value)
      }
    },
    setFlag,
    reset,
  }
})
