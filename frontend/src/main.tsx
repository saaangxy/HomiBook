import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setUnauthorizedHandler } from './api/http'
import { useAuthStore } from './stores/auth'
import { resetAccountCaches } from './stores/reset-account'

/**
 * 凭据失效(401)时的统一处理:清掉与账号绑定的全部前端缓存,然后登出。
 * 登出后 token 为空,`ProtectedRoute` 会自动把用户送回登录页 —— 不必自己跳转,
 * 也就无需关心 base path 与路由模式。放在这里注入而不是写在 api 层,是为了避免
 * `api/http → stores → api/chat → api/http` 的循环依赖。
 */
setUnauthorizedHandler(() => {
  resetAccountCaches()
  useAuthStore.getState().logout()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
