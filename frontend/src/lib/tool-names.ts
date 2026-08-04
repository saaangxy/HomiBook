import { fetchTools } from '@/api/chat'

// 工具名称缓存：name -> displayName
let cache: Record<string, string> | null = null
let loadPromise: Promise<void> | null = null

/** 预加载工具名称列表（首次调用后缓存，后续调用 no-op） */
export function loadToolNames(): Promise<void> {
  if (cache) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = fetchTools()
    .then(groups => {
      cache = {}
      for (const g of groups) {
        for (const t of g.tools) {
          cache[t.name] = t.displayName
        }
      }
    })
    .catch(() => {})
  return loadPromise
}

/** 同步获取工具显示名称，未加载时回退到 toolName */
export function getToolDisplayName(toolName: string): string {
  return cache?.[toolName] || toolName
}
