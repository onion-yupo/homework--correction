<script setup lang="ts">
defineOptions({ name: 'SubmitPage' })

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))

const API = import.meta.env.VITE_API_BASE || '/api'

interface Config {
  studentId: string
  studentName: string
  teacherName: string
  campName: string
  term: string
}

const config = ref<Config | null>(null)
const configError = ref('')

interface UploadItem {
  file: File
  preview: string
  semester: string
  day: string
  visionLoading: boolean
}

// 自动识别结果（视觉 API）
const uploadItems = ref<UploadItem[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

const submitting = ref(false)
const submitted = ref(false)
const submitError = ref('')

onMounted(async () => {
  try {
    const resp = await fetch(`${API}/submit/config/${token.value}`)
    if (!resp.ok) throw new Error('链接无效')
    config.value = await resp.json()
  } catch (e: any) {
    configError.value = e.message || '链接无效或已过期'
  }
})

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return

  submitError.value = ''
  submitted.value = false
  input.value = ''

  for (const file of files.slice(0, 9 - uploadItems.value.length)) {
    const item: UploadItem = {
      file,
      preview: URL.createObjectURL(file),
      semester: '',
      day: '',
      visionLoading: true,
    }
    uploadItems.value.push(item)

    try {
      const fd = new FormData()
      fd.append('image', file)
      const resp = await fetch(`${API}/vision/analyze`, { method: 'POST', body: fd })
      if (resp.ok) {
        const data = await resp.json()
        if (data.semester) item.semester = data.semester
        if (data.day) item.day = String(data.day)
      }
    } catch {
      // 识别失败不阻断提交
    } finally {
      item.visionLoading = false
    }
  }
}

function removeImage(index: number) {
  const [item] = uploadItems.value.splice(index, 1)
  if (item) URL.revokeObjectURL(item.preview)
}

async function submit() {
  submitError.value = ''
  if (!uploadItems.value.length) {
    submitError.value = '请先选择作业照片'
    return
  }
  submitting.value = true
  try {
    const fd = new FormData()
    for (const item of uploadItems.value) {
      fd.append('images', item.file)
    }
    fd.append('semesters', JSON.stringify(uploadItems.value.map(item => item.semester)))
    fd.append('days', JSON.stringify(uploadItems.value.map(item => item.day)))

    const resp = await fetch(`${API}/submit/${token.value}`, { method: 'POST', body: fd })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || '提交失败')
    submitted.value = true
  } catch (e: any) {
    submitError.value = e.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

function submitAnother() {
  submitted.value = false
  uploadItems.value.forEach(item => URL.revokeObjectURL(item.preview))
  uploadItems.value = []
}

// 上传区域 drag & drop
const dragging = ref(false)
function onDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  const fakeEvent = { target: { files: e.dataTransfer?.files, value: '' } } as unknown as Event
  onFileChange(fakeEvent)
}
</script>

<template>
  <div class="submit-page">
    <div class="submit-card">
      <!-- 错误状态 -->
      <div v-if="configError" class="state-box">
        <div class="state-icon">⚠️</div>
        <p class="state-title">链接无效</p>
        <p class="state-desc">{{ configError }}</p>
        <p class="state-hint">请联系老师重新发送提交链接</p>
      </div>

      <!-- 已提交成功 -->
      <div v-else-if="submitted" class="state-box">
        <div class="state-icon">✅</div>
        <p class="state-title">已收到！</p>
        <p class="state-desc">老师正在批改中，批改完成后会通过微信反馈给你</p>
        <button class="another-btn" @click="submitAnother">继续提交</button>
      </div>

      <!-- 表单 -->
      <template v-else-if="config">
        <div class="card-header">
          <div>
            <div class="student-name">{{ config.studentName }}</div>
            <div class="teacher-name">{{ config.teacherName }}老师</div>
          </div>
          <div class="term-label">{{ config.campName || '营课' }} · {{ config.term }}</div>
        </div>

        <div class="card-body">
          <!-- 图片上传区 -->
          <div
            :class="['upload-area', { dragging }]"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <input
              ref="fileInput"
              class="upload-input"
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              @change="onFileChange"
            />

            <div class="upload-icon">📷</div>
            <p class="upload-text">点击拍照或选择作业图片</p>
            <p class="upload-hint">支持 JPG / PNG，建议拍摄清晰</p>
          </div>

          <!-- 视觉识别结果 -->
          <div v-if="uploadItems.length" class="upload-list">
            <div v-for="(item, index) in uploadItems" :key="item.preview" class="upload-item">
              <img :src="item.preview" class="thumb-img" alt="作业预览" />
              <div class="upload-meta">
                <div class="upload-item-title">第 {{ index + 1 }} 张作业</div>
                <div class="meta-row compact">
                  <div class="meta-item">
                    <label class="meta-label">学期</label>
                    <input v-model="item.semester" type="text" class="meta-input" placeholder="如：二下" :disabled="item.visionLoading" />
                  </div>
                  <div class="meta-item">
                    <label class="meta-label">第几天</label>
                    <input v-model="item.day" type="number" class="meta-input" placeholder="如：3" min="1" max="24" :disabled="item.visionLoading" />
                  </div>
                </div>
                <div v-if="item.visionLoading" class="vision-loading">
                  <span class="spin" />识别中…
                </div>
              </div>
              <button class="remove-btn small" @click.stop="removeImage(index)">✕</button>
            </div>
          </div>

          <p v-if="submitError" class="submit-error">{{ submitError }}</p>

          <button
            class="submit-btn"
            :disabled="!uploadItems.length || submitting"
            @click="submit"
          >
            <span v-if="submitting" class="spin white" />
            {{ submitting ? '提交中...' : '提交作业' }}
          </button>
        </div>
      </template>

      <!-- 加载中 -->
      <div v-else class="state-box">
        <div class="spin large" />
        <p style="margin-top: 12px; color: #999">加载中...</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.submit-page {
  min-height: 100vh;
  background: #f5f7fa;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px 16px 40px;
}

.submit-card {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

/* 头部 */
.card-header {
  padding: 24px 20px 16px;
  background: linear-gradient(135deg, #4f6ef7 0%, #6c8bff 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.student-name {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.teacher-name {
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 12px;
}

.term-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.2);
  padding: 3px 10px;
  border-radius: 20px;
}

.card-body {
  padding: 20px;
}

/* 上传区 */
.upload-area {
  position: relative;
  min-height: 180px;
  border: 2px dashed #d0d7de;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
  margin-bottom: 16px;

  &:hover, &.dragging {
    border-color: #4f6ef7;
    background: rgba(79, 110, 247, 0.04);
  }

  &.has-image {
    border-style: solid;
    border-color: #4f6ef7;
    cursor: default;
    min-height: 240px;
  }
}

.upload-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 2;
}

.remove-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;

  &:hover { background: rgba(0, 0, 0, 0.7); }

  &.small {
    top: 10px;
    right: 10px;
    width: 24px;
    height: 24px;
    font-size: 12px;
  }
}

.upload-icon { font-size: 36px; }
.upload-text { font-size: 15px; color: #444; font-weight: 500; }
.upload-hint { font-size: 12px; color: #aaa; }

.upload-list {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
}

.upload-item {
  position: relative;
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 12px;
  padding: 10px;
  border: 1px solid #eef1f5;
  border-radius: 12px;
  background: #fbfcff;
}

.thumb-img {
  width: 88px;
  height: 88px;
  border-radius: 10px;
  object-fit: cover;
}

.upload-meta {
  padding-right: 24px;
}

.upload-item-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

/* 元数据 */
.meta-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 16px;

  &.compact {
    margin-bottom: 6px;
  }
}

.meta-item {
  flex: 1;
}

.meta-label {
  display: block;
  font-size: 12px;
  color: #888;
  margin-bottom: 6px;
}

.meta-input {
  width: 100%;
  height: 38px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;

  &:focus { border-color: #4f6ef7; }
  &:disabled { background: #f9f9f9; color: #aaa; }
}

.vision-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  padding-bottom: 2px;
}

.submit-error {
  color: #ff4d4f;
  font-size: 13px;
  margin-bottom: 12px;
}

.submit-btn {
  width: 100%;
  height: 50px;
  background: #4f6ef7;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  &:hover:not(:disabled) {
    background: #3a5de8;
    box-shadow: 0 4px 16px rgba(79, 110, 247, 0.3);
  }

  &:disabled {
    background: #c0c9f8;
    cursor: not-allowed;
  }
}

/* 状态页 */
.state-box {
  padding: 60px 24px;
  text-align: center;
}

.state-icon { font-size: 48px; margin-bottom: 16px; }
.state-title { font-size: 20px; font-weight: 700; color: #333; margin-bottom: 10px; }
.state-desc { font-size: 14px; color: #666; line-height: 1.7; margin-bottom: 8px; }
.state-hint { font-size: 12px; color: #aaa; }

.another-btn {
  margin-top: 24px;
  height: 44px;
  padding: 0 28px;
  border: 1.5px solid #4f6ef7;
  border-radius: 10px;
  color: #4f6ef7;
  background: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(79, 110, 247, 0.06);
  }
}

/* spinner */
.spin {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(79, 110, 247, 0.3);
  border-top-color: #4f6ef7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;

  &.white {
    border-color: rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
  }

  &.large {
    width: 36px;
    height: 36px;
    border-width: 3px;
    border-color: #e5e7eb;
    border-top-color: #4f6ef7;
    margin: 0 auto;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
