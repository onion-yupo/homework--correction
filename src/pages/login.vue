<script setup lang="ts">
import { useApp } from '~/stores/useApp'

defineOptions({ name: 'LoginPage' })

// 此页面使用空白布局，不显示顶部导航

const app = useApp()

// 已登录则直接跳转
const router = useRouter()
onMounted(async () => {
  const ok = await app.checkAuth()
  if (ok) router.replace('/')
})

function login() {
  app.loginWithFeishu()
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">计算营 AI Copilot</div>
      <p class="login-desc">辅导老师专属系统，请用飞书账号登录</p>
      <button class="login-btn" @click="login">
        <img src="https://lf-open.larksuitecdn.com/obj/lark-open-ability/cn/2023/0523/feishu.png" class="feishu-icon" alt="飞书" />
        飞书登录
      </button>
      <p class="login-hint">仅限系统内老师账号，如需开通请联系管理员</p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f0f4ff 0%, #e8f3ff 100%);
}

.login-card {
  width: 360px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(79, 110, 247, 0.12);
  padding: 48px 40px;
  text-align: center;
}

.login-logo {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-primary, #4f6ef7);
  margin-bottom: 12px;
  letter-spacing: -0.3px;
}

.login-desc {
  font-size: 14px;
  color: #666;
  margin-bottom: 36px;
  line-height: 1.6;
}

.login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 48px;
  background: #3370ff;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #2860f0;
    box-shadow: 0 4px 16px rgba(51, 112, 255, 0.3);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
}

.feishu-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.login-hint {
  margin-top: 20px;
  font-size: 12px;
  color: #aaa;
  line-height: 1.5;
}
</style>
