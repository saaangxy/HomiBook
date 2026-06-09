import { createContext, useContext, useEffect, useCallback, useState, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { themes, defaultTheme, getTheme, getSystemThemeId, creativeThemeIds, type Theme } from '@/themes'

const STORAGE_KEY = 'homibook-theme'

interface ThemeContextValue {
  theme: Theme
  themeId: string
  setTheme: (id: string) => void
  themeList: Theme[]
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes[defaultTheme],
  themeId: defaultTheme,
  setTheme: () => {},
  themeList: Object.values(themes),
})

export function useThemeContext() {
  return useContext(ThemeContext)
}

function applyThemeVars(vars: Record<string, string>) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

function getStoredPreference(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

function savePreference(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* noop */ }
}

/** 解析偏好 ID → 实际主题 ID */
function resolveActualId(prefId: string): string {
  if (prefId === 'system') return getSystemThemeId()
  if (themes[prefId]) return prefId
  return defaultTheme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuthStore()

  // 初始化偏好 ID
  const [prefId, setPrefId] = useState<string>(() => {
    if (user?.theme) return user.theme
    return getStoredPreference() || 'system'
  })

  const actualId = resolveActualId(prefId)
  const theme = getTheme(actualId)

  // 应用 CSS 变量 + data-theme 属性
  const applyTheme = useCallback((actual: string, pref: string) => {
    const t = themes[actual]
    if (!t) return
    applyThemeVars(t.vars)
    document.documentElement.setAttribute('data-theme', actual)
    savePreference(pref)
  }, [])

  const setTheme = useCallback(async (newPrefId: string) => {
    const newActual = resolveActualId(newPrefId)
    if (!themes[newActual]) return

    applyTheme(newActual, newPrefId)
    setPrefId(newPrefId)

    if (user) {
      try {
        const updated = await authApi.updateProfile(undefined, newPrefId)
        updateUser(updated)
      } catch { /* 后端失败不影响前端 */ }
    }
  }, [user, updateUser, applyTheme])

  // 初始化时应用主题
  useEffect(() => {
    applyTheme(actualId, prefId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 用户登录/切换时同步个人主题
  useEffect(() => {
    if (user?.theme && user.theme !== prefId) {
      const newActual = resolveActualId(user.theme)
      if (themes[newActual]) {
        applyTheme(newActual, user.theme)
        setPrefId(user.theme)
      }
    }
  }, [user?.theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // 监听系统主题变化（偏好为 "system" 时）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      setPrefId((current) => {
        if (current === 'system') {
          const newActual = getSystemThemeId()
          applyTheme(newActual, 'system')
        }
        return current
      })
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [applyTheme])

  const themeList = creativeThemeIds.map(id => themes[id]).filter(Boolean)

  return (
    <ThemeContext.Provider value={{ theme, themeId: prefId, setTheme, themeList }}>
      {children}
    </ThemeContext.Provider>
  )
}
