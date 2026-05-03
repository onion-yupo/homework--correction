<script setup lang="ts">
/**
 * 学情分析页面 — 个人学情（学生档案）+ 全班概览
 */
import { useApp } from '~/stores/useApp'

const API = import.meta.env.VITE_API_BASE || '/api'
const route = useRoute()
const router = useRouter()
const app = useApp()

/** 视图模式 */
type ViewMode = 'student' | 'class'
const viewMode = ref<ViewMode>((route.query.studentId ? 'student' : 'student') as ViewMode)

/** 选中的学生 */
const selectedStudentId = ref((route.query.studentId as string) || '')

/** 从 URL 初始化学期 */
const initSemester = route.query.semester as string
if (initSemester && initSemester !== app.currentSemester) {
  app.setSemester(initSemester)
}

/** 当前选中学生名 */
const selectedStudentName = computed(() => {
  const s = app.students.find(s => s.id === selectedStudentId.value)
  return s?.name || ''
})

// ========== 数据 ==========

/** 个人趋势数据 */
interface TrendItem { day: number; accuracy: number; total_questions: number; correct_count: number; error_count: number }
const trend = ref<TrendItem[]>([])

/** 知识点数据 */
interface KnowledgeItem { name: string; total: number; correct: number; errors: number; accuracy: number }
const knowledge = ref<KnowledgeItem[]>([])

/** 错题数据 */
interface ErrorItem { question_title: string; student_answer: string; correct_answer: string; knowledge_points: string; answer_analysis: string; day: number; job_id?: string }
const errors = ref<ErrorItem[]>([])

/** 全班数据 */
interface ClassStudent { student_id: string; name: string; avg_accuracy: number; total_days: number; total_correct: number; total_errors: number }
interface ClassTrend { day: number; avg_accuracy: number; student_count: number }
const classStudents = ref<ClassStudent[]>([])
const classTrend = ref<ClassTrend[]>([])

/** 全班知识点（全量） */
interface TopKnowledge { name: string; total: number; errors: number; errorRate: number; studentCount: number }
const topKnowledge = ref<TopKnowledge[]>([])

/** 高频错题 */
interface ErrorQuestion {
  day: number; questionIndex: number; subTitle: string; correctAnswer: string
  knowledgePoints: string; totalAttempts: number; errorCount: number; errorRate: number
  errorStudents: { name: string; student_answer: string; job_id: string }[]
}
const classErrorQuestions = ref<ErrorQuestion[]>([])

/** 错题默认展示数量 & 展开全部开关 */
const ERRQ_DEFAULT_SHOW = 10
const errqShowAll = ref(false)
const visibleErrorQuestions = computed(() =>
  errqShowAll.value ? classErrorQuestions.value : classErrorQuestions.value.slice(0, ERRQ_DEFAULT_SHOW),
)

/** 错题展开状态 */
const expandedErrorQ = ref<Set<number>>(new Set())
function toggleErrorExpand(idx: number) {
  const s = new Set(expandedErrorQ.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  expandedErrorQ.value = s
}

/** AI 教研建议 */
const teachingAdvice = ref('')
const teachingAdviceLoading = ref(false)
const teachingAdviceInstruction = ref('')
const showAdviceInput = ref(false)

const loading = ref(false)

/** 后端返回的满分天次 */
const classPerfectDays = ref(0)

/** ========== 模块 1：班课数据总览（前端聚合） ========== */
const classSummary = computed(() => {
  const students = classStudents.value
  if (!students.length) return null

  const studentCount = students.length
  const totalSubmissions = students.reduce((s, st) => s + st.total_days, 0)
  const totalQuestions = students.reduce((s, st) => s + st.total_correct + st.total_errors, 0)
  const totalCorrect = students.reduce((s, st) => s + st.total_correct, 0)
  const avgAccuracy = students.reduce((s, st) => s + st.avg_accuracy, 0) / studentCount
  const avgCompleteDays = totalSubmissions / studentCount
  const perfectDays = classPerfectDays.value

  return { studentCount, totalSubmissions, totalQuestions, totalCorrect, avgAccuracy, avgCompleteDays, perfectDays }
})

/** ========== 模块 2：趋势增强（平均线 + 异常标注） ========== */
const classAvgLine = computed(() => {
  if (!classTrend.value.length) return 0
  return classTrend.value.reduce((s, t) => s + t.avg_accuracy, 0) / classTrend.value.length
})
function isAnomalyDay(t: ClassTrend) {
  return t.avg_accuracy < classAvgLine.value - 0.15
}

/** ========== 模块 4：知识点全景分层 ========== */
const knowledgeLayers = computed(() => {
  const all = topKnowledge.value
  const mastered = all.filter(k => k.errorRate < 0.05)
  const good = all.filter(k => k.errorRate >= 0.05 && k.errorRate < 0.20)
  const needWork = all.filter(k => k.errorRate >= 0.20 && k.errorRate < 0.50)
  const weak = all.filter(k => k.errorRate >= 0.50)
  return { mastered, good, needWork, weak }
})

/** ========== 模块 5：学生排行荣誉标注 ========== */
interface RankedStudent extends ClassStudent {
  rank: number
  perfectDays: number
  isStar: boolean
  isPersistent: boolean
}
const rankedStudents = computed<RankedStudent[]>(() => {
  const students = classStudents.value.map(s => ({ ...s, perfectDays: 0, rank: 0, isStar: false, isPersistent: false }))
  students.sort((a, b) => b.avg_accuracy - a.avg_accuracy)
  students.forEach((s, i) => { s.rank = i + 1 })

  const byDays = [...students].sort((a, b) => b.total_days - a.total_days)
  byDays.slice(0, 3).forEach(s => { s.isPersistent = true })

  const byAcc = [...students].sort((a, b) => b.avg_accuracy - a.avg_accuracy)
  byAcc.slice(0, 3).forEach(s => { s.isStar = true })

  return students
})
const classMedianAccuracy = computed(() => {
  const sorted = [...classStudents.value].sort((a, b) => a.avg_accuracy - b.avg_accuracy)
  if (!sorted.length) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid].avg_accuracy : (sorted[mid - 1].avg_accuracy + sorted[mid].avg_accuracy) / 2
})

/** 错题排序方式 */
type ErrorSort = 'day' | 'knowledge'
const errorSort = ref<ErrorSort>('day')

/** 排序后的错题 */
const sortedErrors = computed(() => {
  const list = [...errors.value]
  if (errorSort.value === 'knowledge') {
    list.sort((a, b) => {
      const ka = parseKp(a.knowledge_points)[0] || ''
      const kb = parseKp(b.knowledge_points)[0] || ''
      return ka.localeCompare(kb) || a.day - b.day
    })
  }
  return list
})

/** 个人统计摘要 */
const studentSummary = computed(() => {
  if (!trend.value.length) return null
  const totalDays = trend.value.length
  const totalCorrect = trend.value.reduce((s, t) => s + t.correct_count, 0)
  const totalErrors = trend.value.reduce((s, t) => s + t.error_count, 0)
  const totalQuestions = trend.value.reduce((s, t) => s + t.total_questions, 0)
  const avgAccuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0
  // 最近趋势：最后3天 vs 前3天
  const recent3 = trend.value.slice(-3)
  const first3 = trend.value.slice(0, 3)
  const recentAvg = recent3.reduce((s, t) => s + t.accuracy, 0) / recent3.length
  const firstAvg = first3.reduce((s, t) => s + t.accuracy, 0) / first3.length
  const trendDirection = recentAvg > firstAvg + 0.03 ? 'up' : recentAvg < firstAvg - 0.03 ? 'down' : 'stable'
  return { totalDays, avgAccuracy, totalCorrect, totalErrors, totalQuestions, trendDirection }
})

/** 周报状态 */
const REPORT_SLOTS = [
  { key: 'week1', label: '周报 1', days: [1, 7] },
  { key: 'week2', label: '周报 2', days: [8, 14] },
  { key: 'week3', label: '周报 3', days: [15, 21] },
  { key: 'summary', label: '总结', days: [1, 24] },
] as const

const SUMMARY_MIN_DAYS = 12

/** 已生成报告状态（从后端加载） */
const reportStatuses = ref<Record<string, string>>({})

async function loadReportStatuses() {
  if (!selectedStudentId.value || !app.currentTerm || !app.currentSemester) return
  try {
    const resp = await fetch(`${API}/report/status?studentId=${encodeURIComponent(selectedStudentId.value)}&semester=${encodeURIComponent(app.currentSemester)}&term=${encodeURIComponent(app.currentTerm)}`)
    const data = await resp.json()
    reportStatuses.value = data.status || {}
  } catch { /* ignore */ }
}

/**
 * 获取报告状态
 */
function getReportStatus(slot: typeof REPORT_SLOTS[number]): 'locked' | 'ready' | 'generated' {
  if (reportStatuses.value[slot.key]) return 'generated'
  if (!trend.value.length) return 'locked'
  const submittedDays = new Set(trend.value.map(t => t.day))
  if (slot.key === 'summary') {
    return submittedDays.size >= SUMMARY_MIN_DAYS ? 'ready' : 'locked'
  }
  for (let d = slot.days[0]; d <= slot.days[1]; d++) {
    if (submittedDays.has(d)) return 'ready'
  }
  return 'locked'
}

/** 视频弹窗 */
const showVideoModal = ref(false)
const videoUrl = ref('')

/** 点击报告卡片 → 跳转周报页面 / 打开总结视频 */
function openReport(slot: typeof REPORT_SLOTS[number]) {
  const status = getReportStatus(slot)
  if (status === 'locked') return
  if (slot.key === 'summary') {
    if (status === 'generated') {
      const params = new URLSearchParams({
        studentId: selectedStudentId.value,
        semester: app.currentSemester,
        term: app.currentTerm,
      })
      videoUrl.value = `${API}/report/summary-video?${params}`
      showVideoModal.value = true
    }
    return
  }
  const weekNum = slot.key.replace('week', '')
  router.push(`/report?studentId=${selectedStudentId.value}&semester=${encodeURIComponent(app.currentSemester)}&term=${encodeURIComponent(app.currentTerm)}&week=${weekNum}`)
}

function closeVideoModal() {
  showVideoModal.value = false
  videoUrl.value = ''
}

// ========== 数据加载 ==========

/** 加载个人学情 */
async function loadStudentData() {
  if (!selectedStudentId.value || !app.currentTerm || !app.currentSemester) return
  loading.value = true
  const sem = encodeURIComponent(app.currentSemester)
  const tm = encodeURIComponent(app.currentTerm)
  const sid = encodeURIComponent(selectedStudentId.value)

  try {
    const [trendResp, kpResp, errResp] = await Promise.all([
      fetch(`${API}/analytics/student-trend?studentId=${sid}&term=${tm}&semester=${sem}`),
      fetch(`${API}/analytics/student-knowledge?studentId=${sid}&term=${tm}&semester=${sem}`),
      fetch(`${API}/analytics/student-errors?studentId=${sid}&term=${tm}&semester=${sem}`),
    ])
    const trendData = await trendResp.json()
    const kpData = await kpResp.json()
    const errData = await errResp.json()

    trend.value = trendData.trend || []
    knowledge.value = kpData.knowledge || []
    errors.value = errData.errors || []
    loadReportStatuses()
  } catch (e) {
    console.error('[Analytics] 加载个人学情失败:', e)
  } finally {
    loading.value = false
  }
}

/** 加载全班数据 */
async function loadClassData() {
  if (!app.currentTerm || !app.currentSemester) return
  loading.value = true
  const sem = encodeURIComponent(app.currentSemester)
  const tm = encodeURIComponent(app.currentTerm)
  const tid = app.currentTeacherId ? `&teacherId=${app.currentTeacherId}` : ''

  try {
    const [overviewResp, kpResp, errQResp] = await Promise.all([
      fetch(`${API}/analytics/class-overview?term=${tm}&semester=${sem}${tid}`),
      fetch(`${API}/analytics/class-knowledge-top?term=${tm}&semester=${sem}${tid}&limit=all`),
      fetch(`${API}/analytics/class-error-questions?term=${tm}&semester=${sem}${tid}&limit=200`),
    ])
    const overviewData = await overviewResp.json()
    const kpData = await kpResp.json()
    const errQData = await errQResp.json()

    classStudents.value = overviewData.students || []
    classTrend.value = overviewData.trend || []
    classPerfectDays.value = overviewData.perfectDays || 0
    topKnowledge.value = kpData.topKnowledge || []
    classErrorQuestions.value = errQData.questions || []
    expandedErrorQ.value = new Set()
    errqShowAll.value = false

    // 加载已保存的教研建议；无则自动生成
    teachingAdvice.value = ''
    const hasSaved = await loadSavedAdvice()
    if (!hasSaved && classStudents.value.length > 0) {
      generateTeachingAdvice()
    }
  } catch (e) {
    console.error('[Analytics] 加载全班数据失败:', e)
  } finally {
    loading.value = false
  }
}

/** 加载已保存的教研建议 */
async function loadSavedAdvice() {
  if (!app.currentTerm || !app.currentSemester) return
  try {
    const resp = await fetch(`${API}/analytics/class-advice?term=${encodeURIComponent(app.currentTerm)}&semester=${encodeURIComponent(app.currentSemester)}`)
    const data = await resp.json()
    if (data.advice) {
      teachingAdvice.value = data.advice
      return true
    }
  } catch { /* ignore */ }
  return false
}

/** 保存教研建议到后端 */
async function saveAdvice(content: string) {
  if (!app.currentTerm || !app.currentSemester || !content) return
  try {
    await fetch(`${API}/analytics/class-advice/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: app.currentTerm, semester: app.currentSemester, content }),
    })
  } catch { /* ignore */ }
}

/** 生成 AI 教研建议（流式） */
async function generateTeachingAdvice() {
  if (!app.currentTerm || !app.currentSemester) return
  teachingAdviceLoading.value = true
  teachingAdvice.value = ''

  const weakKp = knowledgeLayers.value.weak.concat(knowledgeLayers.value.needWork)
    .slice(0, 5)
    .map((k, i) => `${i + 1}. ${k.name}（错误率 ${Math.round(k.errorRate * 100)}%，涉及 ${k.studentCount} 人）`)
    .join('\n')

  const topErrQ = classErrorQuestions.value.slice(0, 5)
    .map((q, i) => `${i + 1}. 第${q.day}天·${q.subTitle}（错误率 ${Math.round(q.errorRate * 100)}%，${q.errorCount}/${q.totalAttempts}人做错）`)
    .join('\n')

  const anomalies = classTrend.value
    .filter(t => isAnomalyDay(t))
    .map(t => `第${t.day}天 正确率 ${Math.round(t.avg_accuracy * 100)}%`)
    .join('；')

  const summary = classSummary.value
  const stats = summary ? {
    studentCount: summary.studentCount,
    totalSubmissions: summary.totalSubmissions,
    totalQuestions: summary.totalQuestions,
    avgAccuracy: Math.round(summary.avgAccuracy * 100),
    perfectDays: summary.perfectDays,
  } : {}

  try {
    const resp = await fetch(`${API}/analytics/class-teaching-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: app.currentTerm,
        semester: app.currentSemester,
        stats,
        weakKnowledge: weakKp || '暂无数据',
        errorQuestions: topErrQ || '暂无数据',
        anomalyDays: anomalies || '无明显异常',
        instruction: teachingAdviceInstruction.value || undefined,
      }),
    })
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      teachingAdvice.value += decoder.decode(value, { stream: true })
    }
    saveAdvice(teachingAdvice.value)
  } catch (e) {
    console.error('[Analytics] 生成教研建议失败:', e)
    teachingAdvice.value = '生成失败，请重试。'
  } finally {
    teachingAdviceLoading.value = false
    showAdviceInput.value = false
    teachingAdviceInstruction.value = ''
  }
}

// ========== 交互 ==========

/** 切换视图 */
function switchView(mode: ViewMode) {
  viewMode.value = mode
  if (mode === 'student' && selectedStudentId.value) loadStudentData()
  if (mode === 'class') loadClassData()
}

/** 选择学生 */
function selectStudent(id: string) {
  selectedStudentId.value = id
  manualSelectionCache.set(levelKey(), id)
  viewMode.value = 'student'
  loadStudentData()
}

/** 格式化百分比 */
function pct(v: number) { return `${Math.round(v * 100)}%` }

/** 知识点解析 */
function parseKp(json: string): string[] {
  try { return JSON.parse(json) } catch { return [] }
}

/** 打开图片大图 */
function openImage(url: string) { window.open(url, '_blank') }

/** 天数标签 */
function dayLabel(d: number): string {
  if (d === 22) return '第一周易错点加练'
  if (d === 23) return '第二周易错点加练'
  if (d === 24) return '第三周易错点加练'
  return `第${d}天`
}

/** 学生下拉 */
const studentDropdownOpen = ref(false)
function toggleStudentDropdown() { studentDropdownOpen.value = !studentDropdownOpen.value }
function onSelectStudentFromDropdown(id: string) {
  studentDropdownOpen.value = false
  selectStudent(id)
}

/** 点击外部关闭下拉 */
function onClickOutside(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.student-dropdown')) {
    studentDropdownOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

// ========== 初始加载 ==========

/** 缓存每个 level 下用户手动选过的学生，切回来时恢复 */
const manualSelectionCache = new Map<string, string>()

function levelKey() {
  return `${app.currentTerm}|${app.currentSemester}`
}

/**
 * 自动选中学生：优先恢复用户手动选过的，否则按提交天数最多排序。
 * 利用 class-overview 接口（有 60s 缓存，2-3ms 响应）。
 */
async function autoSelectBestStudent() {
  const list = app.students
  if (!list.length) return

  const cached = manualSelectionCache.get(levelKey())
  if (cached && list.find(s => s.id === cached)) {
    selectedStudentId.value = cached
    return
  }

  try {
    const sem = encodeURIComponent(app.currentSemester)
    const tm = encodeURIComponent(app.currentTerm)
    const tid = app.currentTeacherId ? `&teacherId=${app.currentTeacherId}` : ''
    const resp = await fetch(`${API}/analytics/class-overview?term=${tm}&semester=${sem}${tid}`)
    const data = await resp.json()
    const ranked = (data.students || []).sort((a: any, b: any) => b.total_days - a.total_days)
    if (ranked.length) {
      const best = ranked[0]
      if (list.find((s: any) => s.id === best.student_id)) {
        selectedStudentId.value = best.student_id
      }
    }
  } catch { /* fallback */ }

  if (!selectedStudentId.value && list.length) {
    selectedStudentId.value = list[0].id
  }
}

watch([() => app.currentTerm, () => app.currentSemester], async () => {
  if (viewMode.value === 'student') {
    await autoSelectBestStudent()
    if (selectedStudentId.value) loadStudentData()
  } else if (viewMode.value === 'class') {
    loadClassData()
  }
}, { immediate: true })

watch(() => app.students, async () => {
  if (viewMode.value === 'student') {
    await autoSelectBestStudent()
    if (selectedStudentId.value) loadStudentData()
  }
})
</script>

<template>
  <div class="analytics">
    <!-- ===== 顶部控制栏 ===== -->
    <div class="top-bar">
      <!-- 视图切换 -->
      <div class="view-tabs">
        <button :class="['tab-btn', { active: viewMode === 'student' }]" @click="switchView('student')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          个人学情
        </button>
        <button :class="['tab-btn', { active: viewMode === 'class' }]" @click="switchView('class')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          全班概览
        </button>
      </div>

      <!-- Level 切换（pill 样式） -->
      <div v-if="app.semesters.length" class="level-pills">
        <button
          v-for="s in app.semesters" :key="s"
          :class="['pill', { active: app.currentSemester === s }]"
          @click="app.setSemester(s)"
        >{{ s }}</button>
      </div>
    </div>

    <!-- ===== 个人学情：学生选择 ===== -->
    <div v-if="viewMode === 'student'" class="student-bar">
      <div class="student-dropdown" @click.stop="toggleStudentDropdown">
        <div class="student-trigger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span v-if="selectedStudentName" class="student-name-text">{{ selectedStudentName }}</span>
          <span v-else class="student-placeholder">选择学生</span>
          <span class="dropdown-arrow">▾</span>
        </div>
        <div v-if="studentDropdownOpen" class="student-menu">
          <div
            v-for="s in app.students" :key="s.id"
            :class="['student-option', { active: selectedStudentId === s.id }]"
            @click.stop="onSelectStudentFromDropdown(s.id)"
          >{{ s.name }}</div>
          <div v-if="!app.students.length" class="student-option disabled">暂无学生</div>
        </div>
      </div>
      <span v-if="selectedStudentName && studentSummary" class="student-meta">
        已提交 {{ studentSummary.totalDays }} 天 · 平均正确率 {{ pct(studentSummary.avgAccuracy) }}
        <span v-if="studentSummary.trendDirection === 'up'" class="trend-up">↑ 上升</span>
        <span v-else-if="studentSummary.trendDirection === 'down'" class="trend-down">↓ 下降</span>
        <span v-else class="trend-stable">→ 稳定</span>
      </span>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="loading-spinner" />
      <span>加载中...</span>
    </div>

    <!-- ========== 个人学情 ========== -->
    <template v-else-if="viewMode === 'student'">
      <template v-if="selectedStudentId && trend.length">
        <!-- 学生档案头 -->
        <div class="profile-header">
          <div class="profile-avatar">{{ selectedStudentName.charAt(0) }}</div>
          <div class="profile-info">
            <div class="profile-name">{{ selectedStudentName }}</div>
            <div class="profile-detail">{{ app.currentSemester }} · {{ app.currentTerm }}</div>
          </div>
          <div class="profile-stats">
            <div class="stat-item">
              <span class="stat-value">{{ studentSummary?.totalDays || 0 }}</span>
              <span class="stat-label">提交天数</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ pct(studentSummary?.avgAccuracy || 0) }}</span>
              <span class="stat-label">平均正确率</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ studentSummary?.totalCorrect || 0 }}</span>
              <span class="stat-label">正确题数</span>
            </div>
            <div class="stat-item">
              <span class="stat-value error-val">{{ studentSummary?.totalErrors || 0 }}</span>
              <span class="stat-label">错误题数</span>
            </div>
          </div>
        </div>

        <!-- 阶段报告入口 -->
        <div class="report-section">
          <div class="section-title">阶段报告</div>
          <div class="report-cards">
            <div
              v-for="slot in REPORT_SLOTS" :key="slot.key"
              :class="['report-card', `report-${getReportStatus(slot)}`, { clickable: getReportStatus(slot) !== 'locked' }]"
              :title="getReportStatus(slot) === 'locked' ? '数据不足，暂不可生成' : getReportStatus(slot) === 'ready' ? (slot.key === 'summary' ? '待生成总结视频' : '点击生成') : (slot.key === 'summary' ? '点击查看总结视频' : '点击查看')"
              @click="openReport(slot)"
            >
              <div class="report-icon">
                <svg v-if="getReportStatus(slot) === 'locked'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <svg v-else-if="getReportStatus(slot) === 'ready'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 12 18 16 12"/></svg>
              </div>
              <div class="report-label">{{ slot.label }}</div>
              <div class="report-range">
                <template v-if="slot.key === 'summary'">全期</template>
                <template v-else>Day {{ slot.days[0] }}-{{ slot.days[1] }}</template>
              </div>
            </div>
          </div>
        </div>

        <!-- 正确率趋势 -->
        <div class="card">
          <div class="section-title">正确率趋势</div>
          <div class="trend-chart">
            <div class="trend-y-axis">
              <span>100%</span><span>80%</span><span>60%</span><span>40%</span><span>20%</span><span>0%</span>
            </div>
            <div class="trend-bars">
              <div v-for="t in trend" :key="t.day" class="trend-bar-group">
                <div class="trend-bar-wrap">
                  <div
                    class="trend-bar"
                    :style="{ height: `${t.accuracy * 100}%`, background: t.accuracy >= 0.8 ? '#16a34a' : t.accuracy >= 0.6 ? '#f59e0b' : '#ef4444' }"
                    :title="`${dayLabel(t.day)}: ${pct(t.accuracy)} (${t.correct_count}/${t.total_questions})`"
                  />
                </div>
                <span class="trend-label">{{ t.day }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 知识点掌握 -->
        <div v-if="knowledge.length" class="card">
          <div class="section-title">知识点掌握情况</div>
          <div class="kp-list">
            <div v-for="kp in knowledge" :key="kp.name" class="kp-item">
              <span class="kp-name" :title="kp.name">{{ kp.name }}</span>
              <div class="kp-bar-wrap">
                <div class="kp-bar" :style="{ width: pct(kp.accuracy), background: kp.accuracy >= 0.8 ? '#16a34a' : kp.accuracy >= 0.6 ? '#f59e0b' : '#ef4444' }" />
              </div>
              <span class="kp-pct">{{ pct(kp.accuracy) }}</span>
              <span class="kp-detail">{{ kp.correct }}/{{ kp.total }}</span>
            </div>
          </div>
        </div>

        <!-- 错题列表 -->
        <div v-if="errors.length" class="card">
          <div class="section-title">
            错题列表
            <span class="card-count">共 {{ errors.length }} 道</span>
            <div class="error-sort-btns">
              <button :class="['sort-pill', { active: errorSort === 'day' }]" @click="errorSort = 'day'">按天数</button>
              <button :class="['sort-pill', { active: errorSort === 'knowledge' }]" @click="errorSort = 'knowledge'">按知识点</button>
            </div>
          </div>
          <div class="error-list">
            <div v-for="(err, i) in sortedErrors" :key="i" class="error-item">
              <div class="error-header">
                <span class="error-day">{{ dayLabel(err.day) }}</span>
                <span class="error-title"><MarkdownKatex :content="err.question_title" inline /></span>
                <span v-for="kp in parseKp(err.knowledge_points)" :key="kp" class="error-tag">{{ kp }}</span>
              </div>
              <div class="error-body">
                <div class="error-answer">
                  <span class="error-label">学生答案：</span>
                  <span class="error-wrong"><MarkdownKatex v-if="err.student_answer" :content="err.student_answer" inline /><template v-else>—</template></span>
                </div>
                <div class="error-answer">
                  <span class="error-label">正确答案：</span>
                  <span class="error-right"><MarkdownKatex v-if="err.correct_answer" :content="err.correct_answer" inline /><template v-else>—</template></span>
                </div>
                <div v-if="err.answer_analysis" class="error-analysis"><MarkdownKatex :content="err.answer_analysis" inline /></div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="selectedStudentId && !trend.length && !loading" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>该学生暂无数据</p>
      </div>
      <div v-else-if="!selectedStudentId" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <p>请选择学生查看学情档案</p>
      </div>
    </template>

    <!-- ========== 全班概览 ========== -->
    <template v-else>
      <!-- 模块 1：班课数据总览 -->
      <div v-if="classSummary" class="class-stats-row">
        <div class="cs-card">
          <div class="cs-value">{{ classSummary.studentCount }}</div>
          <div class="cs-label">参与学生</div>
        </div>
        <div class="cs-card">
          <div class="cs-value">{{ classSummary.totalSubmissions }}</div>
          <div class="cs-label">总提交天次</div>
        </div>
        <div class="cs-card">
          <div class="cs-value">{{ classSummary.totalQuestions }}</div>
          <div class="cs-label">总题数</div>
        </div>
        <div class="cs-card">
          <div class="cs-value accent">{{ Math.round(classSummary.avgAccuracy * 100) }}%</div>
          <div class="cs-label">平均正确率</div>
        </div>
        <div class="cs-card">
          <div class="cs-value">{{ classSummary.avgCompleteDays.toFixed(1) }}</div>
          <div class="cs-label">人均完成天数</div>
        </div>
        <div class="cs-card">
          <div class="cs-value star-val">{{ classSummary.perfectDays }}</div>
          <div class="cs-label">满分天次</div>
        </div>
      </div>

      <!-- 模块 2：每日正确率趋势（增强） -->
      <div v-if="classTrend.length" class="card">
        <div class="section-title">
          每日正确率趋势
          <span class="avg-line-label">— 全班平均 {{ Math.round(classAvgLine * 100) }}%</span>
        </div>
        <div class="class-trend-chart">
          <div class="trend-y-axis ct-y">
            <span>100%</span><span>80%</span><span>60%</span><span>40%</span><span>20%</span><span>0%</span>
          </div>
          <div class="ct-right">
            <div class="ct-bar-area">
              <div class="avg-line-h" :style="{ bottom: `${classAvgLine * 100}%` }" />
              <div v-for="t in classTrend" :key="t.day" class="ct-col">
                <div
                  :class="['ct-bar', { anomaly: isAnomalyDay(t) }]"
                  :style="{ height: `${t.avg_accuracy * 100}%`, background: isAnomalyDay(t) ? '#ef4444' : '#4f6ef7' }"
                  :title="`${dayLabel(t.day)}: ${pct(t.avg_accuracy)} (${t.student_count}人)${isAnomalyDay(t) ? ' ⚠️ 难度偏高' : ''}`"
                />
              </div>
            </div>
            <div class="ct-labels">
              <div v-for="t in classTrend" :key="t.day" class="ct-label-col">
                <span class="ct-count">{{ t.student_count }}人</span>
                <span class="ct-day">{{ t.day }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-if="classTrend.some(t => isAnomalyDay(t))" class="anomaly-hint">
          <span class="anomaly-dot" /> 红色柱标记为难度异常天（低于全班平均 15% 以上）
        </div>
      </div>

      <!-- 模块 3：高频错题 -->
      <div v-if="classErrorQuestions.length" class="card">
        <div class="section-title">
          高频错题
          <span class="card-count">共 {{ classErrorQuestions.length }} 道</span>
        </div>
        <div class="errq-list">
          <div v-for="(q, qi) in visibleErrorQuestions" :key="qi" class="errq-item">
            <div class="errq-header" @click="toggleErrorExpand(qi)">
              <span class="errq-rank">{{ qi + 1 }}</span>
              <span class="errq-day">{{ dayLabel(q.day) }}</span>
              <span class="errq-title"><MarkdownKatex :content="q.subTitle" inline /></span>
              <span class="errq-rate" :style="{ color: q.errorRate > 0.5 ? '#ef4444' : '#f59e0b' }">{{ Math.round(q.errorRate * 100) }}%</span>
              <span class="errq-count">{{ q.errorCount }}/{{ q.totalAttempts }}人</span>
              <span v-for="kp in parseKp(q.knowledgePoints)" :key="kp" class="errq-tag">{{ kp }}</span>
              <span class="errq-expand">{{ expandedErrorQ.has(qi) ? '▾' : '▸' }}</span>
            </div>
            <div class="errq-answer">
              <span class="errq-answer-label">正确答案：</span>
              <span class="errq-answer-val"><MarkdownKatex v-if="q.correctAnswer" :content="q.correctAnswer" inline /><template v-else>—</template></span>
            </div>
            <div v-if="expandedErrorQ.has(qi)" class="errq-detail">
              <div class="errq-students">
                <div v-for="(es, esi) in q.errorStudents" :key="esi" class="errq-student-row">
                  <span class="errq-sname">{{ es.name }}</span>
                  <span class="errq-sanswer">答：<MarkdownKatex v-if="es.student_answer" :content="es.student_answer" inline /><template v-else>—</template></span>
                  <img
                    v-if="es.job_id"
                    :src="`${API}/correction/image/${es.job_id}`"
                    class="errq-thumb"
                    loading="lazy"
                    @click.stop="openImage(`${API}/correction/image/${es.job_id}`)"
                  />
                </div>
                <div v-if="!q.errorStudents.length" class="errq-no-data">暂无学生错误详情</div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="classErrorQuestions.length > ERRQ_DEFAULT_SHOW" class="errq-toggle">
          <button class="errq-toggle-btn" @click="errqShowAll = !errqShowAll">
            {{ errqShowAll ? '收起' : `展开全部 ${classErrorQuestions.length} 道错题` }}
          </button>
        </div>
      </div>

      <!-- 模块 4：知识点掌握全景 -->
      <div v-if="topKnowledge.length" class="card">
        <div class="section-title">知识点掌握全景</div>
        <div class="kp-layers">
          <!-- 薄弱环节 -->
          <div v-if="knowledgeLayers.weak.length" class="kp-layer">
            <div class="kp-layer-header weak">
              <span class="kp-layer-dot" style="background:#ef4444" />
              薄弱环节
              <span class="kp-layer-count">{{ knowledgeLayers.weak.length }}</span>
            </div>
            <div class="kp-layer-list">
              <div v-for="k in knowledgeLayers.weak" :key="k.name" class="kp-layer-item">
                <span class="kp-name">{{ k.name }}</span>
                <div class="kp-bar-wrap"><div class="kp-bar" style="background:#ef4444" :style="{ width: pct(k.errorRate) }" /></div>
                <span class="kp-pct" style="color:#ef4444">{{ Math.round(k.errorRate * 100) }}%</span>
                <span class="kp-detail">{{ k.studentCount }}人涉及</span>
              </div>
            </div>
          </div>
          <!-- 需要加强 -->
          <div v-if="knowledgeLayers.needWork.length" class="kp-layer">
            <div class="kp-layer-header needwork">
              <span class="kp-layer-dot" style="background:#f59e0b" />
              需要加强
              <span class="kp-layer-count">{{ knowledgeLayers.needWork.length }}</span>
            </div>
            <div class="kp-layer-list">
              <div v-for="k in knowledgeLayers.needWork" :key="k.name" class="kp-layer-item">
                <span class="kp-name">{{ k.name }}</span>
                <div class="kp-bar-wrap"><div class="kp-bar" style="background:#f59e0b" :style="{ width: pct(k.errorRate) }" /></div>
                <span class="kp-pct" style="color:#f59e0b">{{ Math.round(k.errorRate * 100) }}%</span>
                <span class="kp-detail">{{ k.studentCount }}人涉及</span>
              </div>
            </div>
          </div>
          <!-- 掌握良好 -->
          <div v-if="knowledgeLayers.good.length" class="kp-layer">
            <div class="kp-layer-header good">
              <span class="kp-layer-dot" style="background:#3b82f6" />
              掌握良好
              <span class="kp-layer-count">{{ knowledgeLayers.good.length }}</span>
            </div>
            <div class="kp-layer-list">
              <div v-for="k in knowledgeLayers.good" :key="k.name" class="kp-layer-item">
                <span class="kp-name">{{ k.name }}</span>
                <div class="kp-bar-wrap"><div class="kp-bar" style="background:#3b82f6" :style="{ width: pct(k.errorRate) }" /></div>
                <span class="kp-pct" style="color:#3b82f6">{{ Math.round(k.errorRate * 100) }}%</span>
                <span class="kp-detail">{{ k.studentCount }}人涉及</span>
              </div>
            </div>
          </div>
          <!-- 完全掌握 -->
          <div v-if="knowledgeLayers.mastered.length" class="kp-layer">
            <div class="kp-layer-header mastered">
              <span class="kp-layer-dot" style="background:#16a34a" />
              完全掌握
              <span class="kp-layer-count">{{ knowledgeLayers.mastered.length }}</span>
            </div>
            <div class="kp-layer-tags">
              <span v-for="k in knowledgeLayers.mastered" :key="k.name" class="kp-mastered-tag">{{ k.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 模块 5：学生正确率排行（增强） -->
      <div v-if="rankedStudents.length" class="card">
        <div class="section-title">
          学生正确率排行
          <span class="median-hint">中位数 {{ Math.round(classMedianAccuracy * 100) }}%</span>
        </div>
        <table class="rank-table">
          <thead>
            <tr><th>#</th><th>学生</th><th>平均正确率</th><th>天数</th><th>正确/错误</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="s in rankedStudents" :key="s.student_id"
              :class="['rank-row', { 'median-below': s.avg_accuracy < classMedianAccuracy }]"
              @click="selectStudent(s.student_id)"
            >
              <td class="rank-num">{{ s.rank }}</td>
              <td class="rank-name">
                {{ s.name }}
                <span v-if="s.isStar" class="badge star-badge" title="满分之星">⭐</span>
                <span v-if="s.isPersistent" class="badge persist-badge" title="坚持之星">💪</span>
              </td>
              <td>
                <div class="rank-bar-wrap">
                  <div class="rank-bar" :style="{ width: pct(s.avg_accuracy), background: s.avg_accuracy >= 0.8 ? '#16a34a' : s.avg_accuracy >= 0.6 ? '#f59e0b' : '#ef4444' }" />
                  <span class="rank-pct">{{ pct(s.avg_accuracy) }}</span>
                </div>
              </td>
              <td>{{ s.total_days }}</td>
              <td>{{ s.total_correct }} / {{ s.total_errors }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 模块 6：AI 教研建议 -->
      <div v-if="classSummary" class="card advice-card">
        <div class="section-title">
          AI 教研建议
          <div v-if="teachingAdvice && !teachingAdviceLoading" class="advice-actions">
            <button class="advice-btn" @click="showAdviceInput = !showAdviceInput">重新生成</button>
          </div>
        </div>
        <div v-if="showAdviceInput" class="advice-input-area">
          <textarea v-model="teachingAdviceInstruction" class="advice-textarea" placeholder="补充指令（可选），例如：重点关注第3天的退步、建议增加某知识点的练习" rows="2" />
          <div class="advice-input-btns">
            <button class="advice-btn primary" :disabled="teachingAdviceLoading" @click="generateTeachingAdvice">
              {{ teachingAdviceLoading ? '生成中...' : '开始生成' }}
            </button>
            <button class="advice-btn" @click="showAdviceInput = false; teachingAdviceInstruction = ''">取消</button>
          </div>
        </div>
        <div v-if="teachingAdviceLoading" class="advice-loading">
          <div class="loading-spinner" />
          <span>{{ teachingAdvice ? '重新生成中...' : '正在分析班课数据，生成教研建议...' }}</span>
        </div>
        <div v-if="teachingAdvice" class="advice-content" :class="{ streaming: teachingAdviceLoading }">
          {{ teachingAdvice }}
        </div>
      </div>

      <div v-if="!classStudents.length && !loading" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p>暂无全班数据</p>
      </div>
    </template>

    <!-- 视频弹窗 -->
    <div v-if="showVideoModal" class="video-modal-overlay" @click.self="closeVideoModal">
      <div class="video-modal">
        <div class="video-modal-header">
          <span>学期总结视频</span>
          <button class="video-modal-close" @click="closeVideoModal">✕</button>
        </div>
        <video :src="videoUrl" controls class="video-player">
          您的浏览器不支持视频播放
        </video>
        <div class="video-modal-footer">
          <a :href="videoUrl" download class="video-download-btn">下载视频</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.analytics { padding: 16px 20px; max-width: 960px; margin: 0 auto; }

/* ===== 顶部控制栏 ===== */
.top-bar {
  display: flex; align-items: center; gap: 16px; margin-bottom: 16px; flex-wrap: wrap;
}
.view-tabs { display: flex; gap: 4px; }
.tab-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 7px 16px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; font-size: 13px; color: #6b7280; cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
  &.active {
    border-color: var(--color-primary); background: rgba(79,110,247,0.08);
    color: var(--color-primary); font-weight: 600;
  }
}
.level-pills { display: flex; gap: 4px; margin-left: auto; }
.pill {
  padding: 6px 14px; border: 1px solid #e5e7eb; border-radius: 20px;
  background: #fff; font-size: 12px; color: #6b7280; cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
  &.active {
    border-color: var(--color-primary); background: var(--color-primary);
    color: #fff; font-weight: 500;
  }
}

/* ===== 学生选择栏 ===== */
.student-bar {
  display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
}
.student-dropdown { position: relative; }
.student-trigger {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; cursor: pointer; font-size: 13px; min-width: 140px;
  transition: border-color 0.15s;
  &:hover { border-color: var(--color-primary); }
}
.student-name-text { font-weight: 500; color: #111827; }
.student-placeholder { color: #9ca3af; }
.dropdown-arrow { margin-left: auto; color: #9ca3af; font-size: 10px; }
.student-menu {
  position: absolute; top: 100%; left: 0; margin-top: 4px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 100;
  max-height: 240px; overflow-y: auto; min-width: 160px;
}
.student-option {
  padding: 8px 12px; font-size: 13px; cursor: pointer; color: #374151;
  &:hover { background: #f3f4f6; }
  &.active { background: rgba(79,110,247,0.08); color: var(--color-primary); font-weight: 500; }
  &.disabled { color: #9ca3af; cursor: default; }
}
.student-meta {
  font-size: 12px; color: #6b7280;
}
.trend-up { color: #16a34a; font-weight: 500; }
.trend-down { color: #ef4444; font-weight: 500; }
.trend-stable { color: #6b7280; }

/* ===== 学生档案头 ===== */
.profile-header {
  display: flex; align-items: center; gap: 16px;
  background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  padding: 20px 24px; margin-bottom: 16px;
}
.profile-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: linear-gradient(135deg, #4f6ef7, #7c3aed);
  color: #fff; font-size: 20px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.profile-info { flex: 1; }
.profile-name { font-size: 18px; font-weight: 600; color: #111827; }
.profile-detail { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.profile-stats {
  display: flex; gap: 24px;
}
.stat-item { text-align: center; }
.stat-value { display: block; font-size: 20px; font-weight: 700; color: #111827; }
.error-val { color: #ef4444; }
.stat-label { font-size: 11px; color: #9ca3af; }

/* ===== 阶段报告 ===== */
.report-section { margin-bottom: 16px; }
.report-cards { display: flex; gap: 10px; }
.report-card {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 14px 8px; border-radius: 10px; cursor: default;
  transition: all 0.15s;
}
.report-locked {
  background: #f9fafb; border: 1px solid #e5e7eb; color: #9ca3af;
  .report-icon { color: #d1d5db; }
}
.report-ready {
  background: #eff6ff; border: 2px dashed #93c5fd; color: #2563eb;
  .report-icon { color: #3b82f6; }
}
.report-card.clickable {
  cursor: pointer;
  &:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
}
.report-ready.clickable:hover { background: #dbeafe; border-color: #3b82f6; }
.report-generated {
  background: #eff6ff; border: 2px solid #3b82f6; color: #1d4ed8; cursor: pointer;
  .report-icon { color: #2563eb; }
  &:hover { background: #dbeafe; }
}
.report-label { font-size: 13px; font-weight: 600; }
.report-range { font-size: 10px; opacity: 0.7; }

/* ===== 通用卡片 ===== */
.card {
  background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  padding: 16px 20px; margin-bottom: 12px;
}
.section-title {
  font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 12px;
  display: flex; align-items: center; gap: 8px;
}
.card-count { font-weight: 400; color: #9ca3af; font-size: 12px; }

/* ===== 错题排序 ===== */
.error-sort-btns { margin-left: auto; display: flex; gap: 4px; }
.sort-pill {
  padding: 3px 10px; border: 1px solid #e5e7eb; border-radius: 12px;
  background: #fff; font-size: 11px; color: #6b7280; cursor: pointer;
  &:hover { border-color: var(--color-primary); }
  &.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
}

/* ===== 趋势图 ===== */
.trend-chart { display: flex; gap: 8px; }
.trend-y-axis {
  display: flex; flex-direction: column; justify-content: space-between;
  font-size: 10px; color: #aaa; width: 36px; text-align: right; padding: 0 4px;
  height: 140px;
}
.trend-bars { display: flex; gap: 2px; flex: 1; align-items: flex-end; height: 140px; }
.trend-bar-group { display: flex; flex-direction: column; align-items: center; flex: 1; }
.trend-bar-wrap { height: 120px; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.trend-bar {
  width: 80%; max-width: 24px; border-radius: 3px 3px 0 0; min-height: 2px;
  transition: height 0.3s; cursor: pointer;
  &:hover { opacity: 0.85; }
}
.trend-label { font-size: 10px; color: #aaa; margin-top: 4px; }

/* ===== 知识点 ===== */
.kp-list { display: flex; flex-direction: column; gap: 8px; }
.kp-item { display: flex; align-items: center; gap: 8px; }
.kp-name { font-size: 12px; width: 160px; min-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-bar-wrap { flex: 1; height: 16px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }
.kp-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
.error-bar { background: #ef4444; }
.kp-pct { font-size: 12px; font-weight: 500; width: 40px; text-align: right; }
.error-pct { color: #ef4444; }
.kp-detail { font-size: 11px; color: #aaa; width: 50px; }

/* ===== 错题 ===== */
.error-list { display: flex; flex-direction: column; gap: 10px; }
.error-item { border: 1px solid #f0f0f0; border-radius: 8px; padding: 10px 12px; }
.error-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.error-day { font-size: 11px; color: #fff; background: var(--color-primary); padding: 2px 8px; border-radius: 4px; }
.error-title { font-size: 12px; color: #6b7280; }
.error-tag { font-size: 10px; padding: 2px 6px; background: #f3f4f6; border-radius: 3px; color: #6b7280; }
.error-body { font-size: 13px; }
.error-answer { margin-bottom: 2px; }
.error-label { color: #6b7280; }
.error-wrong { color: #ef4444; }
.error-right { color: #16a34a; }
.error-analysis { font-size: 12px; color: #888; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #eee; }

/* ===== 模块 1：班课数据总览 ===== */
.class-stats-row {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;
  margin-bottom: 12px;
}
.cs-card {
  background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  padding: 14px 12px; text-align: center;
}
.cs-value { font-size: 22px; font-weight: 700; color: #111827; }
.cs-value.accent { color: #4f6ef7; }
.cs-value.star-val { color: #f59e0b; }
.cs-label { font-size: 11px; color: #9ca3af; margin-top: 2px; }

/* ===== 模块 2：全班趋势增强 ===== */
.class-trend-chart { display: flex; gap: 8px; }
.ct-y { height: 140px; }
.ct-right { flex: 1; display: flex; flex-direction: column; }
.ct-bar-area {
  position: relative; display: flex; gap: 2px; align-items: flex-end;
  height: 140px; flex-shrink: 0;
}
.ct-col { flex: 1; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
.ct-bar {
  width: 80%; max-width: 24px; border-radius: 3px 3px 0 0; min-height: 2px;
  transition: height 0.3s; cursor: pointer;
  &:hover { opacity: 0.85; }
}
.ct-bar.anomaly { box-shadow: inset 0 0 0 1px rgba(239,68,68,0.6); }
.avg-line-h {
  position: absolute; left: 0; right: 0; height: 0;
  border-top: 2px dashed rgba(79,110,247,0.4); z-index: 1; pointer-events: none;
}
.avg-line-label { font-weight: 400; font-size: 11px; color: #4f6ef7; }
.ct-labels { display: flex; gap: 2px; margin-top: 4px; }
.ct-label-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; }
.ct-count { font-size: 9px; color: #aaa; }
.ct-day { font-size: 10px; color: #aaa; }
.anomaly-hint { font-size: 11px; color: #9ca3af; margin-top: 8px; display: flex; align-items: center; gap: 6px; }
.anomaly-dot { width: 8px; height: 8px; border-radius: 2px; background: #ef4444; display: inline-block; }

/* ===== 模块 3：高频错题 ===== */
.errq-list { display: flex; flex-direction: column; gap: 8px; }
.errq-item { border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden; }
.errq-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  cursor: pointer; flex-wrap: wrap;
  &:hover { background: #fafafa; }
}
.errq-rank { font-size: 12px; font-weight: 700; color: #9ca3af; width: 20px; }
.errq-day { font-size: 11px; color: #fff; background: var(--color-primary); padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.errq-title { font-size: 13px; color: #374151; font-weight: 500; flex: 1; min-width: 80px; }
.errq-rate { font-size: 14px; font-weight: 700; }
.errq-count { font-size: 11px; color: #6b7280; white-space: nowrap; }
.errq-tag { font-size: 10px; padding: 2px 6px; background: #f3f4f6; border-radius: 3px; color: #6b7280; }
.errq-expand { font-size: 10px; color: #aaa; margin-left: auto; }
.errq-answer { padding: 0 12px 8px 40px; font-size: 12px; color: #6b7280; }
.errq-answer-label { color: #9ca3af; }
.errq-answer-val { color: #16a34a; font-weight: 500; }
.errq-detail { padding: 8px 12px 12px; border-top: 1px dashed #f0f0f0; background: #fafbfc; }
.errq-students { display: flex; flex-direction: column; gap: 6px; }
.errq-student-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.errq-sname { font-weight: 500; color: #374151; width: 60px; }
.errq-sanswer { color: #ef4444; }
.errq-thumb {
  width: 60px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #e5e7eb;
  cursor: pointer;
  &:hover { opacity: 0.8; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
}
.errq-no-data { font-size: 12px; color: #9ca3af; }
.errq-toggle { text-align: center; margin-top: 10px; }
.errq-toggle-btn {
  padding: 6px 20px; border: 1px solid #e5e7eb; border-radius: 6px;
  background: #fff; font-size: 12px; color: #6b7280; cursor: pointer;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
}

/* ===== 模块 4：知识点全景 ===== */
.kp-layers { display: flex; flex-direction: column; gap: 16px; }
.kp-layer-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; margin-bottom: 8px;
}
.kp-layer-dot { width: 8px; height: 8px; border-radius: 50%; }
.kp-layer-count { font-size: 11px; font-weight: 400; color: #9ca3af; margin-left: 4px; }
.kp-layer-list { display: flex; flex-direction: column; gap: 6px; }
.kp-layer-item { display: flex; align-items: center; gap: 8px; }
.kp-mastered-tag {
  display: inline-block; padding: 3px 10px; background: #ecfdf5; color: #16a34a;
  font-size: 11px; border-radius: 12px; border: 1px solid #bbf7d0;
}
.kp-layer-tags { display: flex; flex-wrap: wrap; gap: 6px; }

/* ===== 排行表（增强） ===== */
.rank-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rank-table th { text-align: left; padding: 6px 8px; font-weight: 500; color: #6b7280; font-size: 12px; border-bottom: 1px solid #f0f0f0; }
.rank-table td { padding: 8px; border-bottom: 1px solid #f5f5f5; }
.rank-row { cursor: pointer; &:hover { background: #fafafa; } }
.rank-row.median-below { opacity: 0.7; }
.rank-num { width: 30px; color: #aaa; }
.rank-name { font-weight: 500; }
.rank-bar-wrap { display: flex; align-items: center; gap: 8px; }
.rank-bar { height: 14px; border-radius: 3px; min-width: 4px; }
.rank-pct { font-size: 12px; font-weight: 500; }
.badge { font-size: 12px; margin-left: 4px; }
.median-hint { font-weight: 400; font-size: 11px; color: #9ca3af; margin-left: auto; }

/* ===== 模块 6：AI 教研建议 ===== */
.advice-card { position: relative; }
.advice-actions { margin-left: auto; }
.advice-btn {
  padding: 5px 14px; border: 1px solid #e5e7eb; border-radius: 6px;
  background: #fff; font-size: 12px; color: #374151; cursor: pointer;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
}
.advice-input-area { margin-bottom: 12px; }
.advice-textarea {
  width: 100%; padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 8px;
  font-size: 13px; resize: vertical; font-family: inherit; margin-bottom: 8px;
  &:focus { outline: none; border-color: var(--color-primary); }
}
.advice-input-btns { display: flex; gap: 8px; }
.advice-loading { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #9ca3af; padding: 16px 0; }
.advice-content {
  font-size: 13px; color: #374151; line-height: 1.8; white-space: pre-wrap;
  &.streaming { border-right: 2px solid var(--color-primary); animation: blink 0.8s infinite; }
}
@keyframes blink { 50% { border-color: transparent; } }
.advice-empty { font-size: 13px; color: #9ca3af; padding: 16px 0; text-align: center; }

/* ===== 空状态 / 加载 ===== */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 20px; color: #9ca3af;
  p { margin-top: 12px; font-size: 14px; }
}
.loading-state {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 60px 20px; color: #9ca3af; font-size: 14px;
}
.loading-spinner {
  width: 20px; height: 20px; border: 2px solid #e5e7eb; border-top-color: var(--color-primary);
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== 视频弹窗 ===== */
.video-modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center;
}
.video-modal {
  background: #fff; border-radius: 12px; overflow: hidden;
  width: 90vw; max-width: 860px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}
.video-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; font-size: 15px; font-weight: 600; color: #1f2937;
  border-bottom: 1px solid #f0f0f0;
}
.video-modal-close {
  background: none; border: none; font-size: 18px; color: #9ca3af;
  cursor: pointer; padding: 4px 8px; border-radius: 4px;
  &:hover { background: #f3f4f6; color: #374151; }
}
.video-player {
  width: 100%; display: block; background: #000;
  max-height: 70vh;
}
.video-modal-footer {
  padding: 12px 20px; display: flex; justify-content: flex-end;
  border-top: 1px solid #f0f0f0;
}
.video-download-btn {
  font-size: 13px; color: var(--color-primary); text-decoration: none;
  padding: 6px 16px; border: 1px solid var(--color-primary); border-radius: 6px;
  &:hover { background: var(--color-primary); color: #fff; }
}
</style>
