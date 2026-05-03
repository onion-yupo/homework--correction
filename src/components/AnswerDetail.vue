<script setup lang="ts">
import type { ReviewAnswer } from '~/types'
import MarkdownKatex from '~/components/MarkdownKatex.vue'

defineProps<{
  answer: ReviewAnswer
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <div class="answer-detail">
    <div class="detail-row">
      <span class="detail-label">手写答案</span>
      <span class="detail-value">
        <MarkdownKatex v-if="answer.handwriteInfo" :content="answer.handwriteInfo" inline />
        <template v-else>—</template>
      </span>
    </div>
    <div class="detail-row">
      <span class="detail-label">答案判断</span>
      <span class="detail-value">
        <div class="judge-group">
          <button
            class="judge-opt"
            :class="{ 'judge-opt--active': answer.reviewedCorrect, 'judge-opt--correct': true }"
            @click="!answer.reviewedCorrect && emit('toggle')"
          >
            ✓ 正确
          </button>
          <button
            class="judge-opt"
            :class="{ 'judge-opt--active': !answer.reviewedCorrect, 'judge-opt--wrong': true }"
            @click="answer.reviewedCorrect && emit('toggle')"
          >
            ✗ 错误
          </button>
        </div>
      </span>
    </div>
    <div v-if="answer.rightAnswer" class="detail-row">
      <span class="detail-label">正确答案</span>
      <span class="detail-value">
        <MarkdownKatex :content="answer.rightAnswer" inline />
      </span>
    </div>
    <div v-if="answer.knowledgePoints.length > 0" class="detail-row">
      <span class="detail-label">知识点</span>
      <span class="detail-value">
        <span v-for="k in answer.knowledgePoints" :key="k" class="tag">{{ k }}</span>
      </span>
    </div>
    <div v-if="answer.analysis" class="detail-row">
      <span class="detail-label">答案分析</span>
      <span class="detail-value analysis-text">
        <MarkdownKatex :content="answer.analysis" inline />
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.answer-detail {
  padding: 10px 12px;
}

.detail-row {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  font-size: 13px;
  line-height: 1.6;

  &:last-child { border-bottom: none; }
}

.detail-label {
  flex-shrink: 0;
  width: 64px;
  color: var(--color-text-secondary);
}

.detail-value {
  flex: 1;
  color: var(--color-text);
  word-break: break-all;
}

.judge-group {
  display: inline-flex;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.judge-opt {
  padding: 4px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  border: none;
  background: var(--color-bg);
  color: var(--color-text-secondary);

  &--correct.judge-opt--active {
    background: rgba(82, 196, 26, 0.15);
    color: var(--color-success);
    box-shadow: inset 0 0 0 1px rgba(82, 196, 26, 0.35);
  }

  &--wrong.judge-opt--active {
    background: rgba(255, 77, 79, 0.15);
    color: var(--color-danger);
    box-shadow: inset 0 0 0 1px rgba(255, 77, 79, 0.35);
  }

  &:not(.judge-opt--active):hover {
    background: var(--color-bg-hover, rgba(0, 0, 0, 0.04));
    color: var(--color-text);
  }

  & + & {
    border-left: 1px solid var(--color-border);
  }
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(79, 110, 247, 0.08);
  color: var(--color-primary);
  border-radius: 4px;
  font-size: 12px;
  margin-right: 6px;
}

.analysis-text {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.7;
}
</style>
