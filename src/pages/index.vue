<script setup lang="ts">
import type { JobItem } from '~/stores/useJobList'
import { useJobList } from '~/stores/useJobList'

const API = import.meta.env.VITE_API_BASE || '/api'
const store = useJobList()
const router = useRouter()

const deleteConfirmId = ref<string | null>(null)

onMounted(() => {
  store.init()
})

onUnmounted(() => {
  store.stopPolling()
})

function openCorrection(jobId: string) {
  router.push(`/correction?jobId=${encodeURIComponent(jobId)}`)
}

function confirmDelete(jobId: string) {
  deleteConfirmId.value = jobId
}

async function doDelete() {
  if (!deleteConfirmId.value) return
  await store.deleteJob(deleteConfirmId.value)
  deleteConfirmId.value = null
}

function cancelDelete() {
  deleteConfirmId.value = null
}

/** 状态标签配置 */
const statusConfig: Record<JobItem['status'], { label: string, className: string }> = {
  pending: { label: '待处理', className: 'status--pending' },
  processing: { label: '处理中', className: 'status--processing' },
  done: { label: '已完成', className: 'status--done' },
  fail: { label: '处理失败', className: 'status--fail' },
}

function formatTime(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="page">
    <div class="main-layout">
      <div class="list-panel">
        <div class="list-header">
          <h2 class="panel-title">作业记录</h2>
          <span class="list-count">共 {{ store.jobs.length }} 条</span>
        </div>

        <div v-if="store.isLoading" class="list-loading">
          <div class="spinner-sm" />
          <span>加载中...</span>
        </div>

        <div v-else-if="store.jobs.length === 0" class="list-empty">
          <p>暂无作业记录</p>
          <p class="list-empty__hint">上传作业图片后，记录会出现在这里</p>
        </div>

        <div v-else class="job-list">
          <div
            v-for="job in store.jobs"
            :key="job.jobId"
            class="job-card"
            :class="{ 'job-card--clickable': job.status === 'done' }"
            @click="job.status === 'done' && openCorrection(job.jobId)"
          >
            <!-- 缩略图 -->
            <div class="job-thumb">
              <img
                v-if="job.hasImage"
                :src="`${API}/correction/image/${job.jobId}`"
                loading="lazy"
              />
              <div v-else class="job-thumb__placeholder">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </div>
            </div>

            <!-- 信息 -->
            <div class="job-info">
              <div class="job-info__top">
                <span class="job-name">{{ job.studentName || '未知' }}</span>
                <span v-if="job.semester" class="job-meta">{{ job.semester }}</span>
                <span v-if="job.day" class="job-day">D{{ job.day }}</span>
              </div>
              <div class="job-info__bottom">
                <span class="job-time">{{ formatTime(job.savedAt) }}</span>
              </div>
            </div>

            <!-- 状态 -->
            <div class="job-status">
              <span class="status-tag" :class="statusConfig[job.status].className">
                <span v-if="job.status === 'processing'" class="status-dot" />
                {{ statusConfig[job.status].label }}
              </span>
            </div>

            <!-- 操作 -->
            <div class="job-actions" @click.stop>
              <button
                v-if="job.status === 'done'"
                class="action-btn action-btn--view"
                @click.stop="openCorrection(job.jobId)"
                title="查看批改结果"
              >
                查看
              </button>
              <button
                class="action-btn action-btn--delete"
                @click.stop="confirmDelete(job.jobId)"
                title="删除"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <div v-if="deleteConfirmId" class="modal-overlay" @click.self="cancelDelete">
        <div class="modal-card">
          <p class="modal-text">确定要删除这条作业记录吗？</p>
          <p class="modal-hint">删除后无法恢复</p>
          <div class="modal-actions">
            <button class="modal-btn modal-btn--cancel" @click="cancelDelete">取消</button>
            <button class="modal-btn modal-btn--confirm" @click="doDelete">确认删除</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 20px 32px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;

  h1 {
    font-size: 22px;
    font-weight: 700;
  }
}

.header-badge {
  padding: 3px 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

/* 主布局：左右分栏 */
.main-layout {
  display: flex;
  gap: 24px;
  height: calc(100vh - 100px);
}

.upload-panel {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow);
  overflow-y: auto;
}

.list-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow);
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

/* 拖拽上传区 */
.drop-zone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    background: rgba(79, 110, 247, 0.02);
  }

  &.dragging {
    border-color: var(--color-primary);
    background: rgba(79, 110, 247, 0.05);
  }

  &__icon {
    margin-bottom: 12px;
  }

  &__text {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text);
    margin-bottom: 4px;
  }

  &__hint {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-bottom: 16px;
  }

  &__btn {
    display: inline-block;
    padding: 8px 24px;
    background: var(--color-primary);
    color: #fff;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: var(--color-primary-hover);
    }
  }
}

/* 图片预览 */
.preview-area {
  margin-bottom: 16px;
}

.preview-img-wrap {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  background: #f5f5f5;
}

.preview-img {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  display: block;
}

.preview-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: rgba(0, 0, 0, 0.7);
  }
}

/* 表单 */
.form-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.form-row {
  display: flex;
  gap: 12px;

  .form-group {
    flex: 1;
    min-width: 0;
  }
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.required {
  color: #ef4444;
}

.analyzing-tag {
  font-size: 11px;
  color: var(--color-primary);
  font-weight: 400;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: var(--color-primary);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &::placeholder {
    color: var(--color-text-secondary);
    opacity: 0.5;
  }
}

.submit-btn {
  margin-top: 4px;
  padding: 10px 0;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  &:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 列表头部 */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .panel-title {
    margin-bottom: 0;
  }
}

.list-count {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.spinner-sm {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.list-empty {
  text-align: center;
  padding: 60px 0;
  color: var(--color-text-secondary);

  p {
    font-size: 14px;
    margin-bottom: 4px;
  }

  &__hint {
    font-size: 12px;
    opacity: 0.6;
  }
}

/* 作业列表 */
.job-list {
  flex: 1;
  overflow-y: auto;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.job-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  transition: all 0.15s;

  &--clickable {
    cursor: pointer;

    &:hover {
      border-color: var(--color-primary);
      background: rgba(79, 110, 247, 0.02);
    }
  }
}

/* 缩略图 */
.job-thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: #f5f5f5;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ccc;
  }
}

/* 信息区 */
.job-info {
  flex: 1;
  min-width: 0;

  &__top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  &__bottom {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.job-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.job-meta {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.job-day {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
  padding: 1px 6px;
  background: rgba(79, 110, 247, 0.08);
  border-radius: 3px;
}

.job-time {
  font-size: 12px;
  color: var(--color-text-secondary);
  opacity: 0.7;
}

/* 状态标签 */
.job-status {
  flex-shrink: 0;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status--pending {
  background: #f3f4f6;
  color: #6b7280;
}

.status--processing {
  background: rgba(59, 130, 246, 0.08);
  color: #3b82f6;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
  animation: pulse 1.5s ease-in-out infinite;
}

.status--done {
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
}

.status--fail {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

/* 操作按钮 */
.job-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;

  &--view {
    color: var(--color-primary);
    border-color: var(--color-primary);

    &:hover {
      background: var(--color-primary);
      color: #fff;
    }
  }

  &--delete {
    color: var(--color-text-secondary);

    &:hover {
      color: #ef4444;
      border-color: #ef4444;
    }
  }
}

/* 删除确认弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: 32px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  max-width: 360px;
  width: 100%;
  text-align: center;
}

.modal-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.modal-hint {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 24px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.modal-btn {
  padding: 8px 24px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-border);
  transition: all 0.15s;

  &--cancel {
    background: transparent;
    color: var(--color-text-secondary);

    &:hover {
      border-color: var(--color-text-secondary);
    }
  }

  &--confirm {
    background: #ef4444;
    color: #fff;
    border-color: #ef4444;

    &:hover {
      background: #dc2626;
    }
  }
}
</style>
