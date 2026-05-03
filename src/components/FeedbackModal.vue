<script setup lang="ts">
import type { FlatQuestion } from '~/types'

const props = defineProps<{
  visible: boolean
  questions: FlatQuestion[]
  totalCount: number
  correctCount: number
  wrongCount: number
  accuracy: number
}>()

const emit = defineEmits<{
  close: []
}>()

const copied = ref(false)

const wrongQuestions = computed(() => props.questions.filter(q => !q.reviewedCorrect))

const feedbackText = computed(() => {
  const lines: string[] = []
  lines.push(`📝 作业批改反馈`)
  lines.push(``)
  lines.push(`总题数：${props.totalCount}`)
  lines.push(`正确：${props.correctCount} | 错误：${props.wrongCount}`)
  lines.push(`正确率：${props.accuracy}%`)

  if (wrongQuestions.value.length > 0) {
    lines.push(``)
    lines.push(`❌ 错题清单：`)
    for (const q of wrongQuestions.value) {
      lines.push(`• ${q.title}`)
      lines.push(`  学生答案：${q.handwriteInfo || '—'}`)
      if (q.rightAnswer) {
        lines.push(`  正确答案：${q.rightAnswer}`)
      }
      if (q.analysis) {
        lines.push(`  分析：${q.analysis}`)
      }
    }
  }

  if (props.accuracy === 100) {
    lines.push(``)
    lines.push(`🎉 全部正确，非常棒！继续保持！`)
  }
  else if (props.accuracy >= 80) {
    lines.push(``)
    lines.push(`👍 整体完成不错，建议针对错题再练习巩固。`)
  }
  else {
    lines.push(``)
    lines.push(`💪 部分题目需要加强练习，建议重点复习相关知识点。`)
  }

  return lines.join('\n')
})

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    }
    catch { /* 降级 */ }
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

async function copyFeedback() {
  await copyText(feedbackText.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-mask" @click.self="emit('close')">
        <div class="modal">
          <div class="modal-header">
            <h3>家长反馈文案</h3>
            <button class="close-btn" @click="emit('close')">✕</button>
          </div>
          <div class="modal-body">
            <pre class="feedback-text">{{ feedbackText }}</pre>
          </div>
          <div class="modal-footer">
            <button class="copy-btn" :class="{ copied }" @click="copyFeedback">
              {{ copied ? '✓ 已复制' : '复制文案' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);

  h3 {
    font-size: 16px;
    font-weight: 600;
  }
}

.close-btn {
  background: none;
  border: none;
  font-size: 16px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;

  &:hover {
    background: var(--color-bg);
  }
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.feedback-text {
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text);
  font-family: inherit;
  background: var(--color-bg);
  padding: 20px;
  border-radius: var(--radius);
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
}

.copy-btn {
  padding: 10px 32px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-primary-hover);
  }

  &.copied {
    background: var(--color-success);
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
