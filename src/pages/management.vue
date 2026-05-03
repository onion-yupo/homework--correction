<script setup lang="ts">
import { useApp } from '~/stores/useApp'

const API = import.meta.env.VITE_API_BASE || '/api'
const app = useApp()

interface StudentLink {
  studentId: string
  studentName: string
  semester: string
  term: string
  teacherName: string
  jobCount: number
  lastSubmittedAt?: string
  pendingReviewCount: number
  pendingFeedbackCount: number
  submittedToday: boolean
  submitUrl: string
}

interface Overview {
  currentTeacher: { id: string; name: string; role: string }
  selectedTeacherId: string
  term: string
  teachers: { id: string; name: string; role: string; feishu_open_id?: string }[]
  summary: {
    studentCount: number
    todaySubmittedCount: number
    pendingReviewCount: number
    pendingFeedbackCount: number
    submittedPendingCount: number
    needsDayCount: number
    failedCount: number
    noSubmitTodayCount: number
  }
  tasks: {
    pending: { jobId: string; studentName: string; semester: string; day: number | null; status: string; submittedAt: string; errorMessage?: string }[]
    noSubmitToday: StudentLink[]
  }
  links: { enrollUrl: string; publicSubmitUrl: string }
  students: StudentLink[]
}

const loading = ref(false)
const savingStudent = ref(false)
const savingTeacher = ref(false)
const proxySubmitting = ref('')
const taskActionLoading = ref('')
const copied = ref('')
const studentNotice = ref('')
const studentError = ref('')
const teacherError = ref('')
const overview = ref<Overview | null>(null)

const studentForm = reactive({
  studentName: '',
  semester: '',
  parentPhone: '',
})

const teacherForm = reactive({
  name: '',
  feishuOpenId: '',
  role: 'tutor',
})

const semesterOptions = ['一上', '一下', '二上', '二下', '三上', '三下', '四上', '四下', '五上', '五下', '六上', '六下']
let overviewRefreshTimer: ReturnType<typeof window.setInterval> | null = null

const isAdmin = computed(() => {
  const role = overview.value?.currentTeacher?.role
  return role === 'admin' || role === 'lecturer'
})

const currentTerm = computed(() => app.currentCohort?.term || app.currentTerm || '')

const todaySubmitRate = computed(() => {
  const summary = overview.value?.summary
  if (!summary?.studentCount) return '--'
  return `${Math.round(summary.todaySubmittedCount / summary.studentCount * 100)}%`
})

async function loadOverview() {
  if (!currentTerm.value) return
  if (loading.value) return
  loading.value = true
  try {
    const params = new URLSearchParams({ term: currentTerm.value })
    if (app.currentCampId) params.set('campId', app.currentCampId)
    if (app.currentCohortId) params.set('cohortId', app.currentCohortId)
    const resp = await fetch(`${API}/management/overview?${params.toString()}`, { credentials: 'include' })
    if (!resp.ok) throw new Error(await resp.text())
    overview.value = await resp.json()
  } finally {
    loading.value = false
  }
}

function refreshOverviewWhenVisible() {
  if (document.visibilityState === 'visible') {
    loadOverview()
  }
}

async function addStudent() {
  studentNotice.value = ''
  studentError.value = ''
  const studentName = studentForm.studentName.trim()
  const semester = studentForm.semester.trim()
  const parentPhone = studentForm.parentPhone.trim()
  if (!studentName || !semester || !parentPhone || !currentTerm.value) {
    studentError.value = '请填写学生姓名、家长手机号，并选择学期'
    return
  }
  savingStudent.value = true
  try {
    const resp = await fetch(`${API}/management/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        studentName,
        semester,
        parentPhone,
        term: currentTerm.value,
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || '添加失败')
    studentForm.studentName = ''
    studentForm.semester = ''
    studentForm.parentPhone = ''
    studentNotice.value = `已添加 ${studentName}，后续家长可用姓名和手机号验证提交作业`
    await loadOverview()
    await app.loadTeachers()
  } catch (e: any) {
    studentError.value = e.message || '添加失败，请重试'
  } finally {
    savingStudent.value = false
  }
}

async function addTeacher() {
  teacherError.value = ''
  if (!teacherForm.name.trim()) return
  savingTeacher.value = true
  try {
    const resp = await fetch(`${API}/management/teachers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(teacherForm),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || '保存失败')
    teacherForm.name = ''
    teacherForm.feishuOpenId = ''
    teacherForm.role = 'tutor'
    await loadOverview()
    await app.loadTeachers()
  } catch (e: any) {
    teacherError.value = e.message || '保存失败，请重试'
  } finally {
    savingTeacher.value = false
  }
}

async function copyText(text: string, key: string) {
  await navigator.clipboard.writeText(text)
  copied.value = key
  window.setTimeout(() => {
    if (copied.value === key) copied.value = ''
  }, 1600)
}

function openForm(url: string) {
  // 预览时使用当前前端同源路径打开，避免 localhost 绝对地址在 IDE 预览里变成白屏。
  const target = new URL(url, window.location.origin)
  window.open(`${target.pathname}${target.search}${target.hash}`, '_blank', 'noopener,noreferrer')
}

function dayLabel(day: number): string {
  if (day === 22) return '第一周易错点加练'
  if (day === 23) return '第二周易错点加练'
  if (day === 24) return '第三周易错点加练'
  return `第${day}天`
}

function taskStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '已提交，等待批改',
    processing: '批改中',
    fail: '批改失败',
    'needs-day': '待确认天数',
    'pending-review': '待批改',
    'pending-feedback': '待反馈',
  }
  return labels[status] || status
}

function taskDayLabel(day: number | null): string {
  return day ? dayLabel(day) : '天数待确认'
}

function formatTime(iso?: string): string {
  if (!iso) return '暂无'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function submitTokenFromUrl(url: string): string {
  return new URL(url, window.location.origin).pathname.split('/').pop() || ''
}

async function teacherSubmitHomework(student: StudentLink, e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  if (files.length > 9) {
    studentError.value = '一次最多代交 9 张作业图片'
    return
  }

  studentNotice.value = ''
  studentError.value = ''
  proxySubmitting.value = student.studentId
  try {
    const fd = new FormData()
    const semesters: string[] = []
    const days: string[] = []

    for (const [index, file] of files.entries()) {
      fd.append('images', file)

      let defaultSemester = student.semester
      let defaultDay = ''
      try {
        const visionFd = new FormData()
        visionFd.append('image', file)
        const visionResp = await fetch(`${API}/vision/analyze`, { method: 'POST', body: visionFd })
        if (visionResp.ok) {
          const data = await visionResp.json()
          if (data.semester) defaultSemester = data.semester
          if (data.day) defaultDay = String(data.day)
        }
      } catch {
        // 识别失败时由老师手动输入天数
      }

      const day = window.prompt(
        files.length > 1
          ? `请输入 ${student.studentName} 第 ${index + 1} 张作业是第几天`
          : `请输入 ${student.studentName} 本次作业是第几天`,
        defaultDay,
      )
      if (!day?.trim()) throw new Error('已取消代交作业')
      semesters.push(defaultSemester)
      days.push(day.trim())
    }

    fd.append('semesters', JSON.stringify(semesters))
    fd.append('days', JSON.stringify(days))

    const token = submitTokenFromUrl(student.submitUrl)
    const resp = await fetch(`${API}/submit/${token}`, { method: 'POST', body: fd })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || '代交失败')

    studentNotice.value = `已为 ${student.studentName} 代交 ${files.length} 份作业，稍后可在作业批改页查看`
    await loadOverview()
  } catch (err: any) {
    studentError.value = err.message || '代交失败，请重试'
  } finally {
    proxySubmitting.value = ''
  }
}

async function confirmTaskDay(task: Overview['tasks']['pending'][number]) {
  const day = window.prompt(`请输入 ${task.studentName} 这份作业是第几天`, task.day ? String(task.day) : '')
  if (!day?.trim()) return
  taskActionLoading.value = task.jobId
  try {
    const resp = await fetch(`${API}/jobs/${encodeURIComponent(task.jobId)}/day`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: day.trim(), semester: task.semester }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || '保存失败')
    await loadOverview()
  } catch (e: any) {
    studentError.value = e.message || '保存失败，请重试'
  } finally {
    taskActionLoading.value = ''
  }
}

async function retryTask(task: Overview['tasks']['pending'][number]) {
  taskActionLoading.value = task.jobId
  try {
    const resp = await fetch(`${API}/jobs/${encodeURIComponent(task.jobId)}/retry`, { method: 'POST' })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || '重试失败')
    await loadOverview()
  } catch (e: any) {
    studentError.value = e.message || '重试失败，请稍后再试'
  } finally {
    taskActionLoading.value = ''
  }
}

async function ignoreTask(task: Overview['tasks']['pending'][number]) {
  if (!window.confirm(`确认忽略 ${task.studentName} 的这条异常作业吗？`)) return
  taskActionLoading.value = task.jobId
  try {
    const resp = await fetch(`${API}/jobs/${encodeURIComponent(task.jobId)}/ignore`, { method: 'POST' })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || '忽略失败')
    await loadOverview()
  } catch (e: any) {
    studentError.value = e.message || '忽略失败，请稍后再试'
  } finally {
    taskActionLoading.value = ''
  }
}

onMounted(async () => {
  if (!app.authReady) await app.checkAuth()
  await app.loadCampContext()
  await app.loadTeachers()
  await loadOverview()
  overviewRefreshTimer = window.setInterval(refreshOverviewWhenVisible, 15_000)
  document.addEventListener('visibilitychange', refreshOverviewWhenVisible)
  window.addEventListener('focus', refreshOverviewWhenVisible)
})

onUnmounted(() => {
  if (overviewRefreshTimer) window.clearInterval(overviewRefreshTimer)
  document.removeEventListener('visibilitychange', refreshOverviewWhenVisible)
  window.removeEventListener('focus', refreshOverviewWhenVisible)
})

watch(() => [app.currentTerm, app.currentCampId, app.currentCohortId], () => {
  loadOverview()
})
</script>

<template>
  <div class="management-page">
    <section class="hero-card">
      <div>
        <p class="eyebrow">班主任工作台</p>
        <h1>{{ app.currentCampName }} · {{ currentTerm || '未选择期' }}</h1>
        <p class="sub">把今天要处理的学生、作业和家长链接放在一个页面，先跑通日常运营闭环。</p>
      </div>
      <button class="refresh-btn" :disabled="loading" @click="loadOverview">
        {{ loading ? '刷新中...' : '刷新数据' }}
      </button>
    </section>

    <section v-if="overview" class="metric-grid">
      <div class="metric-card">
        <span>服务学生</span>
        <strong>{{ overview.summary.studentCount }}</strong>
      </div>
      <div class="metric-card">
        <span>今日已提交</span>
        <strong>{{ overview.summary.todaySubmittedCount }}</strong>
      </div>
      <div class="metric-card muted">
        <span>今日未提交</span>
        <strong>{{ overview.summary.noSubmitTodayCount }}</strong>
      </div>
      <div class="metric-card blue">
        <span>今日提交率</span>
        <strong>{{ todaySubmitRate }}</strong>
      </div>
    </section>

    <section v-if="overview" class="grid-two">
      <div class="panel">
        <div class="panel-head">
          <h2>今日任务</h2>
          <span>{{ overview.tasks.pending.length }} 个任务</span>
        </div>
        <div v-if="overview.tasks.pending.length" class="task-list">
          <div v-for="task in overview.tasks.pending" :key="task.jobId" class="task-item">
            <div>
              <strong>{{ task.studentName }}</strong>
              <p>{{ task.semester }} · {{ taskDayLabel(task.day) }} · {{ taskStatusLabel(task.status) }}</p>
              <p v-if="task.errorMessage" class="task-error">{{ task.errorMessage }}</p>
            </div>
            <RouterLink
              v-if="task.status === 'pending-review' || task.status === 'pending-feedback'"
              class="text-link"
              :to="`/correction?jobId=${encodeURIComponent(task.jobId)}`"
            >
              去处理
            </RouterLink>
            <button v-else-if="task.status === 'needs-day'" class="text-btn" :disabled="taskActionLoading === task.jobId" @click="confirmTaskDay(task)">
              {{ taskActionLoading === task.jobId ? '保存中...' : '确认天数' }}
            </button>
            <span v-else-if="task.status === 'pending' || task.status === 'processing'" class="status-chip">
              {{ task.status === 'processing' ? '批改中' : '排队中' }}
            </span>
            <span v-else-if="task.status === 'fail'" class="task-actions">
              <button class="text-btn" :disabled="taskActionLoading === task.jobId" @click="retryTask(task)">重试</button>
              <button class="text-btn danger" :disabled="taskActionLoading === task.jobId" @click="ignoreTask(task)">忽略</button>
            </span>
          </div>
        </div>
        <div v-else class="empty">当前没有待批改/待反馈任务。</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>家长链接</h2>
          <span>入营 + 收作业</span>
        </div>
        <div class="link-box">
          <div>
            <strong>本期入营问卷链接</strong>
            <p>这是家长第一次沟通时填写的学生信息表单。</p>
          </div>
          <div class="link-actions">
            <button class="ghost-btn" @click="openForm(overview.links.enrollUrl)">打开表单</button>
            <button @click="copyText(overview.links.enrollUrl, 'enroll')">
              {{ copied === 'enroll' ? '已复制' : '复制链接' }}
            </button>
          </div>
        </div>
        <div class="link-box primary-link">
          <div>
            <strong>班级通用收作业链接</strong>
            <p>每天发到群里的统一入口，家长首次用学生姓名和手机号绑定。</p>
          </div>
          <div class="link-actions">
            <button class="ghost-btn" @click="openForm(overview.links.publicSubmitUrl)">打开表单</button>
            <button @click="copyText(overview.links.publicSubmitUrl, 'public-submit')">
              {{ copied === 'public-submit' ? '已复制' : '复制链接' }}
            </button>
          </div>
        </div>
        <div v-if="overview.tasks.noSubmitToday.length" class="missing-box">
          <strong>今日未提交学生</strong>
          <p>{{ overview.tasks.noSubmitToday.map(s => s.studentName).join('、') }}</p>
        </div>
      </div>
    </section>

    <section v-if="overview" class="panel">
      <div class="panel-head">
        <h2>学生与代交作业</h2>
        <span>{{ overview.students.length }} 人</span>
      </div>
      <form class="inline-form" @submit.prevent="addStudent">
        <input v-model="studentForm.studentName" placeholder="学生姓名" />
        <input v-model="studentForm.parentPhone" inputmode="tel" placeholder="家长手机号" />
        <select v-model="studentForm.semester">
          <option value="">选择学期</option>
          <option v-for="opt in semesterOptions" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <button type="submit" :disabled="savingStudent || !studentForm.studentName.trim() || !studentForm.parentPhone.trim() || !studentForm.semester">
          {{ savingStudent ? '添加中...' : '添加学生' }}
        </button>
      </form>
      <p v-if="studentNotice" class="form-notice ok">{{ studentNotice }}</p>
      <p v-if="studentError" class="form-notice error">{{ studentError }}</p>
      <div class="student-table">
        <div class="table-head">
          <span>学生</span>
          <span>学期</span>
          <span>最近提交</span>
          <span>待处理</span>
          <span>代交作业</span>
        </div>
        <div v-for="s in overview.students" :key="`${s.studentId}-${s.term}-${s.semester}`" class="table-row">
          <span>
            <strong>{{ s.studentName }}</strong>
            <em :class="{ ok: s.submittedToday }">{{ s.submittedToday ? '今日已交' : '今日未交' }}</em>
          </span>
          <span>{{ s.semester }}</span>
          <span>{{ formatTime(s.lastSubmittedAt) }}</span>
          <span>{{ s.pendingReviewCount }} 批改 / {{ s.pendingFeedbackCount }} 反馈</span>
          <span class="row-actions">
            <label :class="['small-btn', s.submittedToday ? 'ghost-btn' : '']">
              {{ proxySubmitting === s.studentId ? '上传中...' : (s.submittedToday ? '补传' : '代交作业') }}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                :disabled="!!proxySubmitting"
                @change="teacherSubmitHomework(s, $event)"
              />
            </label>
          </span>
        </div>
      </div>
    </section>

    <section v-if="overview" class="panel">
      <div class="panel-head">
        <h2>老师管理</h2>
        <span>{{ isAdmin ? '可新增老师' : '当前仅展示自己' }}</span>
      </div>
      <form v-if="isAdmin" class="inline-form" @submit.prevent="addTeacher">
        <input v-model="teacherForm.name" placeholder="老师姓名" />
        <input v-model="teacherForm.feishuOpenId" placeholder="飞书 open_id（可后补）" />
        <select v-model="teacherForm.role">
          <option value="tutor">辅导老师</option>
          <option value="lecturer">主讲</option>
          <option value="admin">管理员</option>
        </select>
        <button type="submit" :disabled="savingTeacher || !teacherForm.name.trim()">
          {{ savingTeacher ? '保存中...' : '新增老师' }}
        </button>
      </form>
      <p v-if="teacherError" class="form-notice error">{{ teacherError }}</p>
      <div class="teacher-list">
        <div v-for="t in overview.teachers" :key="t.id" class="teacher-card">
          <strong>{{ t.name }}</strong>
          <span>{{ t.role || 'tutor' }}</span>
          <p>{{ t.feishu_open_id || '未绑定飞书 open_id' }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.management-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
  color: #172033;
}

.hero-card,
.panel,
.metric-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
}

.hero-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
  margin-bottom: 18px;

  h1 {
    margin: 4px 0 8px;
    font-size: 28px;
  }
}

.eyebrow {
  margin: 0;
  color: #2563eb;
  font-weight: 700;
}

.sub {
  margin: 0;
  color: #64748b;
}

.refresh-btn,
.inline-form button,
.link-box button,
.small-btn {
  border: 0;
  border-radius: 999px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.ghost-btn {
  background: #eef4ff !important;
  color: #2563eb !important;
}

.refresh-btn {
  padding: 10px 18px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.metric-card {
  padding: 18px;

  span {
    display: block;
    color: #64748b;
    font-size: 13px;
  }

  strong {
    display: block;
    margin-top: 8px;
    font-size: 30px;
  }

  &.warn strong { color: #ea580c; }
  &.blue strong { color: #2563eb; }
  &.muted strong { color: #64748b; }
}

.grid-two {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
  margin-bottom: 18px;
}

.panel {
  padding: 20px;
  margin-bottom: 18px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;

  h2 {
    margin: 0;
    font-size: 18px;
  }

  span {
    color: #94a3b8;
    font-size: 13px;
  }
}

.task-list {
  display: grid;
  gap: 10px;
}

.task-item,
.link-box,
.missing-box,
.teacher-card {
  border: 1px solid #edf2f7;
  border-radius: 14px;
  background: #f8fafc;
  padding: 14px;
}

.task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;

  p {
    margin: 4px 0 0;
    color: #64748b;
  }
}

.text-link {
  color: #2563eb;
  font-weight: 700;
}

.text-btn {
  border: 0;
  background: transparent;
  color: #2563eb;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &.danger {
    color: #dc2626;
  }
}

.task-actions {
  display: flex;
  gap: 8px;
}

.task-error {
  color: #dc2626 !important;
  font-size: 12px;
}

.status-chip {
  padding: 5px 10px;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.link-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;

  p {
    margin: 4px 0 0;
    color: #64748b;
  }

  button {
    padding: 9px 14px;
    white-space: nowrap;
  }
}

.primary-link {
  margin-top: 12px;
  border-color: #bfdbfe;
  background: #eff6ff;
}

.link-actions,
.row-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.missing-box {
  margin-top: 12px;

  p {
    margin: 8px 0 0;
    color: #475569;
    line-height: 1.7;
  }
}

.inline-form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 10px;
  margin-bottom: 14px;

  input,
  select {
    border: 1px solid #dbe3ee;
    border-radius: 12px;
    padding: 10px 12px;
    outline: none;
  }

  button {
    padding: 0 18px;
  }
}

.form-notice {
  margin: -4px 0 14px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;

  &.ok {
    color: #166534;
    background: #dcfce7;
  }

  &.error {
    color: #b91c1c;
    background: #fee2e2;
  }
}

.student-table {
  border: 1px solid #edf2f7;
  border-radius: 14px;
  overflow: hidden;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 1.4fr 0.7fr 1fr 1fr 0.8fr;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
}

.table-head {
  background: #f8fafc;
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
}

.table-row {
  border-top: 1px solid #edf2f7;

  em {
    display: block;
    margin-top: 4px;
    color: #ea580c;
    font-size: 12px;
    font-style: normal;

    &.ok {
      color: #16a34a;
    }
  }
}

.small-btn {
  padding: 7px 12px;
  font-size: 12px;
}

.teacher-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.teacher-card {
  span {
    float: right;
    color: #2563eb;
    font-size: 12px;
    font-weight: 700;
  }

  p {
    margin: 8px 0 0;
    color: #64748b;
    font-size: 13px;
  }
}

.empty {
  padding: 28px;
  color: #94a3b8;
  text-align: center;
  background: #f8fafc;
  border-radius: 14px;
}

@media (max-width: 980px) {
  .metric-grid,
  .grid-two {
    grid-template-columns: 1fr;
  }

  .table-head,
  .table-row,
  .inline-form {
    grid-template-columns: 1fr;
  }
}
</style>
