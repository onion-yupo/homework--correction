<script setup lang="ts">
/**
 * 周学习报告 — A4 预览 + PDF 导出
 *
 * URL: /report?studentId=xxx&semester=xxx&term=xxx&week=1
 *
 * 报告结构（对标老师模板）：
 *   P1: 封面 + 基本信息 + 每周进步速览
 *   P2: 精彩表现（亮点 / 知识点 / 称赞 / 书写评价）
 *   P3: 易错汇总（题目 + 小技巧）
 *   P4: 学习建议（鼓励话语 / 成长空间 / 练习建议）+ 备注
 */
import { useApp } from '~/stores/useApp'

const API = import.meta.env.VITE_API_BASE || '/api'
const route = useRoute()
const router = useRouter()
const app = useApp()

const studentId = ref(route.query.studentId as string || '')
const semester = ref(route.query.semester as string || '')
const term = ref(route.query.term as string || app.currentTerm)
const week = ref(Number(route.query.week) || 1)

interface ReportData {
  meta: { studentName: string; semester: string; term: string; week: number; dayRange: [number, number]; generatedAt: string }
  stats: { totalDays: number; totalQuestions: number; avgAccuracy: number; perfectDays: number; totalCorrect: number; totalErrors: number }
  dailyData: { day: number; accuracy: number; totalQuestions: number; correctCount: number; errorCount: number; isPerfect: boolean }[]
  errors: { day: number; questionTitle: string; studentAnswer: string; correctAnswer: string; knowledgePoints: string[]; answerAnalysis: string }[]
  knowledge: { name: string; total: number; correct: number; accuracy: number }[]
}

const reportData = ref<ReportData | null>(null)
const generatedText = ref('')
const loading = ref(false)
const generating = ref(false)

const showInstruction = ref(false)
const instruction = ref('')

/** 解析 LLM 输出的 ===SECTION=== 区块 */
const sections = computed(() => {
  const text = generatedText.value
  const result: Record<string, string> = {}
  const markers = [
    'HIGHLIGHTS', 'KNOWLEDGE_TEXT', 'KNOWLEDGE', 'PRAISE', 'WRITING', 'ERROR_TIPS',
    'ENCOURAGEMENT', 'GROWTH', 'PRACTICE', 'REMARK',
    'SUGGESTIONS', 'SUMMARY',
  ]
  for (let i = 0; i < markers.length; i++) {
    const start = text.indexOf(`===${markers[i]}===`)
    if (start === -1) continue
    const contentStart = start + `===${markers[i]}===`.length
    let end = text.length
    for (let j = i + 1; j < markers.length; j++) {
      const nextStart = text.indexOf(`===${markers[j]}===`)
      if (nextStart !== -1) { end = nextStart; break }
    }
    result[markers[i]] = text.slice(contentStart, end).trim()
  }
  return result
})

/** 每日进步速览 */
const progressRows = computed(() => {
  if (!reportData.value?.dailyData) return []
  return reportData.value.dailyData.map((d: any) => ({
    day: dayLabel(d.day),
    total: d.totalQuestions,
    correct: d.correctCount,
    errors: d.errorCount,
    accuracy: d.accuracy,
  }))
})

function md(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
}

function parseList(raw: string | undefined, prefix: string): string[] {
  if (!raw) return []
  return raw.split('\n').filter(l => l.includes(prefix)).map(l => md(l.slice(l.indexOf(prefix) + prefix.length).trim()))
}

const highlights = computed(() => parseList(sections.value.HIGHLIGHTS, '[STAR]'))
const knowledgeTextItems = computed(() => {
  const newItems = parseList(sections.value.KNOWLEDGE_TEXT, '[DOT]')
  return newItems.length ? newItems : parseList(sections.value.KNOWLEDGE, '[DOT]')
})
const praiseItems = computed(() => parseList(sections.value.PRAISE, '[DOT]'))

const encouragement = computed(() => sections.value.ENCOURAGEMENT || '')
const growthItems = computed(() => parseList(sections.value.GROWTH, '[>>>]'))
const practiceItems = computed(() => parseList(sections.value.PRACTICE, '[>>>]'))
const legacySuggestions = computed(() => {
  if (growthItems.value.length || practiceItems.value.length) return []
  return parseList(sections.value.SUGGESTIONS, '[>>>]')
})
const remark = computed(() => sections.value.REMARK || sections.value.SUMMARY || '')

/** 书写评价 */
const writingEval = computed(() => {
  const raw = sections.value.WRITING
  if (!raw) return { dimensions: [] as { label: string; value: string }[], comment: '' }
  const lines = raw.split('\n').filter(l => l.trim())
  const dimensions: { label: string; value: string }[] = []
  let commentStart = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('|')) {
      const parts = lines[i].split('|').map(s => s.trim())
      if (parts.length >= 2) dimensions.push({ label: parts[0], value: parts[1] })
      commentStart = i + 1
    } else { break }
  }
  const comment = md(lines.slice(commentStart).join(' ').trim())
  return { dimensions, comment }
})

/** 易错汇总（简化：只有题目 + 小技巧） */
interface ErrorTip { title: string; question: string; technique: string }
const errorTips = computed(() => {
  const raw = sections.value.ERROR_TIPS
  if (!raw) return []
  const blocks = raw.split('###').filter(b => b.trim())
  return blocks.map(block => {
    const lines = block.split('\n').filter(l => l.trim())
    const rawTitle = lines[0]?.trim().replace(/[·・]\s*本题\s*$/, '') || ''
    const find = (prefix: string) => lines.find(l => l.trim().startsWith(prefix))?.trim().slice(prefix.length).trim() || ''
    return {
      title: md(rawTitle),
      question: md(find('题目：') || find('题目:')),
      technique: md(find('[技巧]')),
    }
  }).filter(t => t.title)
})

function dayLabel(d: number): string {
  if (d === 22) return '第一周易错点加练'
  if (d === 23) return '第二周易错点加练'
  if (d === 24) return '第三周易错点加练'
  return `第${d}天`
}

function pct(v: number) { return `${Math.round(v * 100)}%` }

function writingIcon(label: string): string {
  if (label.includes('整体')) return '📝'
  if (label.includes('清晰')) return '👁'
  return '✨'
}

async function loadOrGenerate() {
  if (!studentId.value || !semester.value || !term.value) return
  loading.value = true
  try {
    const resp = await fetch(`${API}/report/weekly?studentId=${encodeURIComponent(studentId.value)}&semester=${encodeURIComponent(semester.value)}&term=${encodeURIComponent(term.value)}&week=${week.value}`)
    const data = await resp.json()
    if (data.exists && data.content) {
      reportData.value = data.content
      generatedText.value = data.content.generatedText || ''
      loading.value = false
      return
    }
  } catch { /* fall through */ }
  await generateReport()
}

async function generateReport() {
  if (!studentId.value || !semester.value || !term.value) return
  loading.value = true
  generating.value = true
  generatedText.value = ''
  reportData.value = null

  const payload: any = { studentId: studentId.value, semester: semester.value, term: term.value, week: week.value }
  if (instruction.value.trim()) payload.instruction = instruction.value.trim()

  try {
    const resp = await fetch(`${API}/report/generate-weekly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '请求失败' }))
      alert(err.error || '生成失败')
      loading.value = false
      generating.value = false
      return
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      if (!reportData.value && buf.includes('\n')) {
        const idx = buf.indexOf('\n')
        const firstLine = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (firstLine.startsWith('__DATA__')) {
          try { reportData.value = JSON.parse(firstLine.slice(8)) } catch { /* skip */ }
        }
      }

      if (reportData.value) {
        const cleanBuf = buf.replace('[DONE]', '')
        if (cleanBuf.trim().length > 0 && loading.value) {
          loading.value = false
        }
        generatedText.value = cleanBuf
      }
    }
  } catch (e) {
    console.error('[Report] 生成失败:', e)
    alert('报告生成失败，请重试')
  } finally {
    generating.value = false
    loading.value = false
  }
}

const exporting = ref(false)
async function exportPDF() {
  if (!studentId.value || !semester.value || !term.value) return
  exporting.value = true
  try {
    const url = `${API}/report/export-pdf?studentId=${encodeURIComponent(studentId.value)}&semester=${encodeURIComponent(semester.value)}&term=${encodeURIComponent(term.value)}&week=${week.value}`
    const resp = await fetch(url)
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '导出失败' }))
      alert(err.error || '导出失败')
      return
    }
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const disposition = resp.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename\*?=(?:UTF-8'')?(.+)/i)
    a.download = match ? decodeURIComponent(match[1]) : `周报_第${week.value}周.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
  } catch (e) {
    console.error('[Report] PDF导出失败:', e)
    alert('PDF导出失败，请重试')
  } finally {
    exporting.value = false
  }
}

function goBack() {
  router.push(`/analytics?studentId=${studentId.value}&semester=${encodeURIComponent(semester.value)}`)
}

onMounted(() => {
  if (studentId.value && semester.value && term.value) {
    loadOrGenerate()
  }
})
</script>

<template>
  <div class="report-container">
    <!-- 工具栏 -->
    <div class="toolbar no-print">
      <button class="tool-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        返回学情
      </button>
      <span class="toolbar-title">周学习报告预览</span>
      <button v-if="reportData && !generating" class="tool-btn regenerate" @click="showInstruction = !showInstruction">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        重新生成
      </button>
      <button v-if="reportData && !generating" class="tool-btn primary" :disabled="exporting" @click="exportPDF">
        <template v-if="exporting">
          <div class="loading-spinner small" /> 正在生成 PDF...
        </template>
        <template v-else>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          导出 PDF
        </template>
      </button>
    </div>

    <!-- 补充指令 -->
    <div v-if="showInstruction" class="instruction-panel no-print">
      <textarea v-model="instruction" class="instruction-input" placeholder="输入补充指令，例如：语气更活泼一些、多强调某知识点..." rows="2" />
      <div class="instruction-actions">
        <button class="tool-btn" @click="showInstruction = false">取消</button>
        <button class="tool-btn primary" @click="showInstruction = false; generateReport()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          带指令重新生成
        </button>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner" />
      <p>正在聚合数据并生成报告...</p>
    </div>

    <!-- ===== 报告正文 ===== -->
    <template v-if="reportData && !loading">
      <!-- P1: 封面 + 基本信息 + 每周进步速览 -->
      <div class="page">
        <div class="cover compact">
          <img src="/logo-white.png" alt="洋葱学园" class="cover-logo" />
          <div class="cover-week-num">{{ reportData.meta.week }}</div>
          <div class="cover-week-label">WEEK</div>
          <h1 class="cover-title">计算练习学习报告</h1>
          <p class="cover-meta">{{ reportData.meta.semester }} · {{ reportData.meta.studentName }}</p>
        </div>

        <div class="section">
          <div class="section-header"><span class="section-num">1</span> 基本信息</div>
          <div class="info-grid">
            <div class="info-card">
              <div class="info-label">统计周期</div>
              <div class="info-value small">{{ dayLabel(reportData.meta.dayRange[0]) }} ~ {{ dayLabel(reportData.meta.dayRange[1]) }}</div>
            </div>
            <div class="info-card">
              <div class="info-label">练习天数</div>
              <div class="info-value">{{ reportData.stats.totalDays }}天</div>
            </div>
            <div class="info-card">
              <div class="info-label">题目总数</div>
              <div class="info-value">{{ reportData.stats.totalQuestions }}</div>
            </div>
            <div class="info-card">
              <div class="info-label">正确数</div>
              <div class="info-value">{{ reportData.stats.totalCorrect }}</div>
            </div>
            <div class="info-card highlight">
              <div class="info-label">总体正确率</div>
              <div class="info-value">{{ pct(reportData.stats.avgAccuracy) }}</div>
            </div>
          </div>
        </div>

        <div v-if="progressRows.length" class="section progress-section">
          <div class="section-header sub">📊 每周进步速览</div>
          <table class="progress-table">
            <thead>
              <tr><th>天</th><th>题数</th><th>正确</th><th>错误</th><th>正确率</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in progressRows" :key="i">
                <td class="day-col">{{ row.day }}</td>
                <td>{{ row.total }}</td>
                <td>{{ row.correct }}</td>
                <td>{{ row.errors }}</td>
                <td><span :class="['accuracy-tag', row.accuracy >= 1 ? 'tag-perfect' : row.accuracy >= 0.9 ? 'tag-great' : row.accuracy >= 0.8 ? 'tag-ok' : 'tag-warn']">{{ pct(row.accuracy) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- P2: 精彩表现 -->
      <div class="page">
        <div class="section">
          <div class="section-header"><span class="section-num">2</span> 精彩表现</div>

          <div v-if="highlights.length" class="sub-block">
            <h4 class="sub-title">⭐ 本周亮点</h4>
            <ul class="highlight-list">
              <li v-for="(h, i) in highlights" :key="'h'+i" v-html="h" />
            </ul>
          </div>

          <div v-if="knowledgeTextItems.length" class="sub-block">
            <h4 class="sub-title">📖 掌握的知识点</h4>
            <ul class="normal-list">
              <li v-for="(k, i) in knowledgeTextItems" :key="'k'+i" v-html="k" />
            </ul>
          </div>

          <div v-if="praiseItems.length" class="sub-block">
            <h4 class="sub-title">👍 值得称赞的细节</h4>
            <ul class="normal-list">
              <li v-for="(p, i) in praiseItems" :key="'p'+i" v-html="p" />
            </ul>
          </div>

          <div v-if="writingEval.dimensions.length" class="sub-block writing-block">
            <h4 class="sub-title">✍️ 书写评价</h4>
            <div class="writing-cards">
              <div v-for="d in writingEval.dimensions" :key="d.label" class="writing-card">
                <div class="wc-icon">{{ writingIcon(d.label) }}</div>
                <div class="wc-value">{{ d.value }}</div>
                <div class="wc-label">{{ d.label }}</div>
              </div>
            </div>
            <p v-if="writingEval.comment" class="writing-comment" v-html="writingEval.comment" />
          </div>
        </div>
      </div>

      <!-- P3: 易错汇总 -->
      <div v-if="errorTips.length" class="page">
        <div class="section">
          <div class="section-header"><span class="section-num">3</span> 易错汇总</div>
          <div v-for="(tip, i) in errorTips" :key="i" class="error-tip-card">
            <div class="et-header">
              <span class="et-num">{{ i + 1 }}</span>
              <span class="et-title" v-html="tip.title" />
            </div>
            <div v-if="tip.question" class="et-question">
              <strong>题目：</strong><span v-html="tip.question" />
            </div>
            <div v-if="tip.technique" class="et-technique">
              <span class="et-bulb">💡</span>
              <span v-html="tip.technique" />
            </div>
          </div>
        </div>
      </div>

      <!-- P4: 学习建议 + 备注 -->
      <div class="page">
        <div v-if="encouragement || growthItems.length || practiceItems.length || legacySuggestions.length" class="section">
          <div class="section-header"><span class="section-num">4</span> 学习建议</div>

          <div v-if="encouragement" class="suggest-sub">
            <h4 class="suggest-sub-title">💪 鼓励话语</h4>
            <p class="encourage-text" v-html="md(encouragement)" />
          </div>

          <div v-if="growthItems.length" class="suggest-sub">
            <h4 class="suggest-sub-title">🌱 成长空间</h4>
            <div v-for="(g, i) in growthItems" :key="'g'+i" class="suggest-item">
              <span class="suggest-arrow">▸</span>
              <span v-html="g" />
            </div>
          </div>

          <div v-if="practiceItems.length" class="suggest-sub">
            <h4 class="suggest-sub-title">📝 练习建议</h4>
            <div v-for="(p, i) in practiceItems" :key="'pr'+i" class="suggest-item">
              <span class="suggest-arrow">▸</span>
              <span v-html="p" />
            </div>
          </div>

          <!-- 兼容旧报告 -->
          <template v-if="legacySuggestions.length">
            <div v-for="(s, i) in legacySuggestions" :key="'ls'+i" class="suggest-item">
              <span class="suggest-arrow">▸</span>
              <span v-html="s" />
            </div>
          </template>
        </div>

        <div v-if="remark" class="section">
          <div class="section-header"><span class="section-num">5</span> 老师备注</div>
          <div class="remark-box">
            <p v-html="md(remark)" />
          </div>
        </div>

        <div class="brand-footer">
          <img src="/logo-dark.png" alt="洋葱学园" class="brand-footer-logo" />
          <span class="brand-footer-text">洋葱学园 · 计算营 AI Copilot</span>
        </div>
      </div>

      <div v-if="generating" class="generating-hint no-print">
        <div class="loading-spinner small" /> 报告内容生成中...
      </div>
    </template>
  </div>
</template>

<style lang="scss">
@font-face {
  font-family: 'AlibabaPuHuiTi';
  src: url('/fonts/AlibabaPuHuiTi-2-55-Regular.ttf') format('truetype');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'AlibabaPuHuiTi';
  src: url('/fonts/AlibabaPuHuiTi-2-65-Medium.ttf') format('truetype');
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: 'AlibabaPuHuiTi';
  src: url('/fonts/AlibabaPuHuiTi-2-85-Bold.ttf') format('truetype');
  font-weight: 700;
  font-display: swap;
}
@font-face {
  font-family: 'AlibabaPuHuiTi';
  src: url('/fonts/AlibabaPuHuiTi-2-95-ExtraBold.ttf') format('truetype');
  font-weight: 800;
  font-display: swap;
}
</style>

<style lang="scss" scoped>
.report-container {
  background: var(--color-bg); min-height: 100vh; padding: 20px 0;
  font-family: 'AlibabaPuHuiTi', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
}

/* ===== 工具栏 ===== */
.toolbar {
  max-width: 820px; margin: 0 auto 16px; display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; background: #fff; border-radius: 12px;
  box-shadow: var(--shadow);
}
.tool-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 14px; border: 1px solid var(--color-border); border-radius: 8px;
  background: #fff; font-size: 13px; color: var(--color-text); cursor: pointer;
  &:hover { background: var(--color-bg); border-color: #d1d5db; }
  &.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); &:hover { background: var(--color-primary-hover); } }
  &.regenerate { color: var(--color-primary); border-color: rgba(74,144,226,0.3); &:hover { background: rgba(74,144,226,0.06); } }
}
.toolbar-title { flex: 1; text-align: center; font-size: 14px; font-weight: 500; color: var(--color-text-muted); }

.instruction-panel {
  max-width: 820px; margin: 0 auto 12px; padding: 12px 16px;
  background: #fff; border-radius: 12px; box-shadow: var(--shadow);
  border: 1px solid rgba(74,144,226,0.3);
}
.instruction-input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 8px;
  font-size: 13px; resize: vertical; outline: none; font-family: inherit;
  &:focus { border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(74,144,226,0.1); }
}
.instruction-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;
}

/* ===== A4 页面 ===== */
.page {
  width: 794px; min-height: 1100px; margin: 0 auto 24px; padding: 40px 48px;
  background: #fff; border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  page-break-after: always;
  position: relative;
}

/* ===== 封面 ===== */
.cover {
  background: linear-gradient(135deg, #4A90E2 0%, #5BA0F0 50%, #7AB8FF 100%);
  border-radius: 16px; padding: 48px 40px; text-align: center; color: #fff;
  margin-bottom: 36px;
  position: relative; overflow: hidden;
}
.cover::before {
  content: '';
  position: absolute; inset: 0;
  background:
    linear-gradient(60deg, transparent 40%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.08) 42%, transparent 42%),
    linear-gradient(-60deg, transparent 40%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.06) 42%, transparent 42%),
    linear-gradient(60deg, transparent 55%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.05) 57%, transparent 57%);
  pointer-events: none;
}
.cover.compact { padding: 28px 32px; margin-bottom: 20px; }
.cover.compact .cover-title { font-size: 18px; margin-bottom: 4px; }
.cover-logo { height: 32px; margin-bottom: 6px; position: relative; }
.cover-week-num {
  font-size: 72px; font-weight: 800; line-height: 1; position: relative;
  letter-spacing: -2px; margin-bottom: 0;
}
.cover-week-label {
  font-size: 14px; font-weight: 700; letter-spacing: 6px; opacity: 0.7;
  position: relative; margin-bottom: 8px;
}
.cover-title { font-size: 20px; font-weight: 700; margin-bottom: 6px; position: relative; opacity: 0.95; }
.cover-meta { font-size: 13px; opacity: 0.8; position: relative; }

/* ===== 模块标题 ===== */
.section { margin-bottom: 24px; }
.section-header {
  font-size: 16px; font-weight: 700; color: var(--color-primary); margin-bottom: 14px;
  padding-bottom: 8px; border-bottom: 3px solid var(--color-primary);
  display: flex; align-items: center; gap: 8px;
  &.sub {
    color: #065f46; border-color: #bbf7d0; border-bottom-width: 2px;
    font-size: 15px;
  }
}
.section-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: var(--color-primary); color: #fff; font-size: 12px; font-weight: 700;
}

/* ===== 基本信息卡片 ===== */
.info-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
}
.info-card {
  background: linear-gradient(135deg, #f8f9fa, #eef2f7);
  border: 1px solid #f0f5ff; border-radius: 10px;
  padding: 16px 10px; text-align: center;
}
.info-label { font-size: 12px; color: #66758c; margin-bottom: 4px; }
.info-value { font-size: 22px; font-weight: 700; color: #2a3b4c; }
.info-value.small { font-size: 13px; font-weight: 600; }
.info-card.highlight {
  background: linear-gradient(135deg, #4A90E2, #5BA0F0); border: none;
  .info-value { color: #fff; }
  .info-label { color: rgba(255,255,255,0.85); }
}

/* ===== 每周进步速览 ===== */
.progress-section {
  background: #f0fdf4; border-radius: 12px; padding: 16px 20px; border: 1px solid #bbf7d0;
}
.progress-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.progress-table th {
  padding: 6px 10px; background: #ecfdf5; border: 1px solid #d1fae5;
  font-weight: 700; color: #065f46; font-size: 12px;
}
.progress-table td { padding: 6px 10px; border: 1px solid #d1fae5; text-align: center; background: #fff; }
.day-col { font-weight: 700; color: var(--color-text); text-align: left; }
.accuracy-tag {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-block;
}
.tag-perfect { color: #059669; background: #d1fae5; }
.tag-great { color: #0369a1; background: #dbeafe; }
.tag-ok { color: #d97706; background: #fef3c7; }
.tag-warn { color: #FF4D4F; background: #fee2e2; }

/* ===== 精彩表现 ===== */
.sub-block { margin-bottom: 16px; }
.sub-title {
  font-size: 14px; font-weight: 600; color: #2a3b4c; margin-bottom: 8px;
  display: flex; align-items: center; gap: 6px;
}

.highlight-list, .normal-list {
  list-style: none; margin: 0; padding: 0;
}
.highlight-list li {
  padding: 10px 14px; font-size: 13px; line-height: 1.7;
  background: #fff9e6; border-radius: 8px; margin-bottom: 8px;
  &::before { content: "★"; color: #ffc107; margin-right: 8px; }
}
.normal-list li {
  padding: 10px 14px; font-size: 13px; line-height: 1.7;
  background: #f0f8ff; border-radius: 8px; margin-bottom: 8px;
  &::before { content: "●"; color: #4A90E2; margin-right: 8px; font-size: 8px; vertical-align: middle; }
}

/* ===== 书写评价 ===== */
.writing-block { margin-top: 8px; }
.writing-cards {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 10px;
}
.writing-card {
  text-align: center; padding: 16px 10px;
  background: linear-gradient(135deg, #f0f9eb, #e6f7e0); border-radius: 10px; border: 1px solid #e6f7e0;
}
.wc-icon { font-size: 22px; margin-bottom: 6px; }
.wc-value { font-size: 15px; font-weight: 700; color: #52c41a; }
.wc-label { font-size: 11px; color: #666; margin-top: 2px; }
.writing-comment {
  font-size: 13px; color: #2a3b4c; line-height: 1.8; margin-top: 10px;
}

/* ===== 易错汇总 ===== */
.error-tip-card {
  background: linear-gradient(135deg, #fff7e6, #fff3cd);
  border-left: 4px solid #fa8c16;
  padding: 16px 18px; margin-bottom: 14px;
  border-radius: 0 10px 10px 0;
  break-inside: avoid;
}
.et-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
  font-size: 14px; color: #fa8c16;
}
.et-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  background: #fa8c16; color: #fff; font-size: 12px; font-weight: 700;
}
.et-title { font-weight: 700; color: #8c4c14; }
.et-question {
  font-size: 13px; color: #8c4c14; line-height: 1.6; margin-bottom: 8px;
}
.et-technique {
  font-size: 13px; color: #4A90E2; line-height: 1.7;
  background: rgba(74,144,226,0.06); border-radius: 8px; padding: 10px 14px;
  display: flex; align-items: flex-start; gap: 6px;
}
.et-bulb { flex-shrink: 0; }

/* ===== 学习建议 ===== */
.suggest-sub { margin-bottom: 14px; }
.suggest-sub-title {
  font-size: 14px; font-weight: 600; color: #2a3b4c; margin-bottom: 6px;
}
.encourage-text {
  font-size: 13px; color: #666; line-height: 1.8;
  background: #f0fdf4; border-radius: 10px; padding: 12px 16px; border: 1px solid #bbf7d0;
}
.suggest-item {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 8px; font-size: 13px; line-height: 1.7; color: var(--color-text);
}
.suggest-arrow { color: var(--color-primary); font-weight: 700; flex-shrink: 0; }

/* ===== 备注 ===== */
.remark-box {
  background: linear-gradient(135deg, #f0f8ff, #e8f4f8);
  border-radius: 10px; padding: 18px 22px; border: 1px solid #e8f4f8;
  p { font-size: 13px; color: #2a3b4c; line-height: 1.8; }
}

/* ===== 品牌页脚 ===== */
.brand-footer {
  position: absolute; bottom: 36px; left: 0; right: 0;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light);
  margin: 0 48px;
}
.brand-footer-logo { height: 24px; }
.brand-footer-text {
  font-size: 12px; color: var(--color-text-muted); font-weight: 500; letter-spacing: 0.5px;
}

/* ===== 加载 ===== */
.loading-overlay {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 120px 40px; color: var(--color-text-muted);
  p { margin-top: 12px; font-size: 14px; }
}
.loading-spinner {
  width: 36px; height: 36px; border: 3px solid var(--color-border); border-top-color: var(--color-primary);
  border-radius: 50%; animation: spin 0.6s linear infinite;
  &.small { width: 18px; height: 18px; border-width: 2px; }
}
@keyframes spin { to { transform: rotate(360deg); } }

.generating-hint {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px; color: var(--color-primary); font-size: 13px;
}

/* ===== 打印 ===== */
.no-print { }
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  .no-print { display: none !important; }
  .report-container { background: #fff !important; padding: 0; }
  .page {
    margin: 0; box-shadow: none; border-radius: 0;
    width: 100%; padding: 24px 32px;
    page-break-after: always;
  }
  .page:last-child { page-break-after: avoid; }
  .cover { border-radius: 12px !important; }
  .info-card, .progress-table, .error-tip-card, .suggest-sub, .remark-box, .writing-card {
    break-inside: avoid;
  }
}
</style>
