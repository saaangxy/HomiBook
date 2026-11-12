// 简单的进程内 TTL 缓存
class TTLCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>()

  get(key: string): unknown | undefined {
    const e = this.store.get(key)
    if (!e) return undefined
    if (e.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return e.value
  }

  set(key: string, value: unknown, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
}

// 账户余额历史缓存
export const balanceHistoryCache = new TTLCache()

// 余额历史缓存 TTL(120 秒)
export const BAL_HIST_TTL_MS = 120_000