<script setup lang="ts">
import { useApp } from '~/stores/useApp'

const route = useRoute()
const router = useRouter()
const app = useApp()

onMounted(async () => {
  // 确保认证状态已初始化（路由守卫已处理，此处仅兜底）
  if (!app.authReady) await app.checkAuth()
  await app.loadCampContext()
  app.loadTeachers()
})

const activeNav = computed(() => {
  const p = route.path
  if (p === '/' || p === '/homework/' || p === '/homework') return 'correction'
  if (p.includes('/dashboard')) return 'dashboard'
  if (p.includes('/management')) return 'management'
  if (p.includes('/correction')) return 'correction'
  if (p.includes('/analytics')) return 'analytics'
  return 'dashboard'
})

const navItems = [
  { key: 'dashboard', label: '任务看板', path: '/dashboard' },
  { key: 'management', label: '班主任工作台', path: '/management' },
  { key: 'correction', label: '作业批改', path: '/' },
  { key: 'analytics', label: '学情分析', path: '/analytics' },
]

function navigateTo(path: string) {
  router.push(path)
}

/** 自定义下拉 */
const termOpen = ref(false)
const campOpen = ref(false)
const teacherOpen = ref(false)

function selectCamp(id: string) {
  app.setCamp(id)
  campOpen.value = false
}
function selectTerm(t: string) {
  app.setTerm(t)
  termOpen.value = false
}
function selectTeacher(id: string) {
  app.setTeacher(id)
  teacherOpen.value = false
}

// 点击外部关闭
const datePickerOpen = ref(false)

/** 起始日期显示文本 */
const startDateLabel = computed(() => {
  if (!app.termStartDate) return '设置起始日'
  const d = new Date(app.termStartDate + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()} 起`
})

function onDateChange(e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val) {
    app.saveTermStartDate(val)
    datePickerOpen.value = false
  }
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.dropdown') && !target.closest('.date-picker-wrap')) {
    campOpen.value = false
    termOpen.value = false
    teacherOpen.value = false
    datePickerOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="app-layout">
    <header class="global-nav">
      <div class="nav-left">
        <span class="nav-logo" @click="navigateTo('/dashboard')">营课管理系统</span>
        <nav class="nav-links">
          <a
            v-for="item in navItems"
            :key="item.key"
            :class="['nav-link', { active: activeNav === item.key }]"
            @click="navigateTo(item.path)"
          >
            {{ item.label }}
          </a>
        </nav>
      </div>
      <div class="nav-right">
        <!-- 营选择 -->
        <div v-if="app.camps.length > 0" class="dropdown" @click.stop="campOpen = !campOpen; termOpen = false; teacherOpen = false">
          <div class="dropdown-trigger camp-trigger">
            {{ app.currentCampName || '选择营' }}
            <span class="dropdown-arrow">▾</span>
          </div>
          <div v-if="campOpen" class="dropdown-menu">
            <div
              v-for="camp in app.camps" :key="camp.id"
              :class="['dropdown-item', { active: app.currentCampId === camp.id }]"
              @click.stop="selectCamp(camp.id)"
            >{{ camp.name }}</div>
          </div>
        </div>
        <!-- 期选择 -->
        <div v-if="app.terms.length > 0" class="dropdown" @click.stop="termOpen = !termOpen; campOpen = false; teacherOpen = false">
          <div class="dropdown-trigger">
            {{ app.currentTerm || '选择期' }}
            <span class="dropdown-arrow">▾</span>
          </div>
          <div v-if="termOpen" class="dropdown-menu">
            <div
              v-for="t in app.terms" :key="t"
              :class="['dropdown-item', { active: app.currentTerm === t }]"
              @click.stop="selectTerm(t)"
            >{{ t }}</div>
          </div>
        </div>
        <!-- 起始日期 -->
        <div v-if="app.currentTerm" class="date-picker-wrap">
          <span class="date-label" @click.stop="datePickerOpen = !datePickerOpen">{{ startDateLabel }}</span>
          <div v-if="datePickerOpen" class="date-popover" @click.stop>
            <input type="date" :value="app.termStartDate || ''" @change="onDateChange" />
          </div>
        </div>
        <!-- 登录态：显示当前老师名 + 退出 -->
        <div v-if="app.loggedTeacher" class="teacher-identity">
          <span class="teacher-name">{{ app.loggedTeacher.name }}</span>
          <button class="logout-btn" @click="app.logout()">退出</button>
        </div>
        <!-- 未使用飞书 OAuth 时保留老师下拉（兼容本地开发） -->
        <div v-else-if="app.teachers.length > 0" class="dropdown" @click.stop="teacherOpen = !teacherOpen; campOpen = false; termOpen = false">
          <div class="dropdown-trigger">
            {{ app.currentTeacherName || '选择老师' }}
            <span class="dropdown-arrow">▾</span>
          </div>
          <div v-if="teacherOpen" class="dropdown-menu">
            <div
              v-for="t in app.teachers" :key="t.id"
              :class="['dropdown-item', { active: app.currentTeacherId === t.id }]"
              @click.stop="selectTeacher(t.id)"
            >{{ t.name }}</div>
          </div>
        </div>
      </div>
    </header>

    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style lang="scss" scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.global-nav {
  height: 48px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.nav-logo {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-primary);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.nav-links { display: flex; gap: 4px; }

.nav-link {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;

  &:hover { color: var(--color-text); background: #f5f5f5; }
  &.active { color: var(--color-primary); background: rgba(79, 110, 247, 0.08); font-weight: 500; }
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 自定义下拉 */
.dropdown {
  position: relative;
}

.dropdown-trigger {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  background: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
  white-space: nowrap;

  &:hover { border-color: #bbb; }
}

.dropdown-arrow {
  font-size: 10px;
  color: #999;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 100%;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 4px;
  z-index: 200;
}

.dropdown-item {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;

  &:hover { background: #f5f5f5; }
  &.active { color: var(--color-primary); font-weight: 500; background: rgba(79, 110, 247, 0.06); }
}

/* 起始日期 */
.date-picker-wrap {
  position: relative;
}

.date-label {
  height: 30px;
  padding: 0 10px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  white-space: nowrap;
  user-select: none;

  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
}

.date-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 8px;
  z-index: 200;

  input[type="date"] {
    font-size: 13px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 4px 8px;
    outline: none;

    &:focus { border-color: var(--color-primary); }
  }
}

.teacher-identity {
  display: flex;
  align-items: center;
  gap: 8px;
}

.teacher-name {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
}

.logout-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: #ff4d4f;
    color: #ff4d4f;
  }
}

.app-main { flex: 1; }
</style>
