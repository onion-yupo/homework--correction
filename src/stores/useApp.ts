/**
 * 全局应用状态 — 老师身份（含 OAuth 认证）、当前学期
 */
import { defineStore } from 'pinia'

const API = import.meta.env.VITE_API_BASE || '/api'

interface Teacher {
  id: string
  name: string
}

interface LoggedTeacher {
  teacherId: string
  feishuOpenId: string
  name: string
}

interface Cohort {
  id: string
  name: string
  term: string
  startDate?: string
  totalDays: number
}

interface Camp {
  id: string
  name: string
  subject: string
  cohorts: Cohort[]
}

interface Enrollment {
  teacher: Teacher
  terms: string[]
  termSemesters: Record<string, string[]>
  enrollments: Record<string, Record<string, { id: string; name: string }[]>>
}

export const useApp = defineStore('app', () => {
  /** 飞书 OAuth 登录态（null = 未登录，undefined = 尚未检查） */
  const loggedTeacher = ref<LoggedTeacher | null | undefined>(undefined)

  /** 是否已完成登录态初始化 */
  const authReady = ref(false)

  /** 检查登录状态（调用 /api/auth/me） */
  async function checkAuth(): Promise<boolean> {
    try {
      const resp = await fetch(`${API}/auth/me`, { credentials: 'include' })
      if (resp.ok) {
        const data = await resp.json()
        loggedTeacher.value = data.teacher
        authReady.value = true
        return true
      }
    } catch { /* 网络错误视为未登录 */ }
    loggedTeacher.value = null
    authReady.value = true
    return false
  }

  /** 跳转飞书登录 */
  function loginWithFeishu() {
    window.location.href = `${API}/auth/login`
  }

  /** 退出登录 */
  async function logout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
    loggedTeacher.value = null
    window.location.href = `${import.meta.env.BASE_URL}login`
  }

  /** 老师列表 */
  const teachers = ref<Teacher[]>([])

  /** 当前选中的老师 */
  const currentTeacherId = ref(localStorage.getItem('teacherId') || '')

  /** 当前选中的期 */
  const currentTerm = ref(localStorage.getItem('term') || '')

  /** 当前选中的营/期（新多营上下文） */
  const camps = ref<Camp[]>([])
  const currentCampId = ref(localStorage.getItem('campId') || '')
  const currentCohortId = ref(localStorage.getItem('cohortId') || '')

  /** 当前选中的学期 */
  const currentSemester = ref(localStorage.getItem('semester') || '')

  /** 当前老师的归属数据 */
  const enrollment = ref<Enrollment | null>(null)

  /** 可用的期列表 */
  const terms = computed(() => enrollment.value?.terms || [])

  /** 当前期下可用的学期列表 */
  const semesters = computed(() => {
    if (!enrollment.value || !currentTerm.value) return []
    return enrollment.value.termSemesters[currentTerm.value] || []
  })

  /** 当前期+学期下的学生列表 */
  const students = computed(() => {
    if (!enrollment.value || !currentTerm.value || !currentSemester.value) return []
    return enrollment.value.enrollments[currentTerm.value]?.[currentSemester.value] || []
  })

  /** 当前老师名称 */
  const currentTeacherName = computed(() => {
    return teachers.value.find(t => t.id === currentTeacherId.value)?.name || ''
  })

  const currentCamp = computed(() => camps.value.find(c => c.id === currentCampId.value) || null)
  const currentCampName = computed(() => currentCamp.value?.name || '计算营')
  const currentCohort = computed(() => currentCamp.value?.cohorts.find(c => c.id === currentCohortId.value) || null)

  /**
   * 持久化当前老师 ID
   */
  function persistTeacherId(teacherId: string) {
    currentTeacherId.value = teacherId
    localStorage.setItem('teacherId', teacherId)
  }

  /**
   * 初始化时优先选择有归属数据的老师。
   * 先尝试欣欣老师，再尝试当前列表中的其他老师，避免 localStorage 里残留了一个空老师导致整站无数据。
   */
  async function ensureTeacherWithEnrollment() {
    if (!teachers.value.length) return

    const preferred = teachers.value.find(t => t.id === 'teacher-ding')
    const orderedCandidates = [
      ...(preferred ? [preferred] : []),
      ...teachers.value.filter(t => t.id !== 'teacher-ding'),
    ]

    for (const teacher of orderedCandidates) {
      persistTeacherId(teacher.id)
      await loadEnrollment()
      if (enrollment.value?.terms?.length) return
    }

    // 所有老师都没有归属时，至少保留一个确定的老师并清空上下文，避免残留旧期数。
    persistTeacherId(orderedCandidates[0]?.id || '')
    setTerm('')
    setSemester('')
  }

  /** 带重试的 fetch 封装 */
  async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(url)
        if (resp.ok) return resp
      } catch { /* retry */ }
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay * (i + 1)))
    }
    return fetch(url)
  }

  /** 加载老师列表 */
  async function loadTeachers() {
    try {
      const resp = await fetchWithRetry(`${API}/teachers`)
      const data = await resp.json()
      teachers.value = data.teachers || []

      const currentExists = teachers.value.some(t => t.id === currentTeacherId.value)
      if (!currentExists) {
        persistTeacherId('')
      }

      if (!currentTeacherId.value) {
        await ensureTeacherWithEnrollment()
      } else {
        await loadEnrollment()
        if (!enrollment.value?.terms?.length) {
          await ensureTeacherWithEnrollment()
        }
      }
    } catch (e) {
      console.error('[useApp] 加载老师列表失败:', e)
    }
  }

  /** 加载当前老师可访问的营/期上下文 */
  async function loadCampContext() {
    try {
      const resp = await fetch(`${API}/context`, { credentials: 'include' })
      if (!resp.ok) return
      const data = await resp.json()
      camps.value = data.camps || []
      if (!camps.value.length) return

      const campExists = camps.value.some(c => c.id === currentCampId.value)
      if (!campExists) {
        currentCampId.value = camps.value[0].id
        localStorage.setItem('campId', currentCampId.value)
      }

      const camp = camps.value.find(c => c.id === currentCampId.value) || camps.value[0]
      const cohortExists = camp.cohorts.some(c => c.id === currentCohortId.value)
      if (!cohortExists) {
        currentCohortId.value = camp.cohorts[0]?.id || ''
        localStorage.setItem('cohortId', currentCohortId.value)
      }

      const cohort = camp.cohorts.find(c => c.id === currentCohortId.value) || camp.cohorts[0]
      if (cohort?.term && currentTerm.value !== cohort.term) {
        setTerm(cohort.term)
      }
    } catch (e) {
      console.error('[useApp] 加载营/期上下文失败:', e)
    }
  }

  function setCamp(campId: string) {
    currentCampId.value = campId
    localStorage.setItem('campId', campId)
    const camp = camps.value.find(c => c.id === campId)
    const firstCohort = camp?.cohorts[0]
    if (firstCohort) setCohort(firstCohort.id)
  }

  function setCohort(cohortId: string) {
    currentCohortId.value = cohortId
    localStorage.setItem('cohortId', cohortId)
    const cohort = camps.value.flatMap(c => c.cohorts).find(c => c.id === cohortId)
    if (cohort?.term) setTerm(cohort.term)
  }

  /** 切换老师 */
  async function setTeacher(teacherId: string) {
    persistTeacherId(teacherId)
    await loadEnrollment()
  }

  /** 切换期 */
  function setTerm(term: string) {
    currentTerm.value = term
    localStorage.setItem('term', term)
    loadTermStartDate()
    // 切换期后，检查当前学期是否在新期的可用列表中
    const availSemesters = enrollment.value?.termSemesters[term] || []
    if (!availSemesters.includes(currentSemester.value)) {
      setSemester(availSemesters[0] || '')
    }
  }

  /** 切换学期 */
  function setSemester(semester: string) {
    currentSemester.value = semester
    localStorage.setItem('semester', semester)
  }

  /** 当前期的起始日期（ISO 格式，如 '2026-04-01'） */
  const termStartDate = ref<string | null>(null)

  /** 加载当前期的起始日期 */
  async function loadTermStartDate() {
    if (!currentTeacherId.value || !currentTerm.value) {
      termStartDate.value = null
      return
    }
    try {
      const resp = await fetch(`${API}/dashboard/term-start?teacherId=${encodeURIComponent(currentTeacherId.value)}&term=${encodeURIComponent(currentTerm.value)}`)
      const data = await resp.json()
      termStartDate.value = data.startDate || null
    } catch {
      termStartDate.value = null
    }
  }

  /** 保存当前期的起始日期 */
  async function saveTermStartDate(startDate: string) {
    if (!currentTeacherId.value || !currentTerm.value) return
    await fetch(`${API}/dashboard/term-start`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId: currentTeacherId.value, term: currentTerm.value, startDate }),
    })
    termStartDate.value = startDate
  }

  /** 根据天数计算实际日期 */
  function dayToDate(day: number): Date | null {
    if (!termStartDate.value) return null
    const start = new Date(termStartDate.value + 'T00:00:00')
    start.setDate(start.getDate() + day - 1)
    return start
  }

  /** 加载当前老师的归属数据 */
  async function loadEnrollment() {
    if (!currentTeacherId.value) return
    try {
      const resp = await fetchWithRetry(`${API}/teachers/${currentTeacherId.value}/enrollments`)
      enrollment.value = await resp.json()

      // 如果当前期不在可用列表中，切换到第一个
      if (enrollment.value && !enrollment.value.terms.includes(currentTerm.value)) {
        setTerm(enrollment.value.terms[0] || '')
      } else if (currentTerm.value) {
        // 检查当前学期是否在当前期的可用列表中
        const availSemesters = enrollment.value?.termSemesters[currentTerm.value] || []
        if (!availSemesters.includes(currentSemester.value)) {
          setSemester(availSemesters[0] || '')
        }
      }
      await loadTermStartDate()
    } catch (e) {
      console.error('[useApp] 加载归属数据失败:', e)
    }
  }

  return {
    // 认证
    loggedTeacher,
    authReady,
    checkAuth,
    loginWithFeishu,
    logout,
    // 老师 / 班级数据
    teachers,
    currentTeacherId,
    camps,
    currentCampId,
    currentCohortId,
    currentCamp,
    currentCampName,
    currentCohort,
    currentTerm,
    currentSemester,
    enrollment,
    terms,
    semesters,
    students,
    currentTeacherName,
    termStartDate,
    loadTeachers,
    loadCampContext,
    setCamp,
    setCohort,
    setTeacher,
    setTerm,
    setSemester,
    loadEnrollment,
    loadTermStartDate,
    saveTermStartDate,
    dayToDate,
  }
})
