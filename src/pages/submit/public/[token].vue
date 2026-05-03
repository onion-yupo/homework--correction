<script setup lang="ts">
defineOptions({ name: 'PublicSubmitPage' })

const route = useRoute()
const publicToken = computed(() => String(route.params.token ?? ''))
const API = import.meta.env.VITE_API_BASE || '/api'

interface PublicConfig {
  teacherName: string
  campName: string
  term: string
}

interface StudentConfig {
  studentId: string
  studentName: string
  teacherName: string
  campName: string
  term: string
}

interface UploadItem {
  file: File
  preview: string
  semester: string
  day: string
  visionLoading: boolean
}

const config = ref<PublicConfig | null>(null)
const studentConfig = ref<StudentConfig | null>(null)
const bindError = ref('')
const submitError = ref('')
const configError = ref('')
const binding = ref(false)
const submitting = ref(false)
const submitted = ref(false)

const bindForm = reactive({
  studentName: '',
  parentPhone: '',
})

const uploadItems = ref<UploadItem[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const submitToken = ref('')

const storageKey = computed(() => `public-submit-binding:${publicToken.value}`)

onMounted(async () => {
  try {
    const resp = await fetch(`${API}/submit/public/config/${publicToken.value}`)
    if (!resp.ok) throw new Error('链接无效')
    config.value = await resp.json()
    const cached = localStorage.getItem(storageKey.value)
    if (cached) await useSubmitToken(cached)
  } catch (e: any) {
    configError.value = e.message || '链接无效或已过期'
  }
})

async function useSubmitToken(token: string) {
  const resp = await fetch(`${API}/submit/config/${token}`)
  if (!resp.ok) {
    localStorage.removeItem(storageKey.value)
    return
  }
  submitToken.value = token
  studentConfig.value = await resp.json()
}

async function bindStudent() {
  bindError.value = ''
  const studentName = bindForm.studentName.trim()
  const parentPhone = bindForm.parentPhone.trim()
  if (!studentName || !parentPhone) {
    bindError.value = '请填写学生姓名和手机号'
    return
  }
  binding.value = true
  try {
    const resp = await fetch(`${API}/submit/public/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: publicToken.value, studentName, parentPhone }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || '绑定失败')
    localStorage.setItem(storageKey.value, data.submitToken)
    await useSubmitToken(data.submitToken)
  } catch (e: any) {
    bindError.value = e.message || '绑定失败，请重试'
  } finally {
    binding.value = false
  }
}

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
      // 识别失败不阻断家长提交
    } finally {
      item.visionLoading = false
    }
  }
}

function removeImage(index: number) {
  const [item] = uploadItems.value.splice(index, 1)
  if (item) URL.revokeObjectURL(item.preview)
}

async function submitHomework() {
  submitError.value = ''
  if (!submitToken.value) {
    submitError.value = '请先完成学生绑定'
    return
  }
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

    const resp = await fetch(`${API}/submit/${submitToken.value}`, { method: 'POST', body: fd })
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

function rebind() {
  localStorage.removeItem(storageKey.value)
  submitToken.value = ''
  studentConfig.value = null
  bindForm.studentName = ''
  bindForm.parentPhone = ''
}
</script>

<template>
  <div class="public-submit-page">
    <div class="submit-card">
      <div v-if="configError" class="state-box">
        <p class="state-title">链接无效</p>
        <p class="state-desc">{{ configError }}</p>
      </div>

      <template v-else-if="config && !studentConfig">
        <div class="card-header">
          <div class="term-label">{{ config.campName }} · {{ config.term }}</div>
          <h1>绑定学生后提交作业</h1>
          <p>{{ config.teacherName }}老师的班级通用收作业入口</p>
        </div>
        <form class="bind-form" @submit.prevent="bindStudent">
          <label>学生姓名</label>
          <input v-model="bindForm.studentName" placeholder="请输入孩子姓名" />
          <label>家长手机号</label>
          <input v-model="bindForm.parentPhone" inputmode="tel" placeholder="用于确认学生身份" />
          <p class="hint">首次验证后，本设备下次打开会直接进入提交页。</p>
          <p v-if="bindError" class="error-text">{{ bindError }}</p>
          <button :disabled="binding">{{ binding ? '绑定中...' : '确认绑定' }}</button>
        </form>
      </template>

      <template v-else-if="studentConfig">
        <div class="card-header compact">
          <div>
            <div class="student-name">{{ studentConfig.studentName }}</div>
            <div class="teacher-name">{{ studentConfig.teacherName }}老师</div>
          </div>
          <div class="term-label">{{ studentConfig.campName }} · {{ studentConfig.term }}</div>
        </div>

        <div v-if="submitted" class="state-box">
          <p class="state-title">已收到！</p>
          <p class="state-desc">老师正在批改中，完成后会反馈给你。</p>
          <button class="secondary-btn" @click="submitAnother">继续提交</button>
        </div>

        <div v-else class="card-body">
          <div class="switch-row">
            <span>不是 {{ studentConfig.studentName }}？</span>
            <button class="link-btn" @click="rebind">重新绑定</button>
          </div>

          <div class="upload-area">
            <input
              ref="fileInput"
              class="upload-input"
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              @change="onFileChange"
            />
            <div class="upload-icon">拍照</div>
            <p>点击拍照或选择作业图片</p>
            <span>建议拍摄清晰、完整的一页作业</span>
          </div>

          <div v-if="uploadItems.length" class="upload-list">
            <div v-for="(item, index) in uploadItems" :key="item.preview" class="upload-item">
              <img :src="item.preview" class="thumb-img" alt="作业预览" />
              <div class="upload-meta">
                <div class="upload-item-title">第 {{ index + 1 }} 张作业</div>
                <div class="meta-row compact">
                  <div>
                    <label>学期</label>
                    <input v-model="item.semester" placeholder="如：二下" :disabled="item.visionLoading" />
                  </div>
                  <div>
                    <label>第几天</label>
                    <input v-model="item.day" type="number" min="1" max="24" placeholder="如：3" :disabled="item.visionLoading" />
                  </div>
                </div>
                <p v-if="item.visionLoading" class="hint">正在自动识别学期和天数...</p>
              </div>
              <button class="remove-btn" @click.stop="removeImage(index)">x</button>
            </div>
          </div>
          <p v-if="submitError" class="error-text">{{ submitError }}</p>
          <button class="submit-btn" :disabled="!uploadItems.length || submitting" @click="submitHomework">
            {{ submitting ? '提交中...' : '提交作业' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.public-submit-page {
  min-height: 100vh;
  background: #f5f7fa;
  display: flex;
  justify-content: center;
  padding: 20px 16px 40px;
}

.submit-card {
  width: 100%;
  max-width: 460px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.card-header {
  padding: 24px 20px 18px;
  background: linear-gradient(135deg, #2563eb 0%, #6c8bff 100%);
  color: #fff;

  h1 {
    margin: 12px 0 6px;
    font-size: 22px;
  }

  p {
    margin: 0;
    opacity: 0.86;
    font-size: 13px;
  }

  &.compact {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}

.term-label {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 12px;
}

.student-name {
  font-size: 20px;
  font-weight: 700;
}

.teacher-name {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.82;
}

.bind-form,
.card-body,
.state-box {
  padding: 22px 20px 26px;
}

.bind-form {
  label {
    display: block;
    margin: 14px 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: #334155;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #dbe3ee;
    border-radius: 12px;
    padding: 12px;
    font-size: 16px;
  }

  button {
    width: 100%;
    margin-top: 16px;
    border: 0;
    border-radius: 12px;
    padding: 13px;
    background: #2563eb;
    color: #fff;
    font-size: 16px;
    font-weight: 700;
  }
}

.hint {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.error-text {
  color: #b91c1c;
  background: #fee2e2;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  color: #64748b;
  font-size: 13px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: #2563eb;
  font-weight: 700;
}

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
  text-align: center;

  &.has-image {
    border-style: solid;
  }

  p {
    margin: 0;
    font-weight: 700;
    color: #334155;
  }

  span {
    color: #94a3b8;
    font-size: 12px;
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

.upload-icon {
  color: #2563eb;
  font-size: 22px;
  font-weight: 700;
}

.remove-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
}

.upload-list {
  display: grid;
  gap: 12px;
  margin-top: 14px;
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
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.meta-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;

  &.compact {
    margin-top: 8px;
  }

  label {
    display: block;
    margin-bottom: 6px;
    color: #64748b;
    font-size: 13px;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #dbe3ee;
    border-radius: 10px;
    padding: 10px;
  }
}

.submit-btn,
.secondary-btn {
  width: 100%;
  margin-top: 16px;
  border: 0;
  border-radius: 12px;
  padding: 13px;
  background: #2563eb;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.state-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  color: #172033;
}

.state-desc {
  margin: 0;
  color: #64748b;
}
</style>
