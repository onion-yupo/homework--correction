<script setup lang="ts">
import { useCorrection } from '~/stores/useCorrection'
import CorrectionOverlay from '~/components/CorrectionOverlay.vue'
import ReviewPanel from '~/components/ReviewPanel.vue'

const API = import.meta.env.VITE_API_BASE || '/api'
const TOTAL_DAYS = 24

const route = useRoute()
const router = useRouter()
const store = useCorrection()

const rightPanelWidth = ref(480)
const isDragging = ref(false)
const resultSectionRef = ref<HTMLDivElement>()

/** image-card 的 padding + card-title 高度 */
const IMAGE_CARD_CHROME = 20 + 28 + 12 + 20

/** 学生信息 */
const displayName = computed(() => store.studentName || '未知学生')
const displaySemester = computed(() => store.studentSemester || '')

interface DayJob {
  jobId: string
  savedAt: string
  reviewed: boolean
  feedbacked: boolean
}

/** 全量学期数据：{ "二年级下": { "6": [...], "13": [...] }, ... } */
const allSemesters = ref<Record<string, Record<string, DayJob[]>>>({})
const semesterList = ref<string[]>([])
const currentSemester = ref('')

/** 当前学期的天数导航数据 */
const studentDays = computed(() => allSemesters.value[currentSemester.value] ?? {})
const currentDay = ref(0)
const currentImageIndex = ref(0)

/** 当前天数下的所有提交记录 */
const currentDayJobs = computed(() => studentDays.value[String(currentDay.value)] ?? [])

/** 当前天数下有多少次提交 */
const currentDayCount = computed(() => currentDayJobs.value.length)

/**
 * 加载完批改数据后，拉取该学生的天数分布（按学期分组）
 */
async function fetchStudentDays(studentName: string) {
  try {
    const res = await fetch(`${API}/jobs/by-student?studentName=${encodeURIComponent(studentName)}`)
    if (!res.ok) return
    const data = await res.json()
    allSemesters.value = data.semesters ?? {}
    semesterList.value = data.semesterList ?? []
  }
  catch { /* ignore */ }
}

/** 切换学期 */
async function switchSemester(semester: string) {
  if (semester === currentSemester.value) return
  currentSemester.value = semester

  const days = allSemesters.value[semester] ?? {}
  const dayKeys = Object.keys(days).map(Number).sort((a, b) => a - b)
  if (dayKeys.length > 0) {
    await switchToDay(dayKeys[0])
  }
}

/** 切换到指定天数（取该天第一个 job） */
async function switchToDay(day: number) {
  const dayJobs = studentDays.value[String(day)]
  if (!dayJobs?.length) return

  currentDay.value = day
  currentImageIndex.value = 0
  const targetJobId = dayJobs[0].jobId
  await store.loadFromServer(targetJobId)
  router.replace({ query: { jobId: targetJobId } })
}

/** 切换同天的不同提交（图片序号） */
async function switchToImage(index: number) {
  const dayJobs = currentDayJobs.value
  if (index < 0 || index >= dayJobs.length) return

  currentImageIndex.value = index
  const targetJobId = dayJobs[index].jobId
  await store.loadFromServer(targetJobId)
  router.replace({ query: { jobId: targetJobId } })
}

function calcDefaultSplit() {
  const { width: natW, height: natH } = store.imageNaturalSize
  if (!natW || !natH) return

  nextTick(() => {
    const container = resultSectionRef.value
    if (!container) return

    const totalWidth = container.clientWidth
    const availableHeight = container.clientHeight - IMAGE_CARD_CHROME
    const imageAspect = natW / natH
    const fittedImageWidth = availableHeight * imageAspect
    const leftColWidth = fittedImageWidth + 40
    const minRight = 320
    const newRight = Math.max(totalWidth - leftColWidth - 12, minRight)
    rightPanelWidth.value = Math.min(newRight, totalWidth - 360)
  })
}

function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  const startX = e.clientX
  const startWidth = rightPanelWidth.value

  function onMouseMove(ev: MouseEvent) {
    const container = resultSectionRef.value
    if (!container) return
    const containerWidth = container.clientWidth
    const delta = startX - ev.clientX
    const newWidth = Math.min(
      Math.max(startWidth + delta, 320),
      containerWidth - 360,
    )
    rightPanelWidth.value = newWidth
  }

  function onMouseUp() {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function goBack() {
  store.reset()
  router.push('/')
}

function handleToggle(id: string) {
  store.toggleCorrect(id)
}

/** 当 reviewed/feedbacked 变化时，同步更新天数导航中的小点 */
watch([() => store.reviewed, () => store.feedbacked], ([rev, fb]) => {
  const day = String(currentDay.value)
  const jobs = studentDays.value[day]
  if (!jobs) return
  const job = jobs[currentImageIndex.value]
  if (!job || job.jobId !== store.jobId) return
  job.reviewed = rev
  job.feedbacked = fb
})

/** 被隐藏的答案 ID 集合（从 ReviewPanel 传入，联动左侧标注） */
const hiddenAnswerIds = ref<Set<string>>(new Set())

/** 纯视觉：临时隐藏所有标注，不影响数据和持久化 */
const visuallyHideAll = ref(false)

watch(() => store.persistedHiddenIds, (ids) => {
  if (ids.length > 0) {
    hiddenAnswerIds.value = new Set(ids)
  }
}, { immediate: true })

function handleHiddenChange(ids: Set<string>) {
  hiddenAnswerIds.value = ids
  store.setHiddenAnswerIds([...ids])
}

/** 标注模式 */
const isAnnotating = ref(false)

function toggleAnnotateMode() {
  isAnnotating.value = !isAnnotating.value
}

function handleAddAnnotation(positions: number[], isCorrect: boolean) {
  store.addManualAnnotation(positions, isCorrect)
}

function handleRemoveAnnotation(id: string) {
  store.removeManualAnnotation(id)
}

function handleToggleAnnotation(id: string) {
  store.toggleManualAnnotation(id)
}


/** 纯视觉：全部显示/全部隐藏，不持久化、不影响统计 */
function toggleAllMarkers() {
  visuallyHideAll.value = !visuallyHideAll.value
}

/** 导出图片：截取当前带标注的作业图片 */
const overlayExportRef = ref<HTMLDivElement>()
const isExportingImage = ref(false)
const exportImageSuccess = ref(false)

async function exportOverlayImage() {
  if (!overlayExportRef.value) return
  isExportingImage.value = true
  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(overlayExportRef.value, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })
    canvas.toBlob(async (blob) => {
      if (!blob) { isExportingImage.value = false; return }
      try {
        if (navigator.clipboard?.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          exportImageSuccess.value = true
          setTimeout(() => { exportImageSuccess.value = false }, 2000)
        }
        else {
          downloadImageBlob(blob)
        }
      }
      catch {
        downloadImageBlob(blob)
      }
      isExportingImage.value = false
    }, 'image/png')
  }
  catch {
    isExportingImage.value = false
  }
}

function downloadImageBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.studentName || '学生'}_作业批改_第${currentDay.value || ''}天.png`
  a.click()
  URL.revokeObjectURL(url)
  exportImageSuccess.value = true
  setTimeout(() => { exportImageSuccess.value = false }, 2000)
}

function handleLocateAnswer(id: string) {
  const el = document.getElementById(`answer-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('highlight')
  setTimeout(() => el.classList.remove('highlight'), 1500)
}

function onPreviewImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  store.imageNaturalSize = {
    width: img.naturalWidth,
    height: img.naturalHeight,
  }
  calcDefaultSplit()
}

/**
 * 页面加载：
 * 1. 通过 jobId 加载当前作业
 * 2. 加载完成后拉取该学生的天数分布
 * 3. 定位当前天数和图片序号
 */
watch(() => store.jobStatus, async (status) => {
  if (status !== 'done') return
  if (!store.studentName) return

  await fetchStudentDays(store.studentName)

  currentSemester.value = store.studentSemester || semesterList.value[0] || ''

  const day = Number(store.studentDay) || 0
  currentDay.value = day

  const dayJobs = studentDays.value[String(day)] ?? []
  const idx = dayJobs.findIndex(j => j.jobId === store.jobId)
  currentImageIndex.value = idx >= 0 ? idx : 0

  if (store.feedbackStatus === 'idle') {
    const name = store.studentName || '同学'
    const grade = store.studentSemester || '二年级'
    store.generateFeedback(name, grade)
  }
}, { immediate: false })

onMounted(() => {
  const urlJobId = route.query.jobId as string | undefined
  if (urlJobId) {
    store.loadFromServer(urlJobId)
  }
})
</script>

<template>
  <div class="page">
    <header class="page-header">
      <nav class="breadcrumb">
        <router-link to="/dashboard" class="breadcrumb-link">工作台</router-link>
        <span class="breadcrumb-sep">/</span>
        <span v-if="displaySemester" class="breadcrumb-link" @click="goBack">{{ displaySemester }}</span>
        <span v-if="displaySemester" class="breadcrumb-sep">/</span>
        <span class="breadcrumb-current">{{ displayName }}</span>
      </nav>
      <button class="reset-btn" @click="goBack">
        返回列表
      </button>
    </header>

    <!-- 学生上下文栏 + 天数导航 -->
    <div v-if="store.jobStatus === 'done'" class="student-bar">
      <div class="student-info">
        <span class="student-name">{{ displayName }}</span>
        <template v-if="semesterList.length > 1">
          <button
            v-for="sem in semesterList"
            :key="sem"
            class="semester-btn"
            :class="{ 'semester-btn--active': sem === currentSemester }"
            @click="switchSemester(sem)"
          >
            {{ sem }}
          </button>
        </template>
        <span v-else-if="displaySemester" class="student-meta">{{ displaySemester }}</span>
      </div>
      <div class="day-nav">
        <button
          v-for="d in TOTAL_DAYS"
          :key="d"
          class="day-btn"
          :class="{
            'day-btn--active': d === currentDay,
            'day-btn--available': studentDays[String(d)]?.length,
            'day-btn--disabled': !studentDays[String(d)]?.length,
          }"
          :disabled="!studentDays[String(d)]?.length"
          @click="switchToDay(d)"
        >
          <span class="day-btn__num">{{ d }}</span>
          <div v-if="studentDays[String(d)]?.length" class="day-dots">
            <div
              v-for="(job, jIdx) in studentDays[String(d)]"
              :key="jIdx"
              class="day-dots__row"
            >
              <span class="day-dot" :class="job.reviewed ? 'day-dot--done' : 'day-dot--pending'" />
              <span class="day-dot" :class="job.feedbacked ? 'day-dot--done' : 'day-dot--pending'" />
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="store.jobStatus === 'uploading' || store.jobStatus === 'polling'" class="loading-section">
      <div class="loading-card">
        <div class="spinner" />
        <p class="loading-text">
          {{ store.jobStatus === 'uploading' ? '正在上传图片...' : '正在批改中，请稍候...' }}
        </p>
        <p class="loading-hint">AI 正在识别题目并批改，通常需要 10~30 秒</p>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-if="store.jobStatus === 'fail'" class="error-section">
      <div class="error-card">
        <p class="error-text">{{ store.errorMessage }}</p>
        <button class="retry-btn" @click="goBack">返回列表</button>
      </div>
    </div>

    <!-- 批改结果：左右布局 -->
    <div
      v-if="store.jobStatus === 'done'"
      ref="resultSectionRef"
      class="result-section"
      :class="{ dragging: isDragging }"
    >
      <div class="result-image-col">
        <div class="image-card">
          <div class="card-title-row">
            <h2 class="card-title">作业原图</h2>
            <div class="card-title-actions">
              <div v-if="currentDayCount > 1" class="image-switcher">
                <button
                  v-for="(_, idx) in currentDayJobs"
                  :key="idx"
                  class="img-idx-btn"
                  :class="{ 'img-idx-btn--active': idx === currentImageIndex }"
                  @click="switchToImage(idx)"
                >
                  {{ idx + 1 }}
                </button>
              </div>
              <button
                class="marker-toggle-btn"
                :class="{ 'marker-toggle-btn--active': isAnnotating }"
                @click="toggleAnnotateMode"
              >
                {{ isAnnotating ? '退出标注' : '人工标注' }}
              </button>
              <button class="marker-toggle-btn" @click="toggleAllMarkers">
                {{ visuallyHideAll ? '全部显示' : '全部隐藏' }}
              </button>
              <button
                class="fullscreen-btn"
                :disabled="isExportingImage"
                @click="exportOverlayImage"
              >
                {{ exportImageSuccess ? '✓ 已复制' : isExportingImage ? '导出中...' : '导出图片' }}
              </button>
            </div>
          </div>
          <div class="image-scroll">
            <img
              :src="store.imagePreviewUrl"
              style="display: none"
              @load="onPreviewImageLoad"
            />
            <div ref="overlayExportRef">
              <CorrectionOverlay
                :image-url="store.imagePreviewUrl"
                :questions="store.questions"
                :manual-annotations="store.manualAnnotations"
                :natural-width="store.imageNaturalSize.width"
                :natural-height="store.imageNaturalSize.height"
                :hidden-ids="hiddenAnswerIds"
                :hide-all="visuallyHideAll"
                :annotating="isAnnotating"
                @locate="handleLocateAnswer"
                @add-annotation="handleAddAnnotation"
                @remove-annotation="handleRemoveAnnotation"
                @toggle-annotation="handleToggleAnnotation"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="divider" @mousedown="onDividerMouseDown">
        <div class="divider-line" />
      </div>

      <div class="result-review-col" :style="{ width: `${rightPanelWidth}px` }">
        <ReviewPanel
          :review-questions="store.reviewQuestions"
          :questions="store.questions"
          :total-count="store.totalCount"
          :correct-count="store.correctCount"
          :wrong-count="store.wrongCount"
          :accuracy="store.accuracy"
          @toggle="handleToggle"
          @hidden-change="handleHiddenChange"
        />
      </div>
    </div>

  </div>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 20px 32px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;

  h1 {
    font-size: 22px;
    font-weight: 700;
  }
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.breadcrumb-link {
  color: var(--color-text-secondary);
  text-decoration: none;
  cursor: pointer;
  &:hover { color: var(--color-primary); }
}

.breadcrumb-sep {
  color: #d0d0d0;
  font-size: 12px;
}

.breadcrumb-current {
  color: var(--color-text);
  font-weight: 500;
}

.header-badge {
  padding: 3px 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.reset-btn {
  padding: 8px 24px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-text-secondary);
    color: var(--color-text);
  }
}

/* 学生上下文栏 + 天数导航 */
.student-bar {
  background: var(--color-bg-card);
  border-radius: var(--radius);
  padding: 12px 20px;
  margin-bottom: 16px;
  box-shadow: var(--shadow);
}

.student-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.student-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
}

.student-meta {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.semester-btn {
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &--active {
    background: var(--color-primary);
    color: #fff;
    border-color: var(--color-primary);
    font-weight: 600;
  }
}

/* 天数导航 */
.day-nav {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.day-btn {
  min-width: 32px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text);
  transition: all 0.15s;
  padding: 3px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;

  &--available {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: rgba(79, 110, 247, 0.04);

    &:hover {
      background: rgba(79, 110, 247, 0.1);
    }
  }

  &--active {
    background: var(--color-primary) !important;
    color: #fff !important;
    border-color: var(--color-primary) !important;
    font-weight: 700;

    .day-dot--pending {
      background: rgba(255, 255, 255, 0.35);
    }

    .day-dot--done {
      background: #73d13d;
    }
  }

  &--disabled {
    opacity: 0.35;
    cursor: not-allowed;
    border-color: var(--color-border);
    color: var(--color-text-secondary);
  }
}

.day-btn__num {
  line-height: 1;
}

.day-dots {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.day-dots__row {
  display: flex;
  gap: 2px;
  justify-content: center;
}

.day-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;

  &--pending {
    background: var(--color-border);
  }

  &--done {
    background: var(--color-success);
  }
}

.upload-section {
  padding-top: 60px;
}

.loading-section {
  display: flex;
  justify-content: center;
  padding-top: 80px;
}

.loading-card {
  text-align: center;
  background: var(--color-bg-card);
  padding: 60px 80px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 8px;
}

.loading-hint {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.error-section {
  display: flex;
  justify-content: center;
  padding-top: 80px;
}

.error-card {
  text-align: center;
  background: var(--color-bg-card);
  padding: 48px 64px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}

.error-text {
  font-size: 15px;
  color: var(--color-danger);
  margin-bottom: 20px;
}

.retry-btn {
  padding: 10px 36px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    background: var(--color-primary-hover);
  }
}

.result-section {
  display: flex;
  height: calc(100vh - 200px);

  &.dragging {
    cursor: col-resize;
    user-select: none;
  }
}

.result-image-col {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.image-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.card-title-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.marker-toggle-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: all 0.15s;
  font-family: inherit;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &--active {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;

    &:hover {
      filter: brightness(0.9);
      color: #fff;
    }
  }
}

.fullscreen-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: rgba(79, 110, 247, 0.04);
  }
}

.image-switcher {
  display: flex;
  gap: 4px;
}

.img-idx-btn {
  width: 26px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: all 0.15s;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  &--active {
    background: var(--color-primary);
    color: #fff;
    border-color: var(--color-primary);
    font-weight: 700;
  }

  &:hover:not(&--active) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
}

.image-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.divider {
  flex-shrink: 0;
  width: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  position: relative;
  z-index: 10;

  &:hover .divider-line,
  .dragging & .divider-line {
    background: var(--color-primary);
    opacity: 1;
  }
}

.divider-line {
  width: 3px;
  height: 40px;
  border-radius: 2px;
  background: var(--color-border);
  opacity: 0.6;
  transition: all 0.2s;
}

.result-review-col {
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
}
</style>
