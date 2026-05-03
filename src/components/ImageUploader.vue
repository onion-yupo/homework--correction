<script setup lang="ts">
const emit = defineEmits<{
  upload: [file: File]
}>()

const isDragging = ref(false)

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file && file.type.startsWith('image/')) {
    emit('upload', file)
  }
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    emit('upload', file)
    input.value = ''
  }
}
</script>

<template>
  <div
    class="uploader"
    :class="{ dragging: isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <div class="uploader-content">
      <div class="uploader-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="#EEF2FF" />
          <path d="M24 16v16M16 24h16" stroke="#4f6ef7" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      </div>
      <p class="uploader-title">上传作业图片</p>
      <p class="uploader-hint">点击选择或将图片拖拽到此区域</p>
      <p class="uploader-format">支持 JPG、PNG、BMP 格式，建议分辨率 600×800 以上</p>
      <label class="uploader-btn">
        选择图片
        <input
          type="file"
          accept="image/jpeg,image/png,image/bmp"
          hidden
          @change="handleFileChange"
        />
      </label>
    </div>
  </div>
</template>

<style scoped lang="scss">
.uploader {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-lg);
  padding: 80px 40px;
  text-align: center;
  background: var(--color-bg-card);
  transition: all 0.25s ease;
  cursor: pointer;
  max-width: 600px;
  margin: 0 auto;

  &:hover {
    border-color: var(--color-primary);
    background: #fafbff;
  }

  &.dragging {
    border-color: var(--color-primary);
    background: #f0f4ff;
    transform: scale(1.01);
  }
}

.uploader-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.uploader-icon {
  margin-bottom: 8px;
}

.uploader-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
}

.uploader-hint {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.uploader-format {
  font-size: 13px;
  color: var(--color-text-secondary);
  opacity: 0.65;
}

.uploader-btn {
  margin-top: 16px;
  padding: 10px 36px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--color-primary-hover);
  }
}
</style>
