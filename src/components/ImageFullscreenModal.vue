<script setup lang="ts">
import type { FlatQuestion, ManualAnnotation } from '~/types'

const props = defineProps<{
  visible: boolean
  imageUrl: string
  questions: FlatQuestion[]
  manualAnnotations: ManualAnnotation[]
  naturalWidth: number
  naturalHeight: number
}>()

const emit = defineEmits<{
  close: []
}>()

const imgRef = ref<HTMLImageElement>()
const displaySize = ref({ width: 0, height: 0 })

/** 被隐藏的标注 ID 集合 */
const hiddenIds = ref(new Set<string>())

function syncSize() {
  const img = imgRef.value
  if (img) {
    displaySize.value = { width: img.clientWidth, height: img.clientHeight }
  }
}

let ro: ResizeObserver | null = null

watch(() => props.visible, (v) => {
  if (v) {
    hiddenIds.value.clear()
    nextTick(() => {
      if (imgRef.value) {
        syncSize()
        ro = new ResizeObserver(syncSize)
        ro.observe(imgRef.value)
      }
    })
  }
  else {
    ro?.disconnect()
    ro = null
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
})

function onImageLoad() {
  syncSize()
  if (imgRef.value && ro) ro.observe(imgRef.value)
}

function getMarkerStyle(positions: number[]) {
  if (!positions || positions.length < 8 || !props.naturalWidth || !displaySize.value.width) return null

  const scaleX = displaySize.value.width / props.naturalWidth
  const scaleY = displaySize.value.height / props.naturalHeight

  const x = positions[0] * scaleX
  const y = positions[1] * scaleY
  const w = (positions[2] - positions[0]) * scaleX
  const h = (positions[5] - positions[1]) * scaleY

  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${Math.max(w, 24)}px`,
    height: `${Math.max(h, 24)}px`,
  }
}

function toggleMarker(id: string) {
  const s = new Set(hiddenIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  hiddenIds.value = s
}

function showAll() {
  hiddenIds.value = new Set()
}

function hideAll() {
  const ids = [
    ...props.questions.map(q => q.id),
    ...props.manualAnnotations.map(a => a.id),
  ]
  hiddenIds.value = new Set(ids)
}

const totalMarkers = computed(() => props.questions.length + props.manualAnnotations.length)
const allHidden = computed(() => hiddenIds.value.size === totalMarkers.value)
const allVisible = computed(() => hiddenIds.value.size === 0)

function onBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('fullscreen-backdrop')) {
    emit('close')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fullscreen-backdrop"
        @click="onBackdropClick"
      >
        <div class="fullscreen-panel">
          <!-- 顶部工具栏 -->
          <div class="toolbar">
            <div class="toolbar-left">
              <span class="toolbar-title">作业大图</span>
              <span class="toolbar-hint">点击标注可单独隐藏</span>
            </div>
            <div class="toolbar-actions">
              <button
                class="tool-btn"
                :class="{ 'tool-btn--active': allVisible }"
                @click="showAll"
              >
                全部显示
              </button>
              <button
                class="tool-btn"
                :class="{ 'tool-btn--active': allHidden }"
                @click="hideAll"
              >
                全部隐藏
              </button>
              <button class="close-btn" @click="emit('close')" title="关闭">
                ✕
              </button>
            </div>
          </div>

          <!-- 图片容器 -->
          <div class="image-viewport">
            <div class="image-wrapper">
              <img
                ref="imgRef"
                :src="imageUrl"
                class="fullscreen-image"
                @load="onImageLoad"
              />
              <template v-for="q in questions" :key="q.id">
                <div
                  v-if="q.positions.length >= 8 && getMarkerStyle(q.positions) && !hiddenIds.has(q.id)"
                  class="marker"
                  :class="{
                    correct: q.reviewedCorrect,
                    wrong: !q.reviewedCorrect,
                  }"
                  :style="getMarkerStyle(q.positions)!"
                  :title="`${q.reviewedCorrect ? '✓ 正确' : '✗ 错误'}（点击隐藏）`"
                  @click.stop="toggleMarker(q.id)"
                >
                  <span class="marker-icon">{{ q.reviewedCorrect ? '✓' : '✗' }}</span>
                </div>
              </template>
              <template v-for="anno in manualAnnotations" :key="anno.id">
                <div
                  v-if="getMarkerStyle(anno.positions) && !hiddenIds.has(anno.id)"
                  class="marker"
                  :class="{ correct: anno.isCorrect, wrong: !anno.isCorrect }"
                  :style="getMarkerStyle(anno.positions)!"
                  :title="`${anno.isCorrect ? '✓ 正确' : '✗ 错误'}（点击隐藏）`"
                  @click.stop="toggleMarker(anno.id)"
                >
                  <span class="marker-icon">{{ anno.isCorrect ? '✓' : '✗' }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.fullscreen-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
}

.fullscreen-panel {
  width: 96vw;
  height: 96vh;
  background: var(--color-bg-card, #fff);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  background: var(--color-bg, #fafafa);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text, #1a1a1a);
}

.toolbar-hint {
  font-size: 12px;
  color: var(--color-text-secondary, #888);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: #fff;
  color: var(--color-text-secondary, #666);
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-primary, #4f6ef7);
    color: var(--color-primary, #4f6ef7);
  }

  &--active {
    background: var(--color-primary, #4f6ef7);
    color: #fff;
    border-color: var(--color-primary, #4f6ef7);

    &:hover {
      opacity: 0.9;
    }
  }
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary, #888);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  margin-left: 4px;

  &:hover {
    background: rgba(0, 0, 0, 0.06);
    color: var(--color-text, #1a1a1a);
  }
}

.image-viewport {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 0;
}

.image-wrapper {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
}

.fullscreen-image {
  display: block;
  max-width: 100%;
  max-height: calc(96vh - 80px);
  object-fit: contain;
  border-radius: 4px;
}

.marker {
  position: absolute;
  border: 2.5px solid;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;

  &.correct {
    border-color: var(--color-success, #52c41a);
    background: rgba(82, 196, 26, 0.08);

    &:hover {
      background: rgba(82, 196, 26, 0.2);
      box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.25);
    }
  }

  &.wrong {
    border-color: var(--color-danger, #ff4d4f);
    background: rgba(255, 77, 79, 0.08);

    &:hover {
      background: rgba(255, 77, 79, 0.2);
      box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.25);
    }
  }
}


.marker-icon {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);

  .correct & {
    background: var(--color-success, #52c41a);
  }

  .wrong & {
    background: var(--color-danger, #ff4d4f);
  }
}

/* 进出动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
