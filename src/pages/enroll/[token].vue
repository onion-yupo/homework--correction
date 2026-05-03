<script setup lang="ts">
defineOptions({ name: 'EnrollPage' })

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))

const API = import.meta.env.VITE_API_BASE || '/api'

interface Config {
  teacherName: string
  campName: string
  term: string
}

const config = ref<Config | null>(null)
const configError = ref('')

// 表单字段
const form = reactive({
  studentName: '',
  semester: '',
  selfLevel: '',
  weakPoints: '',
  parentConcern: '',
  parentName: '',
  parentPhone: '',
})

const semesterOptions = [
  '一上', '一下', '二上', '二下', '三上', '三下',
  '四上', '四下', '五上', '五下', '六上', '六下',
]

const selfLevelOptions = ['优秀', '良好', '一般', '较弱']

const submitting = ref(false)
const submitted = ref(false)
const submitError = ref('')

onMounted(async () => {
  try {
    const resp = await fetch(`${API}/enroll/config/${token.value}`)
    if (!resp.ok) throw new Error('链接无效')
    config.value = await resp.json()
  } catch (e: any) {
    configError.value = e.message || '链接无效或已过期'
  }
})

async function submit() {
  submitError.value = ''
  if (!form.studentName.trim()) {
    submitError.value = '请填写孩子姓名'
    return
  }
  if (!form.semester) {
    submitError.value = '请选择年级/学期'
    return
  }
  if (!form.parentPhone.trim()) {
    submitError.value = '请填写家长手机号'
    return
  }
  submitting.value = true
  try {
    const resp = await fetch(`${API}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value, ...form }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || '提交失败')
    submitted.value = true
  } catch (e: any) {
    submitError.value = e.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="enroll-page">
    <div class="enroll-card">
      <!-- 错误状态 -->
      <div v-if="configError" class="error-state">
        <div class="error-icon">⚠️</div>
        <p class="error-msg">{{ configError }}</p>
        <p class="error-hint">请联系老师重新发送入营链接</p>
      </div>

      <!-- 已提交成功 -->
      <div v-else-if="submitted" class="success-state">
        <div class="success-icon">🎉</div>
        <h2 class="success-title">建档成功！</h2>
        <p class="success-desc">欢迎加入{{ config?.campName || '营课' }}，老师已收到你的信息！</p>
        <p class="success-hint">后续老师会将专属作业提交链接发给你，每天提交作业即可。</p>
      </div>

      <!-- 表单 -->
      <template v-else-if="config">
        <div class="card-header">
          <div class="camp-badge">{{ config.campName || '营课' }}</div>
          <h1 class="card-title">入营登记</h1>
          <p class="card-subtitle">{{ config.teacherName }} 老师邀请你填写，信息仅供辅导使用</p>
        </div>

        <form class="enroll-form" @submit.prevent="submit">
          <div class="field required">
            <label class="field-label">孩子姓名</label>
            <input
              v-model="form.studentName"
              type="text"
              class="field-input"
              placeholder="请输入孩子的真实姓名"
              maxlength="20"
            />
          </div>

          <div class="field required">
            <label class="field-label">年级 / 学期</label>
            <div class="radio-grid">
              <label
                v-for="opt in semesterOptions"
                :key="opt"
                :class="['radio-item', { selected: form.semester === opt }]"
              >
                <input v-model="form.semester" type="radio" :value="opt" hidden />
                {{ opt }}
              </label>
            </div>
          </div>

          <div class="field">
            <label class="field-label">孩子当前数学水平（自评）</label>
            <div class="radio-row">
              <label
                v-for="opt in selfLevelOptions"
                :key="opt"
                :class="['level-item', { selected: form.selfLevel === opt }]"
              >
                <input v-model="form.selfLevel" type="radio" :value="opt" hidden />
                {{ opt }}
              </label>
            </div>
          </div>

          <div class="field">
            <label class="field-label">薄弱知识点 <span class="optional">选填</span></label>
            <textarea
              v-model="form.weakPoints"
              class="field-textarea"
              placeholder="例如：分数计算、应用题审题"
              rows="3"
            />
          </div>

          <div class="field">
            <label class="field-label">希望老师重点关注的方面 <span class="optional">选填</span></label>
            <textarea
              v-model="form.parentConcern"
              class="field-textarea"
              placeholder="例如：做题速度、书写习惯、容易粗心"
              rows="3"
            />
          </div>

          <div class="field">
            <label class="field-label">家长姓名 <span class="optional">选填</span></label>
            <input
              v-model="form.parentName"
              type="text"
              class="field-input"
              placeholder="选填"
              maxlength="20"
            />
          </div>

          <div class="field required">
            <label class="field-label">家长手机号</label>
            <input
              v-model="form.parentPhone"
              type="tel"
              inputmode="tel"
              class="field-input"
              placeholder="用于之后提交作业时验证身份"
              maxlength="20"
            />
            <p class="field-hint">手机号仅用于匹配学生身份，系统只保存加密后的 hash。</p>
          </div>

          <p v-if="submitError" class="submit-error">{{ submitError }}</p>

          <button type="submit" class="submit-btn" :disabled="submitting">
            {{ submitting ? '提交中...' : '确认提交' }}
          </button>
        </form>
      </template>

      <!-- 加载中 -->
      <div v-else class="loading-state">
        <div class="loading-spinner" />
        <p>加载中...</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.enroll-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 20px 16px 40px;
  display: flex;
  justify-content: center;
}

.enroll-card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

/* 头部 */
.card-header {
  padding: 28px 24px 20px;
  background: linear-gradient(135deg, #4f6ef7 0%, #6c8bff 100%);
  color: #fff;
}

.camp-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 20px;
  padding: 2px 10px;
  margin-bottom: 10px;
  letter-spacing: 1px;
}

.card-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 6px;
}

.card-subtitle {
  font-size: 13px;
  opacity: 0.85;
  margin: 0;
}

/* 表单 */
.enroll-form {
  padding: 24px 20px 28px;
}

.field {
  margin-bottom: 22px;

  &.required .field-label::after {
    content: ' *';
    color: #ff4d4f;
  }
}

.field-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 8px;
}

.optional {
  font-size: 12px;
  font-weight: 400;
  color: #aaa;
  margin-left: 4px;
}

.field-hint {
  margin: 7px 0 0;
  color: #8a94a6;
  font-size: 12px;
  line-height: 1.5;
}

.field-input {
  width: 100%;
  height: 44px;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 15px;
  color: #222;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;

  &:focus { border-color: #4f6ef7; }
  &::placeholder { color: #bbb; }
}

.field-textarea {
  width: 100%;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 15px;
  color: #222;
  outline: none;
  resize: vertical;
  font-family: inherit;
  line-height: 1.6;
  transition: border-color 0.2s;
  box-sizing: border-box;

  &:focus { border-color: #4f6ef7; }
  &::placeholder { color: #bbb; }
}

.radio-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.radio-item {
  height: 38px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #444;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;

  &:hover { border-color: #4f6ef7; color: #4f6ef7; }

  &.selected {
    border-color: #4f6ef7;
    background: rgba(79, 110, 247, 0.08);
    color: #4f6ef7;
    font-weight: 500;
  }
}

.radio-row {
  display: flex;
  gap: 8px;
}

.level-item {
  flex: 1;
  height: 38px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #444;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;

  &:hover { border-color: #4f6ef7; color: #4f6ef7; }

  &.selected {
    border-color: #4f6ef7;
    background: rgba(79, 110, 247, 0.08);
    color: #4f6ef7;
    font-weight: 500;
  }
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

  &:hover:not(:disabled) {
    background: #3a5de8;
    box-shadow: 0 4px 16px rgba(79, 110, 247, 0.3);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

/* 状态页 */
.error-state, .success-state, .loading-state {
  padding: 60px 24px;
  text-align: center;
}

.error-icon, .success-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-msg { font-size: 16px; color: #333; font-weight: 500; margin-bottom: 8px; }
.error-hint { font-size: 13px; color: #999; }

.success-title { font-size: 22px; font-weight: 700; color: #333; margin-bottom: 12px; }
.success-desc { font-size: 15px; color: #555; margin-bottom: 8px; }
.success-hint { font-size: 13px; color: #999; line-height: 1.6; }

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #4f6ef7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
