/**
 * 从 catch 到的未知错误里取出可展示的文案。
 *
 * 为什么需要它:`catch (e: any)` 会在每个调用点重复写一遍 `e.message`,而实际错误形状有三种 ——
 * axios 包装过的 `{ response: { data: { message } } }`、普通 `Error`、以及抛字符串/对象的边界情况。
 * 统一在这里收口,调用方只写 `catch (e)` 即可,不必为了取一个字段开 any。
 */
export function errorMessage(e: unknown, fallback = '操作失败'): string {
  if (typeof e === 'string') return e || fallback

  const err = e as { message?: unknown; response?: { data?: { message?: unknown } } } | null

  const fromResponse = err?.response?.data?.message
  if (typeof fromResponse === 'string' && fromResponse) return fromResponse

  const message = err?.message
  if (typeof message === 'string' && message) return message

  return fallback
}
