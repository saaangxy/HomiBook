import { useChatStore } from './chat'
import { useBookStore } from './book'

/**
 * 清理「与账号绑定」的全部前端缓存。
 *
 * 在**登出**与**登录/注册成功**时调用。这些缓存分两类，都会跨账号残留：
 *   - `useBookStore`(账本列表/当前账本):persist 到 localStorage `book-storage`;
 *   - `useChatStore`(AI 会话与消息):纯内存。
 *
 * 为什么不放在 `stores/auth.ts` 里:那样 `auth → chat → book → api/book` 会绕回 auth,
 * 形成循环依赖。放到这里由调用方显式调用,依赖方向是单向的。
 */
export function resetAccountCaches() {
  useChatStore.getState().reset()
  useBookStore.getState().reset()
}
