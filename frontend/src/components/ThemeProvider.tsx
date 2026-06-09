import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { themes, defaultTheme, getTheme, type Theme } from '@/themes'

interface ThemeContextValue {
  theme: Theme
  setTheme: (id: string) => void
  themeList: Theme[]
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes[defaultTheme],
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuthStore()

  const themeId = user?.theme || defaultTheme
  const theme = getTheme(themeId)

  const setTheme = useCallback(async (id: string) => {
    if (!themes[id]) return
    const t = themes[id]
    applyThemeVars(t.vars)
    // 持久化到后端
    try {
      const updated = await authApi.updateProfile(undefined, id)
      updateUser(updated)
    } catch {
      // 即使后端失败也保持前端主题
    }
  }, [updateUser])

  // 初始化时应用主题（未登录也应用默认主题）
  useEffect(() => {
    applyThemeVars(theme.vars)
  }, [user?.theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themeList: Object.values(themes) }}>
      {children}
    </ThemeContext.Provider>
  )
}
