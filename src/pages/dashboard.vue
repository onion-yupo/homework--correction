<script setup lang="ts">
/**
 * 今日任务 — 统计栏 + 全期矩阵（小卡片格子）
 */
import { useApp } from '~/stores/useApp'

const API = import.meta.env.VITE_API_BASE || '/api'
const router = useRouter()
const app = useApp()

const TOTAL_DAYS = 24

/** 当前服务天数 */
const serviceDay = computed(() => {
  if (!app.termStartDate) return null
  const start = new Date(app.termStartDate + 'T00:00:00')
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1
  return diff
})

interface DayJob {
  jobId: string
  accuracy: number
  reviewStatus: string
  feedbackStatus: string
  submittedAt: string
  updatedAt: string
  totalQuestions: number
  correctCount: number
  errorCount: number
  frozen: boolean
}

interface StudentRow {
  id: string
  name: string
  days: Record<string, DayJob[]>
}

interface LevelGroup {
  semester: string
  students: StudentRow[]
}

const groups = ref<LevelGroup[]>([])
const maxDay = ref(TOTAL_DAYS)
const loading = ref(false)

/** 统计数据 */
const stats = computed(() => {
  let submitted = 0
  let pendingReview = 0
  let pendingFeedback = 0
  let completed = 0
  let totalStudents = 0

  // 未提交按人计数：有任何天没交的学生
  const studentsWithMissing = new Set<string>()

  for (const g of groups.value) {
    totalStudents += g.students.length
    for (const s of g.students) {
      let hasMissing = false
      const effectiveDay = Math.min(Math.max(serviceDay.value ?? maxDay.value, 0), maxDay.value)
      for (let d = 1; d <= effectiveDay; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) {
          hasMissing = true
          continue
        }
        for (const j of jobs) {
          if (j.frozen) continue
          submitted++
          const reviewed = j.reviewStatus === 'reviewed'
          const feedbacked = j.feedbackStatus === 'sent'
          if (reviewed && feedbacked) completed++
          else if (reviewed && !feedbacked) pendingFeedback++
          else pendingReview++
        }
      }
      if (hasMissing) studentsWithMissing.add(s.id)
    }
  }
  return { totalStudents, submitted, pendingReview, pendingFeedback, completed, notSubmitted: studentsWithMissing.size }
})

/** 问候语 */
const greeting = computed(() => {
  const h = new Date().getHours()
  const name = app.currentTeacherName || '老师'
  if (h < 12) return `${name}，上午好`
  if (h < 18) return `${name}，下午好`
  return `${name}，晚上好`
})

/** 昨日工作回顾 */
const yesterdayStats = computed(() => {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)

  let submittedCount = 0
  let reviewedCount = 0
  let feedbackedCount = 0
  let pendingReviewCount = 0
  let pendingFeedbackCount = 0

  for (const g of groups.value) {
    for (const s of g.students) {
      for (let d = 1; d <= maxDay.value; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) continue
        for (const j of jobs) {
          const submitT = parseServerTime(j.submittedAt).getTime()
          if (submitT >= yesterdayStart.getTime() && submitT < todayStart.getTime()) {
            submittedCount++
            if (j.reviewStatus !== 'reviewed') pendingReviewCount++
            else if (j.feedbackStatus !== 'sent') pendingFeedbackCount++
          }
          const updateT = parseServerTime(j.updatedAt || j.submittedAt).getTime()
          if (updateT < yesterdayStart.getTime() || updateT >= todayStart.getTime()) continue
          if (j.reviewStatus === 'reviewed') reviewedCount++
          if (j.feedbackStatus === 'sent') feedbackedCount++
        }
      }
    }
  }
  return {
    submittedCount,
    reviewedCount,
    feedbackedCount,
    pendingReviewCount,
    pendingFeedbackCount,
    hasActivity: submittedCount > 0 || reviewedCount > 0 || feedbackedCount > 0,
  }
})

/** 今日进度 */
const todayProgress = computed(() => {
  const total = stats.value.submitted
  const done = stats.value.completed
  const percent = total ? Math.round(done / total * 100) : 0
  return { done, total, percent }
})

/** 今日成果 */
const todayAchievements = computed(() => {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  let submittedCount = 0
  let reviewedCount = 0
  let feedbackedCount = 0
  const submittedStudents = new Set<string>()

  for (const g of groups.value) {
    for (const s of g.students) {
      for (let d = 1; d <= maxDay.value; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) continue
        for (const j of jobs) {
          if (parseServerTime(j.submittedAt).getTime() >= todayStart.getTime()) {
            submittedCount++
            submittedStudents.add(s.id)
          }
          const ut = parseServerTime(j.updatedAt || j.submittedAt).getTime()
          if (ut < todayStart.getTime()) continue
          if (j.reviewStatus === 'reviewed') reviewedCount++
          if (j.feedbackStatus === 'sent') feedbackedCount++
        }
      }
    }
  }
  return { submittedCount, reviewedCount, feedbackedCount, submittedStudentCount: submittedStudents.size }
})

/** 实时事件流：从 groups 数据提取最近变化的 job */
interface RecentEvent {
  type: 'submitted' | 'reviewed' | 'feedbacked'
  studentName: string
  semester: string
  day: number
  jobId: string
  time: string
}

const recentEvents = computed<RecentEvent[]>(() => {
  const events: RecentEvent[] = []

  for (const g of groups.value) {
    for (const s of g.students) {
      for (let d = 1; d <= maxDay.value; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) continue
        for (const j of jobs) {
          if (j.submittedAt) {
            events.push({
              type: 'submitted',
              studentName: s.name, semester: g.semester,
              day: d, jobId: j.jobId, time: j.submittedAt,
            })
          }
          if (j.feedbackStatus === 'sent' && j.updatedAt && j.updatedAt !== j.submittedAt) {
            events.push({
              type: 'feedbacked',
              studentName: s.name, semester: g.semester,
              day: d, jobId: j.jobId, time: j.updatedAt,
            })
          }
          else if (j.reviewStatus === 'reviewed' && j.updatedAt && j.updatedAt !== j.submittedAt) {
            events.push({
              type: 'reviewed',
              studentName: s.name, semester: g.semester,
              day: d, jobId: j.jobId, time: j.updatedAt,
            })
          }
        }
      }
    }
  }

  events.sort((a, b) => b.time.localeCompare(a.time))
  return events.slice(0, 5)
})

function eventText(e: RecentEvent): string {
  const label = dayLabel(e.day)
  switch (e.type) {
    case 'submitted': return `${e.studentName} 提交了 ${label} 作业`
    case 'reviewed': return `你完成了 ${e.studentName} ${label} 的复核`
    case 'feedbacked': return `你完成了 ${e.studentName} ${label} 的反馈`
    default: return ''
  }
}

/** 进度条颜色 */
const progressColor = computed(() => {
  const p = todayProgress.value.percent
  if (p >= 70) return '#16a34a'
  if (p >= 30) return '#ea580c'
  return '#dc2626'
})

/** 状态筛选 */
type FilterType = 'all' | 'pending-review' | 'pending-feedback' | 'not-submitted'
const filter = ref<FilterType>('all')

/** 时间筛选 */
type TimeFilter = 'all' | 'today' | 'yesterday' | 'recent2' | 'week'
const timeFilter = ref<TimeFilter>('all')

function isInTimeRange(iso: string): boolean {
  if (timeFilter.value === 'all' || !iso) return true
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  const t = parseServerTime(iso).getTime()

  switch (timeFilter.value) {
    case 'today': return t >= todayStart.getTime()
    case 'yesterday': return t >= yesterdayStart.getTime() && t < todayStart.getTime()
    case 'recent2': return t >= yesterdayStart.getTime()
    case 'week': return t >= todayStart.getTime() - 6 * 86400000
    default: return true
  }
}

/** 网格默认收起（3 行高度） */
const inboxExpanded = ref(false)
const gridWrapRef = ref<HTMLElement | null>(null)
const gridOverflows = ref(false)

function checkGridOverflow() {
  const el = gridWrapRef.value
  if (!el) { gridOverflows.value = false; return }
  gridOverflows.value = el.scrollHeight > el.clientHeight + 4
}

watch(filter, () => { inboxExpanded.value = false; nextTick(checkGridOverflow) })
watch(timeFilter, () => { inboxExpanded.value = false; nextTick(checkGridOverflow); saveTimeFilter() })

/** 排序 — 四个 tab 各自独立 */
type SortField = 'updatedAt' | 'day' | 'missingDays'
type SortOrder = 'asc' | 'desc'
interface SortPref { field: SortField, order: SortOrder }

const sortPrefs = ref<Record<string, SortPref>>({
  'all': { field: 'updatedAt', order: 'asc' },
  'pending-review': { field: 'updatedAt', order: 'asc' },
  'pending-feedback': { field: 'updatedAt', order: 'asc' },
  'not-submitted': { field: 'missingDays', order: 'desc' },
})

/** 当前 tab 的排序 */
const currentSort = computed(() => sortPrefs.value[filter.value] || { field: 'updatedAt', order: 'asc' })

/** 切换排序并持久化到后端 */
function toggleSort(field: SortField) {
  const tab = filter.value
  const pref = sortPrefs.value[tab]
  if (pref.field === field) {
    pref.order = pref.order === 'desc' ? 'asc' : 'desc'
  }
  else {
    pref.field = field
    pref.order = 'desc'
  }
  if (app.currentTeacherId) {
    fetch(`${API}/dashboard/sort-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId: app.currentTeacherId, tab, field: pref.field, order: pref.order }),
    }).catch(() => {})
  }
}

/** 冻结/解冻某个 job */
async function toggleFreeze(jobId: string, currentFrozen: boolean) {
  const newFrozen = !currentFrozen
  try {
    await fetch(`${API}/dashboard/freeze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, frozen: newFrozen }),
    })
    for (const g of groups.value) {
      for (const s of g.students) {
        for (const jobs of Object.values(s.days)) {
          const job = jobs.find(j => j.jobId === jobId)
          if (job) { job.frozen = newFrozen; return }
        }
      }
    }
  }
  catch (e) {
    console.error('[Dashboard] 冻结操作失败:', e)
  }
}

/** 从后端加载排序 + 时间筛选偏好 */
async function loadSortPrefs() {
  if (!app.currentTeacherId) return
  try {
    const resp = await fetch(`${API}/dashboard/sort-prefs?teacherId=${app.currentTeacherId}`)
    const data = await resp.json()
    if (data && typeof data === 'object') {
      for (const tab of ['all', 'pending-review', 'pending-feedback', 'not-submitted']) {
        if (data[tab]) sortPrefs.value[tab] = data[tab]
      }
      if (data.timeFilter) timeFilter.value = data.timeFilter
    }
  }
  catch {}
}

/** 持久化时间筛选 */
function saveTimeFilter() {
  if (!app.currentTeacherId) return
  fetch(`${API}/dashboard/sort-prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherId: app.currentTeacherId, timeFilter: timeFilter.value }),
  }).catch(() => {})
}

/** 带重试的 fetch */
async function fetchRetry(url: string, retries = 3, delay = 1000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url)
      if (resp.ok) return resp
    } catch { /* retry */ }
    if (i < retries - 1) await new Promise(r => setTimeout(r, delay * (i + 1)))
  }
  return fetch(url)
}

/** 加载矩阵 */
async function loadMatrix() {
  if (!app.currentTeacherId || !app.currentTerm) return
  loading.value = true
  try {
    const params = new URLSearchParams({
      teacherId: app.currentTeacherId,
      term: app.currentTerm,
    })
    if (app.currentCampId) params.set('campId', app.currentCampId)
    if (app.currentCohortId) params.set('cohortId', app.currentCohortId)
    const resp = await fetchRetry(
      `${API}/dashboard/matrix?${params.toString()}`,
    )
    const data = await resp.json()
    groups.value = data.groups || []
    maxDay.value = data.maxDay || TOTAL_DAYS
    loadReportStatuses()
  } catch (e) {
    console.error('[Dashboard] 加载矩阵失败:', e)
  } finally {
    loading.value = false
  }
}

/** 报告生成状态缓存：`${studentId}_${semester}` → { week1: 'xxx', week2: 'xxx', ... } */
const reportStatuses = ref<Record<string, Record<string, string>>>({})

/** 批量加载当前期所有学生的报告状态 */
async function loadReportStatuses() {
  if (!app.currentTerm) return
  try {
    const resp = await fetch(`${API}/report/status-batch?term=${encodeURIComponent(app.currentTerm)}`)
    const data = await resp.json()
    if (data.statuses) {
      reportStatuses.value = data.statuses
    }
  } catch (e) {
    console.error('[Dashboard] 加载报告状态失败:', e)
  }
}

/** 获取格子状态（支持多次提交） */
function getCellState(student: StudentRow, day: number) {
  const jobs = student.days[String(day)]
  if (!jobs?.length) return { status: 'empty' as const, submissions: [] as any[], jobId: '' }

  const submissions = jobs.map(j => ({
    jobId: j.jobId,
    reviewed: j.reviewStatus === 'reviewed',
    feedbacked: j.feedbackStatus === 'sent',
    accuracy: j.accuracy,
  }))

  // 整体状态取最新一次
  const latest = submissions[0]
  let status: 'pending-review' | 'pending-feedback' | 'completed'
  if (latest.reviewed && latest.feedbacked) status = 'completed'
  else if (latest.reviewed) status = 'pending-feedback'
  else status = 'pending-review'

  return { status, submissions, jobId: latest.jobId }
}

/** 格子始终高亮 — 底部矩阵不受 tab 筛选影响 */
function isCellHighlighted(_student: StudentRow, _day: number): boolean {
  return true
}

/** 点击格子 */
function goToCorrection(student: StudentRow, day: number) {
  const state = getCellState(student, day)
  if (state.status === 'empty') return
  router.push(`/correction?jobId=${state.jobId}`)
}

/** 待办队列：从矩阵中提取当前筛选状态下的卡片，按提交时间排序 */
interface QueueItem {
  studentName: string
  studentId: string
  semester: string
  day: number
  jobId: string
  reviewed: boolean
  feedbacked: boolean
  accuracy: number
  submittedAt: string
  updatedAt: string
  status: string
  frozen: boolean
}

/** 未提交学生列表（按人聚合） */
interface NotSubmittedStudent {
  studentName: string
  studentId: string
  semester: string
  missingDays: number[]
}

const notSubmittedStudents = computed<NotSubmittedStudent[]>(() => {
  const today = serviceDay.value ?? maxDay.value
  const effectiveDay = Math.min(Math.max(today, 0), maxDay.value)
  const list: NotSubmittedStudent[] = []
  for (const g of groups.value) {
    for (const s of g.students) {
      const missing: number[] = []
      for (let d = 1; d <= effectiveDay; d++) {
        if (!s.days[String(d)]?.length) missing.push(d)
      }
      if (missing.length > 0) {
        list.push({ studentName: s.name, studentId: s.id, semester: g.semester, missingDays: missing })
      }
    }
  }
  const sort = sortPrefs.value['not-submitted'] || { field: 'missingDays', order: 'desc' }
  const dir = sort.order === 'desc' ? -1 : 1
  list.sort((a, b) => {
    const diff = (a.missingDays.length - b.missingDays.length) * dir
    if (diff !== 0) return diff
    return a.studentName.localeCompare(b.studentName, 'zh-CN')
  })
  return list
})

/** 今日优先处理提示：让老师一眼知道先做什么 */
const priorityTips = computed(() => {
  const tips: { level: 'danger' | 'warning' | 'primary'; text: string; action?: FilterType }[] = []
  if (stats.value.pendingReview > 0) {
    tips.push({ level: 'danger', text: `先复核 ${stats.value.pendingReview} 份待批改作业`, action: 'pending-review' })
  }
  if (stats.value.pendingFeedback > 0) {
    tips.push({ level: 'warning', text: `再处理 ${stats.value.pendingFeedback} 份待反馈作业`, action: 'pending-feedback' })
  }
  const frequentMissing = notSubmittedStudents.value.filter(s => s.missingDays.length >= 3).length
  if (frequentMissing > 0) {
    tips.push({ level: 'primary', text: `${frequentMissing} 位学生连续/累计缺交较多，建议提醒`, action: 'not-submitted' })
  }
  if (!tips.length) {
    tips.push({ level: 'primary', text: '当前没有紧急待办，可以检查周报生成进度' })
  }
  return tips
})

/** 待办队列：只含待复核和待反馈，不含未交 */
const todoQueue = computed<QueueItem[]>(() => {
  if (filter.value === 'not-submitted') return []
  const items: QueueItem[] = []

  for (const g of groups.value) {
    for (const s of g.students) {
      for (let d = 1; d <= maxDay.value; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) continue

        for (const j of jobs) {
          const reviewed = j.reviewStatus === 'reviewed'
          const feedbacked = j.feedbackStatus === 'sent'
          let status: string
          if (reviewed && feedbacked) status = 'completed'
          else if (reviewed) status = 'pending-feedback'
          else status = 'pending-review'

          if (status === 'completed' && !j.frozen) continue

          const ts = j.updatedAt || j.submittedAt
          if (!isInTimeRange(ts)) continue

          if (filter.value === 'all' || status === filter.value) {
            items.push({
              studentName: s.name, studentId: s.id, semester: g.semester,
              day: d, jobId: j.jobId, reviewed, feedbacked,
              accuracy: j.accuracy, submittedAt: j.submittedAt,
              updatedAt: ts, status,
              frozen: !!j.frozen,
            })
          }
        }
      }
    }
  }

  items.sort((a, b) => {
    if (a.frozen !== b.frozen) return a.frozen ? 1 : -1
    const { field, order } = currentSort.value
    const dir = order === 'desc' ? -1 : 1
    if (field === 'day') {
      const dayDiff = a.day - b.day
      if (dayDiff !== 0) return dayDiff * dir
      return a.studentName.localeCompare(b.studentName, 'zh-CN')
    }
    const timeDiff = (a.updatedAt || '').localeCompare(b.updatedAt || '')
    if (timeDiff !== 0) return timeDiff * dir
    return b.day - a.day
  })
  return items
})

/** 解析服务器时间 — SQLite datetime('now') 返回 UTC 但不带 Z 后缀 */
function parseServerTime(s: string): Date {
  if (!s) return new Date(0)
  const normalized = s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T') + 'Z'
  return new Date(normalized)
}

/** 天数标签：22-24 为易错点加练 */
function dayLabel(d: number): string {
  if (d === 22) return '第一周易错点加练'
  if (d === 23) return '第二周易错点加练'
  if (d === 24) return '第三周易错点加练'
  return `第${d}天`
}

/** 格式化相对时间 — 精确区分今天/昨天 */
function timeAgo(iso: string): string {
  if (!iso) return ''
  const now = new Date()
  const then = parseServerTime(iso)
  const diffSec = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (diffSec < 10) return '刚刚'
  if (diffSec < 60) return `${diffSec}秒前`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate())

  if (thenDay.getTime() === today.getTime()) {
    return `今天 ${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  }
  if (thenDay.getTime() === yesterday.getTime()) {
    return `昨天 ${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  }

  const diffDays = Math.floor((today.getTime() - thenDay.getTime()) / 86400000)
  if (diffDays <= 7) return `${diffDays}天前`
  if (diffDays <= 30) return `${Math.floor(diffDays / 7)}周前`
  return `${then.getMonth() + 1}月${then.getDate()}日`
}

/** 获取各 tab 的待办数量（不受当前 filter 影响） */
function getTabCount(tab: string): number {
  let count = 0
  for (const g of groups.value) {
    for (const s of g.students) {
      for (let d = 1; d <= maxDay.value; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) continue
        for (const j of jobs) {
          if (j.frozen) continue
          if (!isInTimeRange(j.updatedAt || j.submittedAt)) continue
          const reviewed = j.reviewStatus === 'reviewed'
          const feedbacked = j.feedbackStatus === 'sent'
          const completed = reviewed && feedbacked
          if (tab === 'all' && !completed) count++
          else if (tab === 'pending-review' && !reviewed) count++
          else if (tab === 'pending-feedback' && reviewed && !feedbacked) count++
        }
      }
    }
  }
  return count
}

/** 网格溢出检测 — 需在 todoQueue / notSubmittedStudents 定义之后 */
watch([() => todoQueue.value.length, () => notSubmittedStudents.value.length], () => nextTick(checkGridOverflow))
onMounted(() => {
  const ro = new ResizeObserver(() => { if (!inboxExpanded.value) checkGridOverflow() })
  watch(gridWrapRef, (el) => { if (el) ro.observe(el) }, { immediate: true })
  onUnmounted(() => ro.disconnect())
})

/** 阶段性报告入口 */
const SUMMARY_MIN_DAYS = 12
const reportSlots = [
  { key: 'week1', label: '周报1', days: [1, 7] },
  { key: 'week2', label: '周报2', days: [8, 14] },
  { key: 'week3', label: '周报3', days: [15, 21] },
  { key: 'summary', label: '总结', days: [1, 24] },
]

/**
 * 报告状态：locked=不可生成 / ready=可生成未生成 / generated=已生成
 */
function getReportStatus(student: StudentRow, slot: typeof reportSlots[0], semester?: string): 'locked' | 'ready' | 'generated' {
  const key = `${student.id}_${semester || ''}`
  const statuses = reportStatuses.value[key]
  if (statuses?.[slot.key]) return 'generated'

  if (slot.key === 'summary') {
    let submittedDays = 0
    for (let d = slot.days[0]; d <= slot.days[1]; d++) {
      if (student.days[String(d)]?.length) submittedDays++
    }
    return submittedDays >= SUMMARY_MIN_DAYS ? 'ready' : 'locked'
  }
  for (let d = slot.days[0]; d <= slot.days[1]; d++) {
    if (student.days[String(d)]?.length) return 'ready'
  }
  return 'locked'
}

/** @deprecated 保留兼容 */
function isReportReady(student: StudentRow, slot: typeof reportSlots[0]): boolean {
  return getReportStatus(student, slot) !== 'locked'
}

/* ===== 一键批量生成周报 ===== */

/**
 * 当前应该显示的批量生成按钮类型：
 * 服务天数 >= 7  → week1
 * 服务天数 >= 14 → week2（替换 week1）
 * 服务天数 >= 21 → week3
 * 服务天数 >= 24 → 无（总结是视频，不走批量）
 */
const currentBatchSlot = computed(() => {
  const d = serviceDay.value
  if (!d || d < 7) return null
  if (d >= 21) return { key: 'week3', week: 3, label: '周报3' }
  if (d >= 14) return { key: 'week2', week: 2, label: '周报2' }
  return { key: 'week1', week: 1, label: '周报1' }
})

interface BatchState {
  running: boolean
  total: number
  completed: number
  failed: number
}
const batchStates = ref<Record<string, BatchState>>({})
let batchPollingTimers: Record<string, ReturnType<typeof setInterval>> = {}

function batchStateKey(semester: string, week: number) {
  return `${app.currentTerm}:${semester}:week${week}`
}

function getBatchState(semester: string, week: number): BatchState | null {
  return batchStates.value[batchStateKey(semester, week)] || null
}

/**
 * 统计某学期某周已生成和可生成的学生数
 */
function getBatchCounts(semester: string, slot: typeof reportSlots[0]): { generated: number; ready: number; total: number } {
  const group = groups.value.find(g => g.semester === semester)
  if (!group) return { generated: 0, ready: 0, total: 0 }
  let generated = 0, ready = 0
  for (const s of group.students) {
    const st = getReportStatus(s, slot, semester)
    if (st === 'generated') generated++
    else if (st === 'ready') ready++
  }
  return { generated, ready, total: group.students.length }
}

async function startBatchGenerate(semester: string, week: number) {
  const key = batchStateKey(semester, week)
  const state = batchStates.value[key]
  if (state?.running) return

  try {
    const resp = await fetch(`${API}/report/generate-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: app.currentTerm, semester, week }),
    })
    const data = await resp.json()
    if (data.status === 'nothing_to_generate') return
    if (data.status === 'started' || data.status === 'already_running') {
      batchStates.value[key] = {
        running: true,
        total: data.progress.total,
        completed: data.progress.completed,
        failed: data.progress.failed,
      }
      startBatchPolling(semester, week)
    }
  } catch (e) {
    console.error('[Batch] 启动失败:', e)
  }
}

function startBatchPolling(semester: string, week: number) {
  const key = batchStateKey(semester, week)
  if (batchPollingTimers[key]) return

  batchPollingTimers[key] = setInterval(async () => {
    try {
      const [progressResp, statusResp] = await Promise.all([
        fetch(`${API}/report/batch-progress?term=${encodeURIComponent(app.currentTerm)}&semester=${encodeURIComponent(semester)}&week=${week}`),
        fetch(`${API}/report/status-batch?term=${encodeURIComponent(app.currentTerm)}`),
      ])
      const progressData = await progressResp.json()
      const statusData = await statusResp.json()

      if (statusData.statuses) {
        reportStatuses.value = statusData.statuses
      }

      if (progressData.progress) {
        const p = progressData.progress
        batchStates.value[key] = {
          running: p.running,
          total: p.total,
          completed: p.completed,
          failed: p.failed,
        }
        if (!p.running) {
          clearInterval(batchPollingTimers[key])
          delete batchPollingTimers[key]
        }
      } else if (progressData.status === 'idle' || progressData.status === 'done') {
        batchStates.value[key] = { ...batchStates.value[key], running: false }
        clearInterval(batchPollingTimers[key])
        delete batchPollingTimers[key]
      }
    } catch (e) {
      console.error('[Batch] 轮询失败:', e)
    }
  }, 5000)
}

onUnmounted(() => {
  for (const timer of Object.values(batchPollingTimers)) clearInterval(timer)
  batchPollingTimers = {}
})

/**
 * 点击报告卡片：locked 不响应，ready/generated 跳转到报告页
 */
const showVideoModal = ref(false)
const videoModalUrl = ref('')

function closeVideoModal() {
  showVideoModal.value = false
  videoModalUrl.value = ''
}

function onReportCardClick(student: StudentRow, slot: typeof reportSlots[0], semester: string) {
  const status = getReportStatus(student, slot, semester)
  if (status === 'locked') return
  if (slot.key === 'summary') {
    if (status === 'generated') {
      const params = new URLSearchParams({
        studentId: student.id,
        semester,
        term: app.currentTerm,
      })
      videoModalUrl.value = `${API}/report/summary-video?${params}`
      showVideoModal.value = true
    } else {
      router.push(`/analytics?studentId=${encodeURIComponent(student.id)}&semester=${encodeURIComponent(semester)}&term=${encodeURIComponent(app.currentTerm)}`)
    }
  } else {
    const weekNum = slot.key.replace('week', '')
    router.push(`/report?studentId=${encodeURIComponent(student.id)}&semester=${encodeURIComponent(semester)}&term=${encodeURIComponent(app.currentTerm)}&week=${weekNum}`)
  }
}

/** ===== 提醒家长文案生成 ===== */
const remindModal = ref(false)
const remindText = ref('')
const remindLoading = ref(false)
const remindEditing = ref(false)
const remindTarget = ref<NotSubmittedStudent | null>(null)
const remindCopied = ref(false)
const remindInstruction = ref('')
const remindShowInstruction = ref(false)

/**
 * 从前端已有的 groups 数据中，提取该学生已提交天的摘要
 */
function getSubmittedSummary(studentId: string, semester: string): { day: number, accuracy: number }[] {
  const result: { day: number, accuracy: number }[] = []
  for (const g of groups.value) {
    if (g.semester !== semester) continue
    for (const s of g.students) {
      if (s.id !== studentId) continue
      for (let d = 1; d <= maxDay.value; d++) {
        const jobs = s.days[String(d)]
        if (!jobs?.length) continue
        result.push({ day: d, accuracy: jobs[0].accuracy })
      }
    }
  }
  return result
}

async function openRemind(student: NotSubmittedStudent, instruction?: string) {
  remindTarget.value = student
  remindModal.value = true
  remindText.value = ''
  remindEditing.value = false
  remindCopied.value = false
  remindLoading.value = true

  const submittedDays = getSubmittedSummary(student.studentId, student.semester)

  try {
    const resp = await fetch(`${API}/dashboard/remind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName: student.studentName,
        semester: student.semester,
        missingDays: student.missingDays,
        submittedDays,
        totalDays: maxDay.value,
        currentDay: serviceDay.value ?? maxDay.value,
        instruction: instruction || undefined,
      }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '请求失败' }))
      remindText.value = `生成失败：${err.error || resp.statusText}`
      remindLoading.value = false
      return
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (chunk.includes('[DONE]')) {
        remindText.value += chunk.replace('[DONE]', '')
        break
      }
      remindText.value += chunk
    }
  }
  catch (e: any) {
    remindText.value = `生成失败：${e.message}`
  }
  finally {
    remindLoading.value = false
  }
}

async function copyRemindText() {
  try {
    await navigator.clipboard.writeText(remindText.value)
    remindCopied.value = true
    setTimeout(() => { remindCopied.value = false }, 2000)
  }
  catch {
    const ta = document.createElement('textarea')
    ta.value = remindText.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    remindCopied.value = true
    setTimeout(() => { remindCopied.value = false }, 2000)
  }
}

/**
 * 一次性初始化：合并 API 减少 RTT
 * 后续切换期/老师仍走原有 watch 逐个加载
 */
let initDone = false

async function dashboardInit() {
  try {
    const savedTeacher = localStorage.getItem('teacherId') || ''
    const params = new URLSearchParams()
    if (savedTeacher) params.set('teacherId', savedTeacher)
    if (app.currentCampId) params.set('campId', app.currentCampId)
    if (app.currentCohortId) params.set('cohortId', app.currentCohortId)
    if (app.currentTerm) params.set('term', app.currentTerm)
    const query = params.toString()
    const url = query ? `${API}/dashboard/init?${query}` : `${API}/dashboard/init`
    const resp = await fetchRetry(url)
    const data = await resp.json()

    app.teachers = data.teachers || []
    if (data.teacherId) app.currentTeacherId = data.teacherId
    if (data.enrollment) app.enrollment = data.enrollment
    if (data.term) {
      app.currentTerm = data.term
      localStorage.setItem('term', data.term)
      const availSemesters = data.enrollment?.termSemesters?.[data.term] || []
      if (availSemesters.length && !availSemesters.includes(app.currentSemester)) {
        app.currentSemester = availSemesters[0]
        localStorage.setItem('semester', availSemesters[0])
      }
    }
    if (data.matrix) {
      groups.value = data.matrix.groups || []
      maxDay.value = data.matrix.maxDay || TOTAL_DAYS
    }
    if (data.sortPrefs) {
      const sp = data.sortPrefs
      for (const tab of ['all', 'pending-review', 'pending-feedback'] as const) {
        if (sp[tab]) sortPrefs.value[tab] = sp[tab]
      }
      if (sp.timeFilter) timeFilter.value = sp.timeFilter
    }
    if (data.reportStatuses) reportStatuses.value = data.reportStatuses

    initDone = true
  } catch (e) {
    console.error('[Dashboard] init 失败，回退到分步加载:', e)
    await app.loadTeachers()
    initDone = true
  }
}

dashboardInit()

watch(() => [app.currentTerm, app.currentCampId, app.currentCohortId], () => {
  if (!initDone) return
  filter.value = 'all'
  loadMatrix()
  loadSortPrefs()
})
</script>

<template>
  <div class="dashboard">
    <!-- ===== 区域一：今日概览 ===== -->
    <div class="zone zone-overview">
      <div class="zone-bar"><span>今日概览</span></div>
      <div class="zone-content">
        <div class="status-panel">
      <!-- 第一层：问候 + 昨日回顾 -->
      <div class="panel-row-1">
        <div class="panel-greeting-line">
          <span class="panel-greeting">{{ greeting }}</span>
          <span v-if="serviceDay !== null" class="service-day-tag">
            <template v-if="serviceDay > TOTAL_DAYS">服务已完成</template>
            <template v-else-if="serviceDay >= 1">服务期 第{{ serviceDay }}/{{ TOTAL_DAYS }}天</template>
            <template v-else>服务未开始</template>
          </span>
        </div>
        <div v-if="yesterdayStats.hasActivity" class="panel-yesterday">
          昨天辛苦啦～收到了 <strong>{{ yesterdayStats.submittedCount }}</strong> 份作业，完成 <strong>{{ yesterdayStats.reviewedCount }}</strong> 次复核、<strong>{{ yesterdayStats.feedbackedCount }}</strong> 次反馈。
        </div>
        <div v-else class="panel-yesterday">
          昨天暂无新增批改记录，可以从今天的待办开始处理。
        </div>
        <div class="yesterday-metrics">
          <div class="yesterday-card">
            <span class="metric-num">{{ yesterdayStats.submittedCount }}</span>
            <span class="metric-label">昨日提交</span>
          </div>
          <div class="yesterday-card">
            <span class="metric-num metric-review">{{ yesterdayStats.reviewedCount }}</span>
            <span class="metric-label">昨日复核</span>
          </div>
          <div class="yesterday-card">
            <span class="metric-num metric-feedback">{{ yesterdayStats.feedbackedCount }}</span>
            <span class="metric-label">昨日反馈</span>
          </div>
          <div class="yesterday-card">
            <span class="metric-num metric-pending">{{ yesterdayStats.pendingReviewCount + yesterdayStats.pendingFeedbackCount }}</span>
            <span class="metric-label">昨日遗留</span>
          </div>
        </div>
        <div class="priority-strip">
          <button
            v-for="tip in priorityTips"
            :key="tip.text"
            :class="['priority-chip', `priority-${tip.level}`, { clickable: tip.action }]"
            @click="tip.action ? filter = tip.action : null"
          >
            {{ tip.text }}
          </button>
        </div>
      </div>

      <!-- 第二层：均分六格 — 待处理 + 今日成果 -->
      <div class="panel-row-2">
        <div class="panel-section panel-section-todo">
          <div class="section-label section-label-todo">待处理</div>
          <div class="section-grid">
            <button class="stat-block" @click="filter = 'pending-review'">
              <span class="stat-num stat-num-review">{{ stats.pendingReview }}</span>
              <span class="stat-label">待复核</span>
            </button>
            <button class="stat-block" @click="filter = 'pending-feedback'">
              <span class="stat-num stat-num-feedback">{{ stats.pendingFeedback }}</span>
              <span class="stat-label">待反馈</span>
            </button>
          </div>
        </div>

        <div class="panel-divider" />

        <div class="panel-section panel-section-done">
          <div class="section-label section-label-done">今日成果</div>
          <div class="section-grid">
            <div class="stat-block">
              <span class="stat-num stat-num-submit">{{ todayAchievements.submittedCount }}</span>
              <span class="stat-label">新提交</span>
            </div>
            <div class="stat-block">
              <span class="stat-num stat-num-reviewed">{{ todayAchievements.reviewedCount }}</span>
              <span class="stat-label">已复核</span>
            </div>
            <div class="stat-block">
              <span class="stat-num stat-num-feedbacked">{{ todayAchievements.feedbackedCount }}</span>
              <span class="stat-label">已反馈</span>
            </div>
            <div class="stat-block">
              <span class="stat-num stat-num-students">{{ todayAchievements.submittedStudentCount }}<small>/{{ stats.totalStudents }}</small></span>
              <span class="stat-label">交作业人数</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 整体进度条 -->
      <div class="progress-wrap">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${todayProgress.percent}%`, background: progressColor }" />
        </div>
        <span class="progress-text">{{ todayProgress.total }} 份作业已提交，{{ todayProgress.done }} 份已完成全部流程</span>
      </div>

      <!-- 第三层：实时事件流 -->
      <div v-if="recentEvents.length" class="panel-row-3">
        <div
          v-for="(evt, i) in recentEvents"
          :key="i"
          class="event-item"
          @click="router.push(`/correction?jobId=${evt.jobId}`)"
        >
          <span :class="['event-dot', `event-${evt.type}`]" />
          <span class="event-time">{{ timeAgo(evt.time) }}</span>
          <span class="event-text">{{ eventText(evt) }}</span>
        </div>
      </div>
    </div>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中...</div>

    <!-- ===== 区域二：今日任务 ===== -->
    <div v-if="!loading" class="zone zone-inbox">
      <div class="zone-bar"><span>今日任务</span></div>
      <div class="zone-content">
        <div class="inbox-container">
      <!-- 左侧：文件夹抽屉 -->
      <div class="inbox-sidebar">
        <div
          v-for="f in (['all', 'pending-review', 'pending-feedback', 'not-submitted'] as FilterType[])" :key="f"
          :class="['folder-item', { active: filter === f }]"
          @click="filter = f"
        >
          <span class="folder-label">{{ { all: '全部任务', 'pending-review': '待复核', 'pending-feedback': '待反馈', 'not-submitted': '未提交' }[f] }}</span>
          <span v-if="f !== 'not-submitted' && getTabCount(f) > 0" class="folder-badge">{{ getTabCount(f) }}</span>
          <span v-if="f === 'not-submitted' && notSubmittedStudents.length > 0" class="folder-badge folder-badge-gray">{{ notSubmittedStudents.length }}</span>
        </div>
      </div>

      <!-- 右侧：卡片网格 -->
      <div class="inbox-main">
        <!-- 工具栏：时间筛选 + 排序 -->
        <div v-if="(filter !== 'not-submitted' && (todoQueue.length > 0 || timeFilter !== 'all')) || (filter === 'not-submitted' && notSubmittedStudents.length > 0)" class="inbox-toolbar">
          <div v-if="filter !== 'not-submitted'" class="time-filters">
            <button
              v-for="tf in ([
                { key: 'all', label: '全部' },
                { key: 'today', label: '今天' },
                { key: 'yesterday', label: '昨天' },
                { key: 'recent2', label: '近两天' },
                { key: 'week', label: '近一周' },
              ] as const)"
              :key="tf.key"
              :class="['time-btn', { active: timeFilter === tf.key }]"
              @click="timeFilter = tf.key"
            >{{ tf.label }}</button>
          </div>
          <div class="sort-controls">
            <template v-if="filter !== 'not-submitted'">
              <button :class="['sort-btn', { active: currentSort.field === 'updatedAt' }]" @click="toggleSort('updatedAt')">
                编辑时间 <span v-if="currentSort.field === 'updatedAt'" class="sort-arrow">{{ currentSort.order === 'desc' ? '↓' : '↑' }}</span>
              </button>
              <button :class="['sort-btn', { active: currentSort.field === 'day' }]" @click="toggleSort('day')">
                天数 <span v-if="currentSort.field === 'day'" class="sort-arrow">{{ currentSort.order === 'desc' ? '↓' : '↑' }}</span>
              </button>
            </template>
            <template v-else>
              <button :class="['sort-btn', { active: currentSort.field === 'missingDays' }]" @click="toggleSort('missingDays')">
                缺交天数 <span v-if="currentSort.field === 'missingDays'" class="sort-arrow">{{ currentSort.order === 'desc' ? '↓' : '↑' }}</span>
              </button>
            </template>
          </div>
        </div>

        <!-- 任务卡片网格（全部/待复核/待反馈） -->
        <template v-if="filter !== 'not-submitted'">
          <div v-if="todoQueue.length === 0" class="inbox-empty">
            <template v-if="timeFilter !== 'all'">
              <div class="inbox-empty-text">该时段暂无待处理任务</div>
            </template>
            <template v-else>
              <div class="inbox-empty-icon">🎉</div>
              <div class="inbox-empty-text">全部处理完毕，干得漂亮！</div>
            </template>
          </div>
          <template v-else>
            <div ref="gridWrapRef" :class="['inbox-grid-wrap', { collapsed: !inboxExpanded }]">
              <div class="inbox-grid">
                <div
                  v-for="(item, i) in todoQueue"
                  :key="`${item.studentId}-${item.day}-${i}`"
                  :class="['inbox-card', `inbox-${item.status}`, { frozen: item.frozen }]"
                  @click="item.jobId ? router.push(`/correction?jobId=${item.jobId}`) : null"
                >
                  <button
                    class="freeze-btn"
                    :title="item.frozen ? '解冻任务' : '冻结任务'"
                    @click.stop="toggleFreeze(item.jobId, item.frozen)"
                  >
                    <svg v-if="!item.frozen" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="10" y1="15" x2="10" y2="9" /><line x1="14" y1="15" x2="14" y2="9" />
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                  <div class="card-row-1">
                    <span class="card-name">{{ item.studentName }}</span>
                  </div>
                  <div class="card-row-2">
                    <span :class="['card-status', item.reviewed ? 'status-done' : 'status-pending']">{{ item.reviewed ? '已复核' : '待复核' }}</span>
                    <span :class="['card-status', item.feedbacked ? 'status-done' : 'status-pending']">{{ item.feedbacked ? '已反馈' : '待反馈' }}</span>
                  </div>
                  <div class="card-row-3">
                    <span class="card-time">{{ timeAgo(item.updatedAt) }}</span>
                  </div>
                  <div class="card-row-4">
                    <span class="card-day">{{ dayLabel(item.day) }}</span>
                    <span class="card-semester">{{ item.semester }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="gridOverflows || inboxExpanded" class="inbox-toggle" @click="inboxExpanded = !inboxExpanded">
              <span class="inbox-toggle-text">
                {{ inboxExpanded ? '收起' : `展开全部 ${todoQueue.length} 条` }}
              </span>
              <span class="inbox-toggle-arrow">{{ inboxExpanded ? '▲' : '▼' }}</span>
            </div>
          </template>
        </template>

        <!-- 未提交学生卡片网格 -->
        <template v-else>
          <div v-if="notSubmittedStudents.length === 0" class="inbox-empty">
            <div class="inbox-empty-text">全员已提交</div>
          </div>
          <template v-else>
            <div ref="gridWrapRef" :class="['inbox-grid-wrap', { collapsed: !inboxExpanded }]">
              <div class="inbox-grid">
                <div
                  v-for="s in notSubmittedStudents"
                  :key="`${s.studentId}-${s.semester}`"
                  class="inbox-card inbox-card-muted"
                >
                  <button
                    class="remind-btn"
                    title="生成提醒文案"
                    @click.stop="openRemind(s)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    提醒
                  </button>
                  <div class="card-row-1">
                    <span class="card-name">{{ s.studentName }}</span>
                  </div>
                  <div class="inbox-missing">缺 {{ s.missingDays.length }} 天</div>
                  <div class="card-row-4">
                    <span class="card-semester">{{ s.semester }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="gridOverflows || inboxExpanded" class="inbox-toggle" @click="inboxExpanded = !inboxExpanded">
              <span class="inbox-toggle-text">
                {{ inboxExpanded ? '收起' : `展开全部 ${notSubmittedStudents.length} 位` }}
              </span>
              <span class="inbox-toggle-arrow">{{ inboxExpanded ? '▲' : '▼' }}</span>
            </div>
          </template>
        </template>
      </div>
    </div>
      </div>
    </div>

    <!-- ===== 区域三：班课学生看板 ===== -->
    <div v-if="!loading" class="zone zone-matrix">
      <div class="zone-bar"><span>班课学生看板</span></div>
      <div class="zone-content">
        <div v-for="group in groups" :key="group.semester" class="level-group">
        <div class="level-header">
          <span>{{ group.semester }}</span>
          <template v-if="currentBatchSlot">
            <button
              v-if="!getBatchState(group.semester, currentBatchSlot.week)?.running"
              class="batch-gen-btn"
              :disabled="getBatchCounts(group.semester, reportSlots.find(s => s.key === currentBatchSlot!.key)!).ready === 0"
              :title="getBatchCounts(group.semester, reportSlots.find(s => s.key === currentBatchSlot!.key)!).ready === 0
                ? `${currentBatchSlot.label} 已全部生成`
                : `为 ${getBatchCounts(group.semester, reportSlots.find(s => s.key === currentBatchSlot!.key)!).ready} 位学生生成${currentBatchSlot.label}`"
              @click="startBatchGenerate(group.semester, currentBatchSlot.week)"
            >
              <template v-if="getBatchCounts(group.semester, reportSlots.find(s => s.key === currentBatchSlot!.key)!).ready === 0">
                {{ currentBatchSlot.label }} ✓
              </template>
              <template v-else>
                一键生成{{ currentBatchSlot.label }}
              </template>
            </button>
            <span v-else class="batch-gen-progress">
              生成中 {{ getBatchState(group.semester, currentBatchSlot.week)!.completed }}/{{ getBatchState(group.semester, currentBatchSlot.week)!.total }}
            </span>
          </template>
        </div>
        <div class="matrix-scroll">
          <div v-for="student in group.students" :key="student.id" class="student-row">
            <div class="student-name">
              <router-link
                :to="`/analytics?studentId=${student.id}&term=${encodeURIComponent(app.currentTerm)}&semester=${encodeURIComponent(group.semester)}`"
                class="name-link"
              >{{ student.name }}</router-link>
            </div>
            <div class="day-cells">
              <div
                v-for="d in maxDay"
                :key="d"
                :class="[
                  'day-card',
                  `card-${getCellState(student, d).status}`,
                  { dimmed: !isCellHighlighted(student, d) }
                ]"
                @click="goToCorrection(student, d)"
              >
                <span class="day-num">{{ d }}</span>
                <div v-if="getCellState(student, d).status !== 'empty'" class="status-rows">
                  <div
                    v-for="(sub, si) in getCellState(student, d).submissions"
                    :key="si"
                    class="status-dots"
                    :title="`第${si + 1}次提交 | 复核: ${sub.reviewed ? '✓' : '✗'} | 反馈: ${sub.feedbacked ? '✓' : '✗'}`"
                    @click.stop="router.push(`/correction?jobId=${sub.jobId}`)"
                  >
                    <span :class="['dot', 'dot-review', { active: sub.reviewed }]" />
                    <span :class="['dot', 'dot-feedback', { active: sub.feedbacked }]" />
                  </div>
                </div>
              </div>
              <!-- 阶段报告入口 -->
              <div class="report-divider" />
              <div
                v-for="slot in reportSlots"
                :key="slot.key"
                :class="['report-card', `report-${getReportStatus(student, slot, group.semester)}`, { clickable: getReportStatus(student, slot, group.semester) !== 'locked' }]"
                :title="{
                  locked: `${slot.label}：未生成（数据不足）`,
                  ready: `${slot.label}：未生成（可生成）`,
                  generated: `${slot.label}：已生成`,
                }[getReportStatus(student, slot, group.semester)]"
                @click="onReportCardClick(student, slot, group.semester)"
              >
                <span class="report-label">{{ slot.label }}</span>
                <span v-if="getReportStatus(student, slot, group.semester) === 'generated'" class="report-check">✓</span>
                <svg v-if="getReportStatus(student, slot, group.semester) === 'locked'" class="lock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </div>
            </div>
          </div>
          <div v-if="!group.students.length" class="empty-row">暂无学生</div>
        </div>
      </div>
      <div v-if="!groups.length" class="empty-row">暂无数据</div>
      </div>
    </div>

    <!-- ===== 提醒文案弹窗 ===== -->
    <Teleport to="body">
      <div v-if="remindModal" class="remind-overlay" @click.self="remindModal = false">
        <div class="remind-dialog">
          <div class="remind-header">
            <span class="remind-title">提醒 {{ remindTarget?.studentName }} 家长</span>
            <button class="remind-close" @click="remindModal = false">&times;</button>
          </div>
          <div class="remind-body">
            <div v-if="remindLoading && !remindText" class="remind-loading">
              <span class="remind-spinner" />
              正在生成提醒文案...
            </div>
            <textarea
              v-show="remindText"
              v-model="remindText"
              class="remind-textarea"
              :readonly="!remindEditing"
              :class="{ editing: remindEditing }"
              rows="8"
            />
            <div v-if="remindLoading && remindText" class="remind-streaming">生成中...</div>
          </div>
          <div class="remind-footer">
            <div v-if="!remindLoading && remindShowInstruction" class="remind-instruction-wrap">
              <textarea
                v-model="remindInstruction"
                class="remind-instruction"
                placeholder="输入补充指令，例如：语气更随意一些 / 不用提正确率 / 重点强调第1天的作业..."
                rows="2"
              />
              <div class="remind-instruction-actions">
                <button class="remind-action-btn remind-regen-btn" @click="remindShowInstruction = false; remindInstruction = ''">取消</button>
                <button class="remind-action-btn remind-copy-btn" @click="remindShowInstruction = false; remindTarget && openRemind(remindTarget, remindInstruction)">生成</button>
              </div>
            </div>
            <template v-if="!remindLoading && !remindShowInstruction">
              <button class="remind-action-btn remind-edit-btn" @click="remindEditing = !remindEditing">
                {{ remindEditing ? '完成编辑' : '编辑文案' }}
              </button>
              <button class="remind-action-btn remind-regen-btn" @click="remindShowInstruction = true; remindInstruction = ''">
                重新生成
              </button>
              <button
                v-if="remindText"
                class="remind-action-btn remind-copy-btn"
                :class="{ copied: remindCopied }"
                @click="copyRemindText"
              >
                {{ remindCopied ? '已复制' : '复制文案' }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 视频弹窗 -->
    <div v-if="showVideoModal" class="video-modal-overlay" @click.self="closeVideoModal">
      <div class="video-modal">
        <div class="video-modal-header">
          <span>学期总结视频</span>
          <button class="video-modal-close" @click="closeVideoModal">✕</button>
        </div>
        <video :src="videoModalUrl" controls class="video-player">
          您的浏览器不支持视频播放
        </video>
        <div class="video-modal-footer">
          <a :href="videoModalUrl" download class="video-download-btn">下载视频</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dashboard { padding: 16px 20px; }

/* ===== 分区竖条 ===== */
.zone {
  display: flex; align-items: stretch; margin-bottom: 24px;
}
.zone-bar {
  width: 28px; flex-shrink: 0; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  writing-mode: vertical-rl; text-orientation: mixed;
  span {
    font-size: 13px; font-weight: 700; letter-spacing: 3px; color: #fff;
    white-space: nowrap;
  }
}
.zone-content {
  flex: 1; min-width: 0; padding-left: 14px;
}
.zone-overview .zone-bar { background: var(--color-primary); }
.zone-inbox .zone-bar { background: var(--color-danger); }
.zone-matrix .zone-bar { background: var(--color-success); }
.zone .status-panel { margin-bottom: 0; }
.zone .inbox-container { margin-bottom: 0; }

/* ===== 今日状态面板 ===== */
.status-panel {
  margin-bottom: 20px; background: #fff;
  border-radius: var(--radius-lg); box-shadow: var(--shadow);
  padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;
}

/* -- 第一层：问候 + 昨日回顾 -- */
.panel-row-1 {
  display: flex; flex-direction: column; gap: 8px;
}
.panel-greeting-line {
  display: flex; align-items: center; gap: 10px;
}
.panel-greeting {
  font-size: 18px; font-weight: 700; color: var(--color-text); line-height: 1.4;
}
.service-day-tag {
  font-size: 12px; color: #8B6914; background: linear-gradient(135deg, #FFF8E1, #FFECB3);
  padding: 3px 12px; border-radius: 10px; white-space: nowrap; font-weight: 600;
  border: 1px solid rgba(180, 140, 20, 0.25);
  letter-spacing: 0.3px;
}
.panel-yesterday {
  font-size: 13px; color: var(--color-text-muted); line-height: 1.4;
  strong { color: var(--color-primary); font-weight: 600; }
}
.yesterday-metrics {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;
}
.yesterday-card {
  min-height: 56px; border: 1px solid var(--color-border-light); border-radius: 10px;
  background: linear-gradient(180deg, #fff, #fafbfc);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 5px;
}
.metric-num {
  font-size: 22px; font-weight: 800; line-height: 1; color: var(--color-primary);
}
.metric-review { color: var(--color-warning); }
.metric-feedback { color: var(--color-success); }
.metric-pending { color: var(--color-danger); }
.metric-label {
  font-size: 11px; color: var(--color-text-muted); line-height: 1;
}
.priority-strip {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.priority-chip {
  border: 1px solid transparent; border-radius: 999px;
  padding: 5px 12px; font-size: 12px; font-weight: 600;
  font-family: inherit; background: #fff; cursor: default;
  transition: all 0.15s;
}
.priority-chip.clickable { cursor: pointer; }
.priority-danger {
  color: #dc2626; background: #fff5f5; border-color: #fecaca;
  &:hover { background: #fee2e2; }
}
.priority-warning {
  color: #b45309; background: #fffbeb; border-color: #fde68a;
  &:hover { background: #fef3c7; }
}
.priority-primary {
  color: var(--color-primary); background: var(--color-primary-light); border-color: rgba(74,144,226,0.2);
  &:hover { background: rgba(74,144,226,0.12); }
}

/* -- 第二层：均分网格 -- */
.panel-row-2 {
  display: flex; align-items: stretch; gap: 0;
  border: 1px solid var(--color-border-light); border-radius: 12px; overflow: hidden;
}

.panel-section {
  display: flex; flex-direction: column; padding: 14px 16px;
}
.panel-section-todo { flex: 2; background: #fff5f5; }
.panel-section-done { flex: 4; background: #f8fdf9; }

.section-label {
  font-size: 12px; font-weight: 700; letter-spacing: 0.5px;
  margin-bottom: 10px;
}
.section-label-todo { color: var(--color-danger); }
.section-label-done { color: var(--color-success); }

.section-grid { display: flex; gap: 8px; flex: 1; }

.stat-block {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 6px; padding: 10px 4px; border-radius: 8px;
  background: #fff; border: 1px solid transparent;
  font-family: inherit; cursor: default; transition: all 0.15s;
}
button.stat-block {
  cursor: pointer;
  &:hover { border-color: var(--color-border); background: #fafbfc; }
}

.stat-num {
  font-size: 32px; font-weight: 700; line-height: 1;
  small { font-size: 16px; font-weight: 400; color: var(--color-text-muted); }
}
.stat-label { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; }

.stat-num-review { color: var(--color-danger); }
.stat-num-feedback { color: var(--color-warning); }
.stat-num-submit { color: var(--color-primary); }
.stat-num-reviewed { color: var(--color-warning); }
.stat-num-feedbacked { color: var(--color-success); }
.stat-num-students { color: var(--color-text-secondary); }

.panel-divider { width: 1px; background: var(--color-border-light); flex-shrink: 0; }

/* 整体进度条 */
.progress-wrap {
  display: flex; align-items: center; gap: 10px;
}
.progress-track {
  flex: 1; height: 6px; background: #eef0f4; border-radius: 3px; overflow: hidden;
}
.progress-fill {
  height: 100%; border-radius: 3px; transition: width 0.6s ease, background 0.4s ease;
  min-width: 2px;
}
.progress-text {
  font-size: 12px; font-weight: 500; color: var(--color-text-muted);
  white-space: nowrap;
}

/* -- 第三层：实时事件流 -- */
.panel-row-3 {
  border-top: 1px solid var(--color-border-light); padding-top: 12px;
  display: flex; flex-direction: column; gap: 6px;
  max-height: 130px; overflow: hidden;
}
.event-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px; border-radius: 6px;
  cursor: pointer; transition: background 0.12s;
  font-size: 12px; color: var(--color-text-secondary);

  &:hover { background: var(--color-bg); color: var(--color-text); }
}
.event-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.event-submitted { background: var(--color-primary); }
.event-reviewed { background: var(--color-warning); }
.event-feedbacked { background: var(--color-success); }

.event-time {
  font-size: 11px; color: var(--color-text-muted); min-width: 60px; flex-shrink: 0;
}
.event-text { flex: 1; }

/* ===== 收件箱区域 ===== */
.inbox-container {
  display: flex; gap: 0; margin-bottom: 20px;
  background: #fff; border-radius: var(--radius-lg); box-shadow: var(--shadow);
  min-height: 360px; overflow: hidden;
}

/* 左侧文件夹抽屉 */
.inbox-sidebar {
  width: 140px; min-width: 120px;
  background: var(--color-bg); border-right: 1px solid var(--color-border-light);
  display: flex; flex-direction: column;
  padding: 8px 0;
}
.folder-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; cursor: pointer; transition: all 0.15s;
  border-left: 3px solid transparent; font-size: 13px;
  color: var(--color-text-secondary);

  &:hover { background: #eef1f6; color: var(--color-text); }
  &.active {
    background: #fff; color: var(--color-primary); font-weight: 600;
    border-left-color: var(--color-primary);
  }
}
.folder-label { white-space: nowrap; }
.folder-badge {
  font-size: 10px; font-weight: 700; color: #fff; background: var(--color-danger);
  padding: 0 5px; border-radius: 8px; min-width: 16px; text-align: center; line-height: 16px;
}
.folder-badge-gray { background: var(--color-text-muted); }

/* 右侧主区域 */
.inbox-main {
  flex: 1; display: flex; flex-direction: column; overflow-y: auto;
}
.inbox-toolbar {
  padding: 8px 16px; border-bottom: 1px solid var(--color-border-light);
  display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 12px;
}
.time-filters { display: flex; gap: 2px; }
.time-btn {
  font-size: 11px; padding: 4px 10px; border-radius: 6px;
  border: 1px solid transparent; background: transparent; color: var(--color-text-muted);
  cursor: pointer; transition: all 0.15s;

  &:hover { color: var(--color-text); background: var(--color-bg); }
  &.active { background: var(--color-primary); color: #fff; font-weight: 500; }
}
.sort-controls { display: flex; gap: 4px; }
.sort-btn {
  font-size: 11px; padding: 4px 10px; border-radius: 6px;
  border: 1px solid var(--color-border); background: #fff; color: var(--color-text-muted);
  cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 2px;

  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
  &.active { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); font-weight: 500; }
}
.sort-arrow { font-size: 10px; }

/* 卡片网格容器 — 收起时限制 3 行高度 */
$card-height: 120px;
$grid-gap: 12px;
$grid-padding: 16px;

.inbox-grid-wrap {
  overflow: hidden;
  transition: max-height 0.3s ease;

  &.collapsed {
    max-height: calc(#{$grid-padding} + (#{$card-height} + #{$grid-gap}) * 3);
    position: relative;

    &::after {
      content: '';
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 40px;
      background: linear-gradient(transparent, #fff);
      pointer-events: none;
    }
  }
}

.inbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: $grid-gap; padding: $grid-padding;
}
.inbox-card {
  position: relative; border-radius: 12px; border: 1.5px solid var(--color-border);
  padding: 12px 14px; cursor: pointer; transition: all 0.18s; background: #fff;
  min-height: 100px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);

  &:hover { border-color: var(--color-primary); box-shadow: 0 4px 16px rgba(74,144,226,0.12); transform: translateY(-1px); }
}

/* 第1行：姓名 */
.card-row-1 { line-height: 1; }
.card-name { font-size: 16px; font-weight: 700; color: var(--color-text); }

/* 第2行：状态标签 */
.card-row-2 { display: flex; gap: 6px; }
.card-status {
  font-size: 12px; padding: 2px 8px; border-radius: 6px; font-weight: 600;
}
.status-pending { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.status-done { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }

/* 第3行：等待时长 */
.card-row-3 { line-height: 1; }
.card-time { font-size: 12px; color: var(--color-text-muted); }

/* 第4行：天数 + 学期 */
.card-row-4 { display: flex; align-items: center; gap: 6px; }
.card-day { font-size: 13px; font-weight: 600; color: var(--color-primary); }
.card-semester {
  font-size: 10px; color: var(--color-text-muted); background: var(--color-bg);
  padding: 1px 6px; border-radius: 4px;
}

/* 未提交卡片 */
.inbox-missing { font-size: 13px; color: var(--color-warning); font-weight: 600; margin-top: 2px; }

/* 冻结按钮 */
.freeze-btn {
  position: absolute; top: 8px; right: 8px;
  width: 24px; height: 24px; border-radius: 6px;
  border: none; background: transparent; color: #ccc;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; padding: 0;

  &:hover { background: var(--color-bg); color: var(--color-text-secondary); }
}
.inbox-card.frozen .freeze-btn { color: var(--color-primary); }

/* 冻结态卡片 */
.inbox-card.frozen {
  opacity: 0.35; border-color: #d1d5db; background: #fafbfc;

  &:hover { opacity: 0.55; border-color: #bbb; box-shadow: none; transform: none; }
  .card-name { color: var(--color-text-muted); }
  .card-status { opacity: 0.6; }
  .card-time { color: #ccc; }
  .card-day { color: #bbb; }
}

.inbox-card-muted {
  border-color: var(--color-border-light); background: #fafbfc; cursor: default;
  &:hover { border-color: var(--color-border-light); box-shadow: none; transform: none; }
}
.inbox-card-muted .card-name { color: var(--color-text-secondary); }

/* 清空状态 */
.inbox-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 20px; gap: 8px; flex: 1;
}
.inbox-empty-icon { font-size: 40px; }
.inbox-empty-text { font-size: 14px; color: var(--color-text-muted); font-weight: 500; }

/* 展开 / 收起 */
.inbox-toggle {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 16px; border-top: 1px solid var(--color-border-light);
  cursor: pointer; user-select: none; transition: background 0.15s;

  &:hover { background: var(--color-bg); }
}
.inbox-toggle-text { font-size: 12px; color: var(--color-primary); font-weight: 500; }
.inbox-toggle-arrow { font-size: 10px; color: var(--color-primary); }

/* ===== Level 分组 ===== */
.level-group { margin-bottom: 20px; }
.level-group:last-child { margin-bottom: 0; }
.level-header {
  font-size: 14px; font-weight: 700; padding: 10px 16px;
  background: #fff; border-radius: var(--radius) var(--radius) 0 0;
  border-bottom: 1px solid var(--color-border-light); box-shadow: var(--shadow);
  color: var(--color-text);
  display: flex; align-items: center; justify-content: space-between;
}

.batch-gen-btn {
  font-size: 12px; font-weight: 500; padding: 4px 14px;
  border-radius: 14px; border: 1.5px solid var(--color-primary);
  background: #fff; color: var(--color-primary); cursor: pointer;
  transition: all 0.2s;
  &:hover:not(:disabled) { background: var(--color-primary); color: #fff; }
  &:disabled { border-color: #16a34a; color: #16a34a; cursor: default; opacity: 0.8; }
}

.batch-gen-progress {
  font-size: 12px; font-weight: 500; padding: 4px 14px;
  border-radius: 14px; background: #eff6ff; color: var(--color-primary);
  animation: batchPulse 1.5s ease-in-out infinite;
}

@keyframes batchPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.matrix-scroll {
  background: #fff; border-radius: 0 0 var(--radius) var(--radius);
  box-shadow: var(--shadow); padding: 12px 16px; overflow-x: auto;
}

/* ===== 学生行 ===== */
.student-row {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 0;
  &:not(:last-child) { border-bottom: 1px solid var(--color-border-light); }
}
.student-name {
  width: 64px; min-width: 64px; font-size: 13px;
}
.name-link {
  color: var(--color-text); text-decoration: none; font-weight: 500;
  &:hover { color: var(--color-primary); }
}

/* ===== 天数格子 ===== */
.day-cells { display: flex; gap: 6px; }

.day-card {
  width: 44px; min-height: 44px; border-radius: 6px; border: 1.5px solid var(--color-border);
  display: flex; flex-direction: column; align-items: center;
  gap: 3px; cursor: pointer; transition: all 0.15s; background: #fff;
  position: relative; padding: 6px 2px;

  &:hover { border-color: var(--color-primary); box-shadow: 0 0 0 1px rgba(74,144,226,0.2); }

  &.dimmed { opacity: 0.2; pointer-events: none; }
}

.day-num { font-size: 13px; font-weight: 600; color: var(--color-text); line-height: 1; }

/* 1. 未提交 */
.card-empty {
  background: #fafbfc; border-color: #ebebeb; cursor: default;
  .day-num { color: #ccc; }
  &:hover { border-color: #ebebeb; box-shadow: none; }
}

/* 2. 已提交，未复核未反馈 */
.card-pending-review {
  border-color: #d1d5db;
}

/* 3. 已复核，待反馈 */
.card-pending-feedback {
  background: #fff; border-color: #86efac;
}

/* 4. 已完成 */
.card-completed {
  background: #f0fdf4; border-color: #a7f3d0;
  .day-num { color: #15803d; }
}

/* ===== 状态点 ===== */
.status-rows {
  display: flex; flex-direction: column; gap: 2px;
}
.status-dots {
  display: flex; gap: 4px; cursor: pointer;
  border-radius: 3px; padding: 1px 2px;
  &:hover { background: rgba(0,0,0,0.04); }
}
.dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #e0e0e0; transition: background 0.15s;
}
.dot-review.active { background: #16a34a; }
.dot-feedback.active { background: #16a34a; }

/* ===== 报告卡片 ===== */
.report-divider {
  width: 1px; min-height: 32px; background: var(--color-border-light); margin: 0 8px; align-self: center;
}

.report-card {
  width: 44px; min-height: 44px; border-radius: 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; transition: all 0.15s;
}
.report-label { font-size: 10px; font-weight: 500; line-height: 1; }
.report-check { font-size: 12px; line-height: 1; font-weight: 800; color: #16a34a; }
.lock-icon { flex-shrink: 0; }

.report-locked {
  border: 1.5px dashed #d9dce3; background: #fafbfc; cursor: default;
  .report-label { color: #c0c0c0; }
  .lock-icon { color: #c0c0c0; }
}

.report-ready {
  border: 1.5px dashed var(--color-primary); background: rgba(74, 144, 226, 0.04);
  cursor: pointer;
  .report-label { color: var(--color-primary); }
  &:hover { background: rgba(74, 144, 226, 0.1); }
}

.report-generated {
  border: 1.5px solid #16a34a; background: #f0fdf4;
  cursor: pointer;
  .report-label { color: #15803d; font-weight: 700; }
  &:hover { background: #dcfce7; box-shadow: 0 0 0 1px rgba(22, 163, 74, 0.15); }
}

.loading, .empty-row { padding: 40px; text-align: center; color: var(--color-text-muted); font-size: 13px; }

/* ===== 未提交卡片的提醒按钮 ===== */
.remind-btn {
  position: absolute; top: 8px; right: 8px;
  display: flex; align-items: center; gap: 3px;
  padding: 3px 8px; border-radius: 6px;
  border: 1px solid #fed7aa; background: #fff7ed; color: #ea580c;
  font-size: 11px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.15s;

  &:hover { background: #ffedd5; border-color: #fb923c; box-shadow: 0 2px 8px rgba(234, 88, 12, 0.12); }
}
.inbox-card-muted { position: relative; }

/* ===== 提醒文案弹窗 ===== */
.remind-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}

.remind-dialog {
  background: #fff; border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
  width: 520px; max-width: 90vw; max-height: 80vh;
  display: flex; flex-direction: column;
  animation: remind-slide-in 0.2s ease-out;
}

@keyframes remind-slide-in {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.remind-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--color-border-light);
}

.remind-title { font-size: 15px; font-weight: 700; color: var(--color-text); }

.remind-close {
  width: 28px; height: 28px; border-radius: 6px;
  border: none; background: transparent; color: var(--color-text-muted);
  font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;

  &:hover { background: var(--color-bg); color: var(--color-text); }
}

.remind-body { padding: 16px 20px; flex: 1; overflow-y: auto; }

.remind-loading {
  display: flex; align-items: center; gap: 8px;
  color: var(--color-text-muted); font-size: 13px;
  padding: 24px 0;
  justify-content: center;
}

.remind-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--color-border); border-top-color: var(--color-primary);
  animation: remind-spin 0.7s linear infinite;
}

@keyframes remind-spin { to { transform: rotate(360deg); } }

.remind-textarea {
  width: 100%; border: 1px solid var(--color-border); border-radius: 8px;
  padding: 12px 14px; font-size: 14px; line-height: 1.7;
  font-family: inherit; color: var(--color-text);
  resize: vertical; background: var(--color-bg);
  transition: all 0.15s;

  &:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1); }
  &.editing { background: #fff; border-color: var(--color-primary); }
  &[readonly] { cursor: default; }
}

.remind-streaming {
  font-size: 12px; color: var(--color-primary); margin-top: 8px;
  animation: remind-pulse 1s ease-in-out infinite;
}
@keyframes remind-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.remind-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px; border-top: 1px solid var(--color-border-light);
  justify-content: flex-end;
}

.remind-action-btn {
  padding: 6px 14px; border-radius: 8px;
  font-size: 13px; font-weight: 500; font-family: inherit;
  cursor: pointer; transition: all 0.15s; border: 1px solid;
}

.remind-edit-btn {
  border-color: var(--color-border); background: #fff; color: var(--color-text-secondary);
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
}

.remind-regen-btn {
  border-color: var(--color-border); background: #fff; color: var(--color-text-secondary);
  &:hover { border-color: var(--color-warning); color: #ea580c; }
}

.remind-copy-btn {
  border-color: var(--color-primary); background: var(--color-primary); color: #fff;
  &:hover { background: var(--color-primary-hover); border-color: var(--color-primary-hover); }
  &.copied { background: var(--color-success); border-color: var(--color-success); }
}

.remind-instruction-wrap {
  width: 100%; display: flex; flex-direction: column; gap: 8px;
}
.remind-instruction {
  width: 100%; border: 1px solid var(--color-border); border-radius: 8px;
  padding: 8px 12px; font-size: 13px; line-height: 1.5;
  font-family: inherit; color: var(--color-text); resize: none;
  &:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1); }
}
.remind-instruction-actions {
  display: flex; justify-content: flex-end; gap: 8px;
}

/* ===== 视频弹窗 ===== */
.video-modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.video-modal {
  background: #fff; border-radius: 12px; overflow: hidden;
  width: 90vw; max-width: 860px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}
.video-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; font-size: 15px; font-weight: 700; color: var(--color-text);
  border-bottom: 1px solid var(--color-border-light);
}
.video-modal-close {
  background: none; border: none; font-size: 18px; color: var(--color-text-muted);
  cursor: pointer; padding: 4px 8px; border-radius: 6px;
  &:hover { background: var(--color-bg); color: var(--color-text); }
}
.video-player {
  width: 100%; display: block; background: #000;
  max-height: 70vh;
}
.video-modal-footer {
  padding: 12px 20px; display: flex; justify-content: flex-end;
  border-top: 1px solid var(--color-border-light);
}
.video-download-btn {
  font-size: 13px; color: var(--color-primary); text-decoration: none;
  padding: 6px 16px; border: 1px solid var(--color-primary); border-radius: 8px;
  transition: all 0.15s;
  &:hover { background: var(--color-primary); color: #fff; }
}
</style>
