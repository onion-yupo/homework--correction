<script setup lang="ts">
import type { FlatQuestion, ManualAnnotation } from '~/types'

const props = defineProps<{
  imageUrl: string
  questions: FlatQuestion[]
  manualAnnotations: ManualAnnotation[]
  naturalWidth: number
  naturalHeight: number
  hiddenIds?: Set<string>
  hideAll?: boolean
  annotating?: boolean
}>()

const emit = defineEmits<{
  locate: [id: string]
  addAnnotation: [positions: number[], isCorrect: boolean]
  removeAnnotation: [id: string]
  toggleAnnotation: [id: string]
}>()

const imgRef = ref<HTMLImageElement>()
const containerRef = ref<HTMLDivElement>()
const displaySize = ref({ width: 0, height: 0 })

function syncSize() {
  const img = imgRef.value
  if (img) {
    displaySize.value = { width: img.clientWidth, height: img.clientHeight }
  }
}

let ro: ResizeObserver | null = null

onMounted(() => {
  ro = new ResizeObserver(syncSize)
  if (imgRef.value) ro.observe(imgRef.value)
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

function getRelativePos(e: MouseEvent) {
  const container = containerRef.value
  if (!container) return { x: 0, y: 0 }
  const rect = container.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/* ── 框选绘制（在空白区域拖拽创建新标注） ── */
const isDrawing = ref(false)
const drawStart = ref({ x: 0, y: 0 })
const drawCurrent = ref({ x: 0, y: 0 })
let drawnPositions: number[] = []

/* ── 新建标注 / 编辑已有标注 的弹窗 ── */
const showNewPopup = ref(false)
const newPopupPos = ref({ x: 0, y: 0 })

const showEditPopup = ref(false)
const editPopupPos = ref({ x: 0, y: 0 })
const editTargetId = ref('')
const editTargetCorrect = ref(false)

/* ── 容器鼠标事件 ── */
function onMouseDown(e: MouseEvent) {
  if (!props.annotating) return
  if (showNewPopup.value || showEditPopup.value) return

  e.preventDefault()
  const pos = getRelativePos(e)
  drawStart.value = pos
  drawCurrent.value = pos
  isDrawing.value = true
}

function onMouseMove(e: MouseEvent) {
  if (isDrawing.value) {
    drawCurrent.value = getRelativePos(e)
  }
}

function onMouseUp(_e: MouseEvent) {
  if (!isDrawing.value) return
  isDrawing.value = false

  const { x: x1, y: y1 } = drawStart.value
  const { x: x2, y: y2 } = drawCurrent.value

  const minSize = 15
  if (Math.abs(x2 - x1) < minSize || Math.abs(y2 - y1) < minSize) return

  const scaleX = props.naturalWidth / displaySize.value.width
  const scaleY = props.naturalHeight / displaySize.value.height

  const left = Math.min(x1, x2) * scaleX
  const top = Math.min(y1, y2) * scaleY
  const right = Math.max(x1, x2) * scaleX
  const bottom = Math.max(y1, y2) * scaleY

  drawnPositions = [left, top, right, top, right, bottom, left, bottom]
  newPopupPos.value = { x: Math.max(x1, x2), y: Math.min(y1, y2) }
  showNewPopup.value = true
}

/* ── 新建弹窗操作 ── */
function chooseCorrectness(isCorrect: boolean) {
  showNewPopup.value = false
  if (drawnPositions.length === 8) {
    emit('addAnnotation', [...drawnPositions], isCorrect)
  }
  drawnPositions = []
}

function cancelNew() {
  showNewPopup.value = false
  drawnPositions = []
}

/* ── 点击已有手动标注 → 弹出编辑菜单 ── */
function onManualMarkerClick(e: MouseEvent, anno: ManualAnnotation) {
  e.stopPropagation()
  showNewPopup.value = false
  editTargetId.value = anno.id
  editTargetCorrect.value = anno.isCorrect

  const pos = getRelativePos(e)
  editPopupPos.value = { x: pos.x, y: pos.y }
  showEditPopup.value = true
}

function editSetCorrect() {
  if (!editTargetCorrect.value) emit('toggleAnnotation', editTargetId.value)
  showEditPopup.value = false
}
function editSetWrong() {
  if (editTargetCorrect.value) emit('toggleAnnotation', editTargetId.value)
  showEditPopup.value = false
}
function editDelete() {
  emit('removeAnnotation', editTargetId.value)
  showEditPopup.value = false
}

const drawRectStyle = computed(() => {
  if (!isDrawing.value) return null
  const { x: x1, y: y1 } = drawStart.value
  const { x: x2, y: y2 } = drawCurrent.value
  return {
    left: `${Math.min(x1, x2)}px`,
    top: `${Math.min(y1, y2)}px`,
    width: `${Math.abs(x2 - x1)}px`,
    height: `${Math.abs(y2 - y1)}px`,
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="overlay-container"
    :class="{ 'overlay-container--annotating': annotating }"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <img
      ref="imgRef"
      :src="imageUrl"
      class="overlay-image"
      draggable="false"
      @load="onImageLoad"
    />

    <!-- AI 识别的标注 -->
    <template v-for="q in questions" :key="q.id">
      <div
        v-if="q.positions.length >= 8 && getMarkerStyle(q.positions)"
        class="marker"
        :class="{
          correct: q.reviewedCorrect,
          wrong: !q.reviewedCorrect,
          'marker--hidden': hideAll || hiddenIds?.has(q.id),
          'marker--dimmed': annotating,
        }"
        :style="getMarkerStyle(q.positions)!"
        :title="q.reviewedCorrect ? '✓ 正确（点击定位）' : '✗ 错误（点击定位）'"
        @click="!annotating && emit('locate', q.id)"
      >
        <span class="marker-icon">{{ q.reviewedCorrect ? '✓' : '✗' }}</span>
      </div>
    </template>

    <!-- 手动标注 -->
    <template v-for="anno in manualAnnotations" :key="anno.id">
      <div
        v-if="getMarkerStyle(anno.positions)"
        class="marker marker--manual"
        :class="{ correct: anno.isCorrect, wrong: !anno.isCorrect, 'marker--hidden': hideAll }"
        :style="getMarkerStyle(anno.positions)!"
        :title="`${anno.isCorrect ? '✓ 正确' : '✗ 错误'}（点击编辑）`"
        @mousedown.stop="() => {}"
        @click.stop="onManualMarkerClick($event, anno)"
      >
        <span class="marker-icon">{{ anno.isCorrect ? '✓' : '✗' }}</span>
      </div>
    </template>

    <!-- 框选绘制中的矩形 -->
    <div v-if="isDrawing && drawRectStyle" class="draw-rect" :style="drawRectStyle" />

    <!-- 新建标注弹窗 -->
    <div
      v-if="showNewPopup"
      class="choice-popup"
      :style="{ left: `${newPopupPos.x + 8}px`, top: `${newPopupPos.y}px` }"
      @mousedown.stop
    >
      <button class="choice-btn choice-btn--correct" @click.stop="chooseCorrectness(true)">✓ 正确</button>
      <button class="choice-btn choice-btn--wrong" @click.stop="chooseCorrectness(false)">✗ 错误</button>
      <button class="choice-btn choice-btn--cancel" @click.stop="cancelNew">取消</button>
    </div>

    <!-- 编辑已有标注弹窗 -->
    <div
      v-if="showEditPopup"
      class="choice-popup"
      :style="{ left: `${editPopupPos.x + 8}px`, top: `${editPopupPos.y}px` }"
      @mousedown.stop
    >
      <button class="choice-btn choice-btn--correct" @click.stop="editSetCorrect">✓ 正确</button>
      <button class="choice-btn choice-btn--wrong" @click.stop="editSetWrong">✗ 错误</button>
      <button class="choice-btn choice-btn--delete" @click.stop="editDelete">删除</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.overlay-container {
  position: relative;
  display: inline-block;
  width: 100%;

  &--annotating {
    cursor: crosshair;
  }
}

.overlay-image {
  width: 100%;
  height: auto;
  display: block;
  border-radius: var(--radius);
  user-select: none;
}

.marker {
  position: absolute;
  border: 2px solid;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;

  &.correct {
    border-color: var(--color-success);
    background: rgba(82, 196, 26, 0.06);

    &:hover {
      background: rgba(82, 196, 26, 0.15);
    }
  }

  &.wrong {
    border-color: var(--color-danger);
    background: rgba(255, 77, 79, 0.06);

    &:hover {
      background: rgba(255, 77, 79, 0.15);
    }
  }
}

.marker--hidden {
  opacity: 0;
  pointer-events: none;
}

.marker--dimmed {
  opacity: 0.15;
  pointer-events: none;
}

.marker--manual {
  z-index: 5;
}

.marker-icon {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);

  .correct & {
    background: var(--color-success);
  }

  .wrong & {
    background: var(--color-danger);
  }
}


.draw-rect {
  position: absolute;
  border: 2px dashed var(--color-primary);
  background: rgba(99, 102, 241, 0.1);
  pointer-events: none;
  z-index: 10;
}

.choice-popup {
  position: absolute;
  z-index: 20;
  display: flex;
  gap: 4px;
  background: #fff;
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.choice-btn {
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &--correct {
    background: var(--color-success);
    color: #fff;
    &:hover { filter: brightness(0.9); }
  }

  &--wrong {
    background: var(--color-danger);
    color: #fff;
    &:hover { filter: brightness(0.9); }
  }

  &--cancel {
    background: #f0f0f0;
    color: #666;
    &:hover { background: #e0e0e0; }
  }

  &--delete {
    background: #333;
    color: #fff;
    &:hover { background: #111; }
  }
}
</style>
