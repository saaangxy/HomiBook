/**
 * 账号域缓存的统一清理入口。
 *
 * 聊天是 zustand(模块级),auth 可以直接调;但**账本 / 流水**是 React Context,
 * 定义在 `AuthProvider` 的**内层**,auth 拿不到它们的 setter。
 *
 * 所以由各 Provider 挂载时把自己的清理函数注册进来,登出 / 切账号 / 换服务器时
 * 统一调用 —— 而不是依赖 `isLoggedIn → ledger 清空 → bookId 变空 → records 清空`
 * 这种多级 effect 级联推导(能生效,但改一处就容易漏)。
 *
 * 清理动作必须是幂等的:重复调用无副作用(注册表与 effect 驱动会并存一段时间)。
 */
type CacheResetter = () => void;

const resetters = new Set<CacheResetter>();

/** 注册一个账号域缓存的清理函数;返回注销函数(Provider 卸载时调用) */
export function registerAccountCache(reset: CacheResetter): () => void {
  resetters.add(reset);
  return () => {
    resetters.delete(reset);
  };
}

/** 清空所有已注册的账号域缓存 */
export function resetRegisteredCaches() {
  for (const reset of resetters) reset();
}
