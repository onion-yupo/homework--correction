<script setup lang="ts">
import type { ReviewQuestion, ReviewAnswer, FlatQuestion } from '~/types'
import { useCorrection } from '~/stores/useCorrection'
import AnswerDetail from '~/components/AnswerDetail.vue'
import MarkdownKatex from '~/components/MarkdownKatex.vue'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

const props = defineProps<{
  reviewQuestions: ReviewQuestion[]
  questions: FlatQuestion[]
  totalCount: number
  correctCount: number
  wrongCount: number
  accuracy: number
}>()

const emit = defineEmits<{
  toggle: [id: string]
  hiddenChange: [hiddenIds: Set<string>]
}>()

const store = useCorrection()

const activeTab = ref<'review' | 'feedback'>('review')

/* ===== 批改复核 Tab ===== */

interface FlatSubItem {
  sectionTitle?: string
  subTitle: string
  answers: ReviewAnswer[]
}

const flatSubItems = computed(() => {
  const list: FlatSubItem[] = []
  for (const q of props.reviewQuestions) {
    let isFirst = true
    if (q.directAnswers.length) {
      list.push({ sectionTitle: q.title, subTitle: q.title, answers: q.directAnswers })
      isFirst = false
    }
    for (const sub of q.subQuestions) {
      list.push({
        sectionTitle: isFirst ? q.title : undefined,
        subTitle: sub.title,
        answers: sub.answers,
      })
      isFirst = false
    }
  }
  return list
})

function isAllCorrect(answers: ReviewAnswer[]) {
  return answers.length > 0 && answers.every(a => a.reviewedCorrect)
}

const collapsedSubs = ref<Set<number>>(new Set())

function toggleCollapse(idx: number) {
  if (collapsedSubs.value.has(idx)) collapsedSubs.value.delete(idx)
  else collapsedSubs.value.add(idx)
}

/* ===== 筛选 + 隐藏/展示 ===== */

type ReviewFilter = 'all' | 'wrong' | 'correct' | 'visible' | 'hidden'
const reviewFilter = ref<ReviewFilter>('all')

/** 被隐藏的答案 ID 集合（从 store 恢复初始值） */
const hiddenAnswerIds = ref<Set<string>>(new Set(store.persistedHiddenIds))

watch(() => store.persistedHiddenIds, (ids) => {
  if (ids.length > 0 && hiddenAnswerIds.value.size === 0) {
    hiddenAnswerIds.value = new Set(ids)
    emit('hiddenChange', hiddenAnswerIds.value)
  }
})

function toggleHideAnswer(answerId: string) {
  const s = new Set(hiddenAnswerIds.value)
  if (s.has(answerId)) s.delete(answerId)
  else s.add(answerId)
  hiddenAnswerIds.value = s
  emit('hiddenChange', s)
  store.setHiddenAnswerIds([...s])
}

/** 判断某个子题下是否所有答案都被隐藏 */
function isSubAllHidden(answers: ReviewAnswer[]) {
  return answers.length > 0 && answers.every(a => hiddenAnswerIds.value.has(a.id))
}

/** 排除隐藏答案后的统计数字 */
const visibleStats = computed(() => {
  const hidden = hiddenAnswerIds.value
  if (hidden.size === 0) {
    return { total: props.totalCount, correct: props.correctCount, wrong: props.wrongCount, accuracy: props.accuracy }
  }
  let total = 0
  let correct = 0
  for (const sub of flatSubItems.value) {
    for (const a of sub.answers) {
      if (hidden.has(a.id)) continue
      total++
      if (a.reviewedCorrect) correct++
    }
  }
  const wrong = total - correct
  const accuracy = total > 0 ? Math.round(correct / total * 100) : 100
  return { total, correct, wrong, accuracy }
})

/** 各筛选项的数量 */
const filterCounts = computed(() => {
  const total = flatSubItems.value.length
  const wrong = flatSubItems.value.filter(s => !isAllCorrect(s.answers)).length
  const correct = flatSubItems.value.filter(s => isAllCorrect(s.answers)).length
  const hidden = flatSubItems.value.filter(s => isSubAllHidden(s.answers)).length
  const visible = total - hidden
  return { all: total, wrong, correct, hidden, visible }
})

/** 过滤后的子题列表（保留原始索引） */
const filteredSubItems = computed(() => {
  return flatSubItems.value.map((sub, sIdx) => ({ sub, sIdx })).filter(({ sub, sIdx }) => {
    switch (reviewFilter.value) {
      case 'wrong': return !isAllCorrect(sub.answers)
      case 'correct': return isAllCorrect(sub.answers)
      case 'hidden': return isSubAllHidden(sub.answers)
      case 'visible': return !isSubAllHidden(sub.answers)
      default: return true
    }
  })
})

/* ===== 反馈建议 Tab：模块化卡片 ===== */

interface FeedbackModule {
  title: string
  content: string
  isStreaming: boolean
}

/**
 * 将流式 Markdown 按 ### 标题切分为独立模块
 * 流式过程中最后一个模块标记为 isStreaming
 */
const feedbackModules = computed<FeedbackModule[]>(() => {
  const raw = store.feedbackContent
  if (!raw) return []

  const parts = raw.split(/(?=^### )/m)
  const modules: FeedbackModule[] = []
  const isStreaming = store.feedbackStatus === 'streaming'

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    const titleMatch = part.match(/^### (.+?)[\n\r]/)
    if (titleMatch) {
      modules.push({
        title: titleMatch[1].trim(),
        content: part.slice(titleMatch[0].length).trim(),
        isStreaming: isStreaming && i === parts.length - 1,
      })
    }
    else {
      modules.push({
        title: '',
        content: part,
        isStreaming: isStreaming && i === parts.length - 1,
      })
    }
  }

  return modules
})

function handleGenerate() {
  const name = store.studentName || '同学'
  const grade = store.studentSemester || '二年级'
  store.generateFeedback(name, grade, hiddenAnswerIds.value.size > 0 ? hiddenAnswerIds.value : undefined)
}

function switchToFeedback() {
  activeTab.value = 'feedback'
  if (store.feedbackStatus === 'idle') {
    handleGenerate()
  }
}

/* ===== 模块编辑 & 重新生成 ===== */

/** 当前正在编辑的模块索引，-1 表示无 */
const editingModuleIdx = ref(-1)
const editingContent = ref('')

function startEdit(mIdx: number, content: string) {
  editingModuleIdx.value = mIdx
  editingContent.value = content
}

function cancelEdit() {
  editingModuleIdx.value = -1
  editingContent.value = ''
}

/**
 * 将 feedbackModules 的逻辑索引映射回 feedbackContent.split() 的物理索引
 * feedbackModules 跳过了空 part，所以需要重新计数
 */
function mapModuleToPartIndex(mIdx: number): { parts: string[], partIdx: number } | null {
  const parts = store.feedbackContent.split(/(?=^### )/m)
  let logicalIdx = 0
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].trim()) continue
    if (logicalIdx === mIdx) return { parts, partIdx: i }
    logicalIdx++
  }
  return null
}

/** 保存编辑：将修改后的模块内容拼接回 feedbackContent 并持久化 */
function saveEdit(mIdx: number) {
  const mapped = mapModuleToPartIndex(mIdx)
  if (!mapped) return

  const { parts, partIdx } = mapped
  const titleMatch = parts[partIdx].match(/^(### .+?[\n\r])/)
  parts[partIdx] = titleMatch
    ? titleMatch[1] + editingContent.value + '\n'
    : editingContent.value + '\n'

  store.feedbackContent = parts.join('')
  if (store.jobId) store.saveFeedback()

  editingModuleIdx.value = -1
  editingContent.value = ''
}

/** 当前正在重新生成的模块索引，-1 表示无 */
const regenModuleIdx = ref(-1)
const regenInstruction = ref('')
const regenLoading = ref(false)

function toggleRegen(mIdx: number) {
  if (regenModuleIdx.value === mIdx) {
    regenModuleIdx.value = -1
    regenInstruction.value = ''
  }
  else {
    regenModuleIdx.value = mIdx
    regenInstruction.value = ''
  }
}

/** 单模块重新生成：调用后端接口，流式替换该模块内容 */
async function regenModule(mIdx: number) {
  const mod = feedbackModules.value[mIdx]
  if (!mod || !store.jobId) return

  regenLoading.value = true

  try {
    const name = store.studentName || '同学'
    const grade = store.studentSemester || '二年级'
    const basePayload = store.buildFeedbackPayload(name, grade, hiddenAnswerIds.value.size > 0 ? hiddenAnswerIds.value : undefined)

    const res = await fetch(`${API_BASE}/feedback/regenerate-module`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        moduleTitle: mod.title,
        currentContent: mod.content,
        instruction: regenInstruction.value,
      }),
    })

    if (!res.ok) throw new Error('重新生成失败')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let newContent = ''

    // 先清空该模块内容
    replaceModuleContent(mIdx, '')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (chunk.includes('[DONE]')) {
        newContent += chunk.replace('[DONE]', '')
        break
      }
      newContent += chunk
      replaceModuleContent(mIdx, newContent)
    }

    if (store.jobId) {
      store.saveFeedback()
    }
  }
  catch (err: any) {
    console.error('[Regen]', err)
  }
  finally {
    regenLoading.value = false
    regenModuleIdx.value = -1
    regenInstruction.value = ''
  }
}

/** 替换指定模块的 content（保留标题），更新 feedbackContent */
function replaceModuleContent(mIdx: number, newContent: string) {
  const mapped = mapModuleToPartIndex(mIdx)
  if (!mapped) return

  const { parts, partIdx } = mapped
  const titleMatch = parts[partIdx].match(/^(### .+?[\n\r])/)
  parts[partIdx] = titleMatch
    ? titleMatch[1] + newContent + '\n'
    : newContent + '\n'

  store.feedbackContent = parts.join('')
}

/** 判断模块是否为"给家长的小提示"（兼容旧版"家长反馈话术"） */
function isParentMessage(mod: FeedbackModule) {
  return mod.title.includes('家长反馈话术') || mod.title.includes('给家长的小提示')
}

/** 判断模块是否为"加练题目"大模块 */
function isPracticeModule(mod: FeedbackModule) {
  return mod.title.includes('加练题目')
}

/** 去掉标题中的【推荐】用于显示 */
function cleanTitle(title: string) {
  return title.replace('【推荐】', '').trim()
}

interface PracticeSubSection {
  type: 'basic' | 'consolidate' | 'challenge'
  content: string
  recommended: boolean
}

/**
 * 从"加练题目"大模块的 content 中按子标题切分为三个难度区
 * 子标题格式：**基础巩固加练** / **巩固加练** / **挑战加练**（可能带【推荐】）
 */
function parsePracticeSections(content: string): PracticeSubSection[] {
  const pattern = /\*{0,2}(基础巩固加练|巩固加练|挑战加练)\s*(?:【推荐】|（推荐）|\(推荐\))?\s*\*{0,2}\s*(?:【推荐】|（推荐）|\(推荐\))?/g
  const anchors: { type: 'basic' | 'consolidate' | 'challenge', matchStart: number, contentStart: number, recommended: boolean }[] = []

  let m: RegExpExecArray | null
  while ((m = pattern.exec(content)) !== null) {
    const label = m[1]
    const type = label.includes('挑战') ? 'challenge' as const
      : label.includes('基础') ? 'basic' as const
        : 'consolidate' as const
    anchors.push({
      type,
      matchStart: m.index,
      contentStart: m.index + m[0].length,
      recommended: m[0].includes('推荐'),
    })
  }

  return anchors.map((a, i) => ({
    type: a.type,
    content: content.slice(a.contentStart, i + 1 < anchors.length ? anchors[i + 1].matchStart : content.length).trim(),
    recommended: a.recommended,
  }))
}

/**
 * 将加练子区的 content 按"答案"分割为题目和答案两部分
 */
function splitPracticeContent(content: string): { questions: string, answers: string } | null {
  const idx = content.search(/\*{0,2}答案[：:]\*{0,2}/)
  if (idx < 0) return null
  const questions = content.slice(0, idx).trim()
  const answers = content.slice(idx).trim()
  return { questions, answers }
}

/* ===== 加练拼盘：解析 + 勾选 + 导出 ===== */

interface PracticeItem {
  id: string
  type: 'basic' | 'consolidate' | 'challenge'
  typeLabel: string
  question: string
  answer: string
  selected: boolean
}

/**
 * 将加练模块的 content 解析为独立题目列表
 * 题目格式：1. xxx  2. xxx  答案：1. xxx  2. xxx
 * 选择题可能多行（题干 + A/B/C/D 选项）
 */
function parsePracticeItems(content: string, type: 'basic' | 'consolidate' | 'challenge', typeLabel: string, baseId: string): PracticeItem[] {
  const split = splitPracticeContent(content)
  if (!split) return []

  // 按题号切分题目（支持多行选择题）
  const qBlocks = splitByQuestionNumber(split.questions)
  const aRaw = split.answers.replace(/^\*{0,2}答案[：:]\*{0,2}\s*/i, '')
  const aBlocks = splitByQuestionNumber(aRaw)

  return qBlocks.map((q, i) => ({
    id: `${baseId}-${i}`,
    type,
    typeLabel,
    question: q.replace(/^\d+[.、．]\s*/, '').trim(),
    answer: (aBlocks[i] || '').replace(/^\d+[.、．]\s*/, '').trim(),
    selected: true,
  }))
}

/** 按题号（1. 2. 3.）切分文本，每个题目可能包含多行（如选择题选项） */
function splitByQuestionNumber(text: string): string[] {
  const lines = text.split(/\n/)
  const blocks: string[] = []
  let current = ''
  for (const line of lines) {
    if (/^\d+[.、．]\s*/.test(line.trim())) {
      if (current) blocks.push(current.trim())
      current = line
    } else if (current && line.trim()) {
      current += '\n' + line
    }
  }
  if (current) blocks.push(current.trim())
  return blocks
}

/** 从"加练题目"大模块中解析出所有子区的练习题 */
const practiceSections = computed(() => {
  const mod = feedbackModules.value.find(m => isPracticeModule(m))
  if (!mod) return []
  return parsePracticeSections(mod.content)
})

/** 从所有反馈模块中提取加练题目 */
const practiceItems = computed<PracticeItem[]>(() => {
  const items: PracticeItem[] = []
  for (const sec of practiceSections.value) {
    const label = sec.type === 'basic' ? '基础巩固' : sec.type === 'consolidate' ? '巩固加练' : '挑战加练'
    items.push(...parsePracticeItems(sec.content, sec.type, label, sec.type))
  }
  return items
})

/** 响应式的选中状态（独立于 computed，避免流式更新时重置） */
const practiceSelection = ref<Record<string, boolean>>({})

/** 初始化/同步选中状态 */
watch(practiceItems, (items) => {
  const sel = { ...practiceSelection.value }
  for (const item of items) {
    if (!(item.id in sel)) sel[item.id] = true
  }
  practiceSelection.value = sel
}, { immediate: true })

function togglePracticeItem(id: string) {
  practiceSelection.value[id] = !practiceSelection.value[id]
}

function selectAllPractice(type?: 'basic' | 'consolidate' | 'challenge') {
  const items = type ? practiceItems.value.filter(i => i.type === type) : practiceItems.value
  for (const item of items) practiceSelection.value[item.id] = true
}

function deselectAllPractice(type?: 'basic' | 'consolidate' | 'challenge') {
  const items = type ? practiceItems.value.filter(i => i.type === type) : practiceItems.value
  for (const item of items) practiceSelection.value[item.id] = false
}

const selectedPracticeCount = computed(() =>
  practiceItems.value.filter(i => practiceSelection.value[i.id]).length,
)

/** 加练模块在 feedbackModules 中的逻辑索引 */
const practiceModuleIdx = computed(() =>
  feedbackModules.value.findIndex(m => isPracticeModule(m)),
)

/** 导出模块为图片 */
const exportingModuleIdx = ref(-1)

/**
 * 去掉标题中的中文序号前缀（一、二、三...）
 */
function stripNumberPrefix(title: string): string {
  return title.replace(/^[一二三四五六七八九十]+、\s*/, '').replace('【推荐】', '').trim()
}

async function exportModuleImage(mIdx: number, mod: FeedbackModule) {
  exportingModuleIdx.value = mIdx

  const cleanName = stripNumberPrefix(mod.title)
  const fileName = `${store.studentName || '学生'}_${cleanName}.png`

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;background:#fff;padding:20px 24px;font-size:14px;line-height:1.8;color:#1a1a2e;z-index:-1;'

  const titleEl = document.createElement('div')
  titleEl.style.cssText = 'font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #4A90D9;'
  titleEl.textContent = cleanName
  container.appendChild(titleEl)

  const bodyEl = document.createElement('div')
  bodyEl.innerHTML = document.querySelector(`.fb-card-body-${mIdx}`)?.innerHTML || ''
  container.appendChild(bodyEl)

  document.body.appendChild(container)
  await nextTick()

  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })

    canvas.toBlob(async (blob) => {
      document.body.removeChild(container)
      if (!blob) { exportingModuleIdx.value = -1; return }
      try {
        if (navigator.clipboard?.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          copiedKey.value = `img-${mIdx}`
          setTimeout(() => { copiedKey.value = null }, 2000)
        }
        else {
          downloadBlob(blob, fileName)
        }
      }
      catch {
        downloadBlob(blob, fileName)
      }
      exportingModuleIdx.value = -1
    }, 'image/png')
  }
  catch {
    document.body.removeChild(container)
    exportingModuleIdx.value = -1
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** 导出选中题目为图片 */
const practiceExportRef = ref<HTMLDivElement>()
const isExporting = ref(false)

async function exportPracticeImage() {
  if (!practiceExportRef.value || selectedPracticeCount.value === 0) return
  isExporting.value = true
  await nextTick()

  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(practiceExportRef.value, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })

    canvas.toBlob(async (blob) => {
      if (!blob) { isExporting.value = false; return }
      const fileName = `${store.studentName || '学生'}_加练题.png`
      try {
        if (navigator.clipboard?.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          copiedKey.value = 'export'
          setTimeout(() => { copiedKey.value = null }, 2000)
        }
        else {
          downloadBlob(blob, fileName)
        }
      }
      catch {
        downloadBlob(blob, fileName)
      }
      isExporting.value = false
    }, 'image/png')
  }
  catch {
    isExporting.value = false
  }
}

/**
 * 兼容 HTTP 环境的复制函数
 * navigator.clipboard 仅在 HTTPS / localhost 下可用，HTTP 下降级为 execCommand
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    }
    catch { /* HTTPS 不可用，降级 */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  return ok
}

const copiedKey = ref<string | null>(null)

async function copyByKey(key: string, content: string) {
  await copyText(content)
  copiedKey.value = key
  setTimeout(() => { copiedKey.value = null }, 2000)
}

const feedbackScrollRef = ref<HTMLDivElement>()

watch(() => store.feedbackContent, () => {
  if (store.feedbackStatus === 'streaming' && feedbackScrollRef.value) {
    nextTick(() => {
      const el = feedbackScrollRef.value!
      el.scrollTop = el.scrollHeight
    })
  }
})
</script>

<template>
  <div class="review-panel">
    <!-- 统计条 -->
    <div class="stats">
      <div class="stat-item">
        <span class="stat-value">{{ visibleStats.total }}</span>
        <span class="stat-label">总题数</span>
      </div>
      <div class="stat-item stat-correct">
        <span class="stat-value">{{ visibleStats.correct }}</span>
        <span class="stat-label">正确</span>
      </div>
      <div class="stat-item stat-wrong">
        <span class="stat-value">{{ visibleStats.wrong }}</span>
        <span class="stat-label">错误</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ visibleStats.accuracy }}<small>%</small></span>
        <span class="stat-label">正确率</span>
      </div>
    </div>

    <!-- Tab 栏（状态标记内嵌在 Tab 内） -->
    <div class="tab-bar">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'review' }"
        @click="activeTab = 'review'"
      >
        <span>批改复核</span>
        <button
          class="tab-flag"
          :class="{ 'tab-flag--done': store.reviewed }"
          @click.stop="store.setFlag('reviewed', !store.reviewed)"
          :title="store.reviewed ? '点击取消复核' : '点击标记为已复核'"
        >
          <svg v-if="store.reviewed" class="flag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><polyline points="9 12 11.5 14.5 16 9" /></svg>
          <svg v-else class="flag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /></svg>
          {{ store.reviewed ? '已复核' : '待复核' }}
        </button>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'feedback' }"
        @click="switchToFeedback"
      >
        <span>反馈建议</span>
        <button
          class="tab-flag"
          :class="{ 'tab-flag--done': store.feedbacked }"
          @click.stop="store.setFlag('feedbacked', !store.feedbacked)"
          :title="store.feedbacked ? '点击取消反馈' : '点击标记为已反馈'"
        >
          <svg v-if="store.feedbacked" class="flag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><polyline points="9 12 11.5 14.5 16 9" /></svg>
          <svg v-else class="flag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /></svg>
          {{ store.feedbacked ? '已反馈' : '待反馈' }}
        </button>
      </button>
    </div>

    <!-- Tab 内容 -->
    <div class="tab-content">
      <!-- Tab 1: 批改复核 -->
      <div v-show="activeTab === 'review'" class="review-tab">
        <!-- 筛选栏 (sticky) -->
        <div class="filter-bar">
          <button
            v-for="f in ([
              { key: 'all', label: '全部' },
              { key: 'wrong', label: '错题' },
              { key: 'correct', label: '正确' },
              { key: 'visible', label: '已展示' },
              { key: 'hidden', label: '已隐藏' },
            ] as const)"
            :key="f.key"
            class="filter-btn"
            :class="{ 'filter-btn--active': reviewFilter === f.key }"
            @click="reviewFilter = f.key"
          >
            {{ f.label }}({{ filterCounts[f.key] }})
          </button>
        </div>

        <!-- 题目列表 -->
        <div class="content-scroll">
          <template v-for="{ sub, sIdx } in filteredSubItems" :key="sIdx">
            <div v-if="sub.sectionTitle" class="section-divider">
              <MarkdownKatex :content="sub.sectionTitle" inline />
            </div>
            <div
              class="sub-group"
              :class="{ 'sub-group--hidden': isSubAllHidden(sub.answers) }"
            >
              <div class="sub-header">
                <span
                  class="status-dot"
                  :class="{ correct: isAllCorrect(sub.answers), wrong: !isAllCorrect(sub.answers) }"
                />
                <span class="sub-title" @click="toggleCollapse(sIdx)"><MarkdownKatex :content="sub.subTitle" inline /></span>
                <span class="sub-expand" @click="toggleCollapse(sIdx)">{{ collapsedSubs.has(sIdx) ? '▸' : '▾' }}</span>
              </div>
              <div v-if="!collapsedSubs.has(sIdx)" class="sub-body">
                <div
                  v-for="(a, aIdx) in sub.answers"
                  :key="a.id"
                  :id="`answer-${a.id}`"
                  class="answer-card"
                  :class="{ 'answer-card--hidden': hiddenAnswerIds.has(a.id) }"
                >
                  <div class="answer-header">
                    <span>答案{{ aIdx + 1 }}</span>
                    <button
                      class="hide-btn"
                      :class="{ 'hide-btn--hidden': hiddenAnswerIds.has(a.id) }"
                      :title="hiddenAnswerIds.has(a.id) ? '点击展示' : '点击隐藏'"
                      @click.stop="toggleHideAnswer(a.id)"
                    >
                      {{ hiddenAnswerIds.has(a.id) ? '已隐藏' : '展示中' }}
                    </button>
                  </div>
                  <AnswerDetail :answer="a" :style="hiddenAnswerIds.has(a.id) ? 'opacity:0.4' : ''" @toggle="emit('toggle', a.id)" />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Tab 2: 反馈建议（模块化卡片） -->
      <div v-show="activeTab === 'feedback'" class="feedback-tab">
        <!-- 未生成 -->
        <div v-if="store.feedbackStatus === 'idle'" class="feedback-idle">
          <div class="idle-icon">💡</div>
          <p class="idle-desc">
            基于批改结果，AI 将自动生成整体情况反馈、书写评价、问题分析、改进计划、家长小提示和加练题目
          </p>
          <button class="generate-btn" @click="handleGenerate">
            生成反馈建议
          </button>
        </div>

        <!-- 加载中 -->
        <div v-else-if="store.feedbackStatus === 'loading'" class="feedback-loading">
          <div class="spinner-sm" />
          <span>正在分析批改结果...</span>
        </div>

        <!-- 模块化卡片（流式 / 完成） -->
        <template v-else-if="store.feedbackStatus === 'streaming' || store.feedbackStatus === 'done'">
          <div ref="feedbackScrollRef" class="content-scroll feedback-modules">
            <!-- 非加练模块（支持编辑 & 重新生成） -->
            <template v-for="(mod, mIdx) in feedbackModules" :key="mIdx">
              <div
                v-if="!isPracticeModule(mod)"
                class="fb-card"
                :class="{
                  'fb-card--parent': isParentMessage(mod),
                  'fb-card--regen': regenModuleIdx === mIdx && regenLoading,
                }"
              >
                <div class="fb-card__header">
                  <span class="fb-card__title">{{ cleanTitle(mod.title) || '反馈内容' }}</span>
                  <div v-if="!mod.isStreaming && mod.content && store.feedbackStatus === 'done'" class="fb-card__actions">
                    <button
                      class="fb-card__action-btn"
                      :class="{ copied: copiedKey === `mod-${mIdx}` }"
                      @click="copyByKey(`mod-${mIdx}`, mod.content)"
                    >
                      {{ copiedKey === `mod-${mIdx}` ? '✓ 已复制' : '复制' }}
                    </button>
                    <button
                      class="fb-card__action-btn"
                      :class="{ copied: copiedKey === `img-${mIdx}` }"
                      :disabled="exportingModuleIdx === mIdx"
                      @click="exportModuleImage(mIdx, mod)"
                    >
                      {{ copiedKey === `img-${mIdx}` ? '✓ 已复制' : exportingModuleIdx === mIdx ? '导出中...' : '导出图片' }}
                    </button>
                    <button
                      v-if="editingModuleIdx !== mIdx"
                      class="fb-card__action-btn"
                      @click="startEdit(mIdx, mod.content)"
                    >
                      编辑
                    </button>
                    <button
                      class="fb-card__action-btn"
                      :disabled="regenLoading"
                      @click="toggleRegen(mIdx)"
                    >
                      {{ regenModuleIdx === mIdx ? '取消' : '重新生成' }}
                    </button>
                  </div>
                </div>

                <!-- 编辑模式 -->
                <div v-if="editingModuleIdx === mIdx" class="fb-card__edit">
                  <textarea
                    v-model="editingContent"
                    class="fb-card__textarea"
                    rows="10"
                  />
                  <div class="fb-card__edit-actions">
                    <button class="fb-card__edit-btn fb-card__edit-btn--save" @click="saveEdit(mIdx)">保存</button>
                    <button class="fb-card__edit-btn fb-card__edit-btn--cancel" @click="cancelEdit">取消</button>
                  </div>
                </div>

                <!-- 正常渲染模式 -->
                <div v-else class="fb-card__body" :class="`fb-card-body-${mIdx}`">
                  <MarkdownKatex :content="mod.content" />
                  <span v-if="mod.isStreaming" class="cursor-blink">▍</span>
                </div>

                <!-- 重新生成面板 -->
                <div v-if="regenModuleIdx === mIdx && !regenLoading" class="fb-card__regen">
                  <textarea
                    v-model="regenInstruction"
                    class="fb-card__regen-input"
                    placeholder="输入补充指令，例如：语气更温和一些 / 这道题的错因应该是进退位问题..."
                    rows="2"
                  />
                  <button
                    class="fb-card__regen-btn"
                    :disabled="regenLoading"
                    @click="regenModule(mIdx)"
                  >
                    确认重新生成
                  </button>
                </div>
                <div v-if="regenModuleIdx === mIdx && regenLoading" class="fb-card__regen-loading">
                  <div class="spinner-sm" />
                  <span>正在重新生成...</span>
                </div>
              </div>
            </template>

            <!-- 加练拼盘（合并所有加练模块） -->
            <div
              v-if="practiceItems.length > 0 || (practiceModuleIdx >= 0 && regenModuleIdx === practiceModuleIdx)"
              class="fb-card fb-card--practice"
              :class="{ 'fb-card--regen': regenModuleIdx === practiceModuleIdx && regenLoading }"
            >
              <div class="fb-card__header">
                <span class="fb-card__title">六、加练题目</span>
                <div class="practice-actions">
                  <button class="practice-action-btn" @click="selectAllPractice()">全选</button>
                  <button class="practice-action-btn" @click="deselectAllPractice()">取消全选</button>
                  <button
                    class="practice-export-btn"
                    :disabled="selectedPracticeCount === 0 || isExporting"
                    @click="exportPracticeImage"
                  >
                    {{ copiedKey === 'export' ? '✓ 已复制到剪贴板' : isExporting ? '导出中...' : `导出选中题目 (${selectedPracticeCount})` }}
                  </button>
                  <button
                    v-if="store.feedbackStatus === 'done' && practiceModuleIdx >= 0"
                    class="fb-card__action-btn"
                    :disabled="regenLoading"
                    @click="toggleRegen(practiceModuleIdx)"
                  >
                    {{ regenModuleIdx === practiceModuleIdx ? '取消' : '重新生成' }}
                  </button>
                </div>
              </div>

              <!-- 按难度分组 -->
              <template v-for="group in (['basic', 'consolidate', 'challenge'] as const)" :key="group">
                <div
                  v-if="practiceItems.filter(i => i.type === group).length > 0"
                  class="practice-group"
                >
                  <div class="practice-group__header">
                    <span class="practice-group__label" :class="`practice-group__label--${group}`">
                      {{ group === 'basic' ? '基础巩固' : group === 'consolidate' ? '巩固加练' : '挑战加练' }}
                    </span>
                    <span
                      v-if="practiceSections.find(s => s.type === group && s.recommended)"
                      class="recommend-badge"
                    >推荐</span>
                    <div class="practice-group__actions">
                      <button class="practice-action-btn practice-action-btn--sm" @click="selectAllPractice(group)">全选</button>
                      <button class="practice-action-btn practice-action-btn--sm" @click="deselectAllPractice(group)">取消</button>
                    </div>
                  </div>
                  <div
                    v-for="item in practiceItems.filter(i => i.type === group)"
                    :key="item.id"
                    class="practice-item"
                    :class="{ 'practice-item--deselected': !practiceSelection[item.id] }"
                    @click="togglePracticeItem(item.id)"
                  >
                    <span class="practice-item__check">{{ practiceSelection[item.id] ? '☑' : '☐' }}</span>
                    <div class="practice-item__content">
                      <div class="practice-item__question">
                        <MarkdownKatex :content="item.question" />
                      </div>
                      <div v-if="item.answer" class="practice-item__answer">
                        答案：<MarkdownKatex :content="item.answer" inline />
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 加练模块重新生成面板 -->
              <div v-if="practiceModuleIdx >= 0 && regenModuleIdx === practiceModuleIdx && !regenLoading" class="fb-card__regen">
                <textarea
                  v-model="regenInstruction"
                  class="fb-card__regen-input"
                  placeholder="输入补充指令，例如：多出几道乘法口诀的题 / 难度再降低一些..."
                  rows="2"
                />
                <button
                  class="fb-card__regen-btn"
                  :disabled="regenLoading"
                  @click="regenModule(practiceModuleIdx)"
                >
                  确认重新生成
                </button>
              </div>
              <div v-if="practiceModuleIdx >= 0 && regenModuleIdx === practiceModuleIdx && regenLoading" class="fb-card__regen-loading">
                <div class="spinner-sm" />
                <span>正在重新生成...</span>
              </div>
            </div>

            <!-- 导出渲染区域（隐藏，仅用于截图） -->
            <div
              v-if="selectedPracticeCount > 0"
              ref="practiceExportRef"
              class="practice-export-area"
              :class="{ 'practice-export-area--visible': isExporting }"
            >
              <div class="practice-export__title">{{ store.studentName || '同学' }} 加练题</div>
              <template v-for="group in (['basic', 'consolidate', 'challenge'] as const)" :key="group">
                <template v-if="practiceItems.filter(i => i.type === group && practiceSelection[i.id]).length > 0">
                  <div class="practice-export__group">
                    {{ group === 'basic' ? '一、基础巩固' : group === 'consolidate' ? '二、巩固加练' : '三、挑战加练' }}
                  </div>
                  <div
                    v-for="(item, idx) in practiceItems.filter(i => i.type === group && practiceSelection[i.id])"
                    :key="item.id"
                    class="practice-export__item"
                  >
                    <span>{{ idx + 1 }}. </span>
                    <MarkdownKatex :content="item.question" />
                  </div>
                </template>
              </template>
            </div>
          </div>
          <div v-if="store.feedbackStatus === 'done'" class="feedback-bottom">
            <button class="action-btn" @click="handleGenerate">
              重新生成
            </button>
          </div>
        </template>

        <!-- 错误 -->
        <div v-else-if="store.feedbackStatus === 'fail'" class="feedback-error">
          <p class="error-text">{{ store.feedbackError }}</p>
          <button class="generate-btn" @click="handleGenerate">重试</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.review-panel {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow);
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 统计条 */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.stat-item {
  text-align: center;
  padding: 12px 6px;
  border-radius: var(--radius);
  background: var(--color-bg);

  &.stat-correct .stat-value { color: var(--color-success); }
  &.stat-wrong .stat-value { color: var(--color-danger); }
}

.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.2;

  small { font-size: 14px; font-weight: 500; }
}

.stat-label {
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

/* Tab 栏 */
.tab-bar {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
  padding: 4px 0 12px;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg, #f5f5f5);
  border: 2px solid var(--color-border, #e5e7eb);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;

  &:hover {
    color: var(--color-text);
    border-color: var(--color-primary);
    background: rgba(79, 110, 247, 0.04);
  }

  &.active {
    color: var(--color-primary);
    background: rgba(79, 110, 247, 0.08);
    border-color: var(--color-primary);
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(79, 110, 247, 0.12);
  }
}

.tab-flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
  line-height: 1.4;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  .flag-icon { flex-shrink: 0; }

  &:hover {
    background: #fee2e2;
    border-color: #f87171;
    box-shadow: 0 2px 6px rgba(220, 38, 38, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  &--done {
    background: #f0fdf4;
    color: #16a34a;
    border-color: #bbf7d0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);

    &:hover {
      background: #dcfce7;
      border-color: #86efac;
      box-shadow: 0 2px 6px rgba(22, 163, 74, 0.15);
    }
  }
}

/* Tab 内容 */
.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 12px 4px 4px 0;
}

/* ===== 批改复核 Tab 容器 ===== */
.review-tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  gap: 6px;
  padding: 8px 4px;
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.filter-btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;

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

/* ===== 批改复核 ===== */
.section-divider {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
  padding: 12px 2px 6px;
  line-height: 1.5;

  &:first-child { padding-top: 0; }
}

.sub-group {
  margin-bottom: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}

.sub-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;

  &:hover { background: var(--color-bg); }
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.correct { background: var(--color-success); }
  &.wrong { background: var(--color-danger); }
}

.sub-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  flex: 1;
  line-height: 1.5;
}

.hide-btn {
  font-size: 11px;
  padding: 2px 8px;
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

  &--hidden {
    background: var(--color-bg);
    color: var(--color-text-tertiary, #aaa);
    border-color: var(--color-text-tertiary, #ccc);
    border-style: dashed;
  }
}

.sub-group--hidden {
}

.sub-expand {
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.sub-body { padding: 0 14px 14px; }

.answer-card {
  background: var(--color-bg);
  border-radius: 6px;
  margin-bottom: 10px;
  overflow: hidden;
  transition: box-shadow 0.3s, opacity 0.2s;

  &:last-child { margin-bottom: 0; }

  &--hidden {
    border: 1px dashed var(--color-border);
  }
}

.answer-card.highlight {
  box-shadow: 0 0 0 2px var(--color-primary);
}

.answer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  background: rgba(0, 0, 0, 0.02);
}

/* ===== 反馈建议 ===== */
.feedback-tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.feedback-idle {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 24px;
}

.idle-icon { font-size: 48px; margin-bottom: 16px; }

.idle-desc {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin: 0 0 24px;
  max-width: 320px;
}

.generate-btn {
  padding: 12px 32px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  font-family: inherit;

  &:hover { opacity: 0.9; }
}

.feedback-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.spinner-sm {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 模块化卡片 */
.feedback-modules {
  padding: 12px 4px 4px 0;
}

.fb-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  margin-bottom: 12px;
  overflow: hidden;
  transition: border-color 0.2s;

  &:last-child { margin-bottom: 0; }

  &:hover { border-color: rgba(79, 110, 247, 0.3); }

  &--challenge {
    border-color: #f59e0b;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.04), rgba(234, 88, 12, 0.03));
  }

  &--consolidate {
    border-color: #10b981;
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(5, 150, 105, 0.03));
  }

  &--basic {
    border-color: #6366f1;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.04), rgba(79, 70, 229, 0.03));
  }

  &--parent {
    border-color: var(--color-primary);
    background: linear-gradient(135deg, rgba(79, 110, 247, 0.03), rgba(118, 75, 162, 0.03));
  }
}

.fb-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  background: rgba(0, 0, 0, 0.015);
}

.fb-card__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.recommend-badge {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  border-radius: 3px;
  line-height: 1.5;
  white-space: nowrap;
}

.fb-card__copy {
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &.copied {
    background: var(--color-success);
    border-color: var(--color-success);
    color: #fff;
  }
}

.fb-card__body {
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-text);
}


.fb-card__actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.fb-card__action-btn {
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;

  &:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.copied {
    background: var(--color-success);
    border-color: var(--color-success);
    color: #fff;
  }
}

.fb-card__edit {
  padding: 12px 14px;
}

.fb-card__textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px;
  font-size: 13px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  resize: vertical;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }
}

.fb-card__edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  justify-content: flex-end;
}

.fb-card__edit-btn {
  padding: 5px 16px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;

  &--save {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;

    &:hover { opacity: 0.9; }
  }

  &--cancel {
    background: var(--color-bg-card);
    color: var(--color-text-secondary);

    &:hover {
      border-color: var(--color-text-secondary);
    }
  }
}

.fb-card__regen {
  padding: 10px 14px;
  border-top: 1px dashed var(--color-border);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.fb-card__regen-input {
  flex: 1;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  resize: none;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  &::placeholder {
    color: var(--color-text-secondary);
    opacity: 0.6;
  }
}

.fb-card__regen-btn {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: opacity 0.2s;

  &:hover:not(:disabled) { opacity: 0.9; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.fb-card__regen-loading {
  padding: 12px 14px;
  border-top: 1px dashed var(--color-border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.fb-card--regen {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px rgba(139, 92, 246, 0.2);
}

/* ===== 加练拼盘 ===== */
.fb-card--practice {
  .fb-card__header {
    flex-wrap: wrap;
    gap: 8px;
  }
}

.practice-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.practice-action-btn {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &--sm {
    font-size: 10px;
    padding: 1px 6px;
  }
}

.practice-export-btn {
  padding: 3px 12px;
  font-size: 12px;
  border: none;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.practice-group {
  margin-bottom: 4px;

  &__header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px 4px;
  }

  &__label {
    font-size: 12px;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: 6px;

    &--basic { background: rgba(82, 196, 26, 0.1); color: var(--color-success); }
    &--consolidate { background: rgba(250, 173, 20, 0.1); color: #d48806; }
    &--challenge { background: rgba(245, 108, 108, 0.1); color: var(--color-danger); }
  }

  &__actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
}

.practice-item {
  display: flex;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  transition: all 0.15s;
  border-radius: 4px;

  &:hover {
    background: rgba(0, 0, 0, 0.02);
  }

  &--deselected {
    .practice-item__content {
      opacity: 0.4;
    }
  }

  &__check {
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--color-primary);
  }

  &__content {
    flex: 1;
    min-width: 0;
  }

  &__question {
    font-size: 13px;
    line-height: 1.7;
    color: var(--color-text);
  }

  &__answer {
    font-size: 12px;
    line-height: 1.6;
    color: var(--color-text-secondary);
    margin-top: 2px;
  }

}

/* 导出渲染区域（默认隐藏，导出时显示） */
.practice-export-area {
  position: fixed;
  left: -9999px;
  top: 0;
  width: 600px;
  padding: 24px;
  background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  &--visible {
    /* 导出时仍然不可见但需要在 DOM 中渲染 */
  }
}

.practice-export__title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin-bottom: 16px;
  text-align: center;
}

.practice-export__group {
  font-size: 14px;
  font-weight: 700;
  color: #333;
  margin: 12px 0 6px;
}

.practice-export__item {
  font-size: 14px;
  line-height: 1.8;
  color: #333;
  padding: 2px 0;
}

.cursor-blink {
  animation: blink 1s step-end infinite;
  color: var(--color-primary);
  font-weight: 700;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.feedback-bottom {
  flex-shrink: 0;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.action-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;

  &:hover {
    border-color: var(--color-text-secondary);
    color: var(--color-text);
  }
}

.feedback-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.error-text {
  font-size: 14px;
  color: var(--color-danger);
}
</style>
