import { OIIcon } from '@guanghe-pub/onion-ui'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import App from './App.vue'
import '@guanghe-pub/onion-ui/lib/base-css.css'
import 'katex/dist/katex.min.css'
import '~/styles/main.scss'
import { useApp } from '~/stores/useApp'

OIIcon.setIconJs('https://fp.yangcong345.com/middle/1.0.0/iconfont-2025-09-04.js')

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

function withBlankLayout(routeRecords: typeof routes) {
  for (const route of routeRecords) {
    if (route.path === '/login' || route.path === '/submit/:token' || route.path === '/submit/public/:token' || route.path === '/enroll/:token') {
      route.meta = { ...(route.meta || {}), layout: 'blank' }
    }
    if (route.children?.length) {
      withBlankLayout(route.children as typeof routes)
    }
  }
  return routeRecords
}

const router = createRouter({
  routes: setupLayouts(withBlankLayout(routes)),
  history: createWebHistory(import.meta.env.BASE_URL),
})

/** 公开路由（无需登录） */
const PUBLIC_ROUTES = ['/login', '/submit', '/enroll']

router.beforeEach(async (to) => {
  // 公开页面：/login、/submit/:token、/enroll/:token
  const isPublic = PUBLIC_ROUTES.some(prefix => to.path === prefix || to.path.startsWith(prefix + '/'))
  if (isPublic) return true

  const appStore = useApp(pinia)
  // 仅在首次检查时调用，后续路由跳转直接读缓存
  if (!appStore.authReady) {
    await appStore.checkAuth()
  }
  if (!appStore.loggedTeacher) {
    return '/login'
  }
  return true
})

app.use(router)
app.config.warnHandler = () => null
app.mount('#app')
