import { useThemeContext } from '@/components/ThemeProvider'
import { creativeThemeIds, themes } from '@/themes'
import { Monitor, Sun, Moon, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThemeSelectorProps {
  /** 是否显示"跟随系统"选项 */
  showSystem?: boolean
  /** 紧凑模式：小尺寸，适合弹窗 */
  compact?: boolean
  /** 受控模式：外部指定选中值 */
  value?: string
  /** 受控模式：外部 onChange */
  onChange?: (id: string) => void
}

export function ThemeSelector({ showSystem = true, compact = false, value, onChange }: ThemeSelectorProps) {
  const ctx = useThemeContext()
  // 非受控模式使用 context，受控模式使用外部 props
  const themeId = value !== undefined ? value : ctx.themeId
  const setTheme = onChange || ctx.setTheme

  const allOptions = [
    ...(showSystem ? [{ id: 'system', name: '跟随系统', description: '自动匹配系统明暗模式', type: 'system' as const }] : []),
    { id: 'light', name: '浅色', description: '干净清爽的浅色主题', type: 'light' as const },
    { id: 'dark', name: '深色', description: '深色背景配橙色强调', type: 'dark' as const },
    ...creativeThemeIds.map(id => ({ id, name: themes[id].name, description: themes[id].description, type: 'creative' as const })),
  ]

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {allOptions.map((opt) => {
          const isActive = themeId === opt.id || (opt.id === 'system' && themeId === 'system')
          const t = themes[opt.id]
          return (
            <button
              key={opt.id}
              onClick={() => setTheme(opt.id)}
              className={cn(
                'flex items-center gap-2.5 p-2.5 rounded-[10px] border text-left transition-all',
                isActive
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border hover:bg-accent',
              )}
            >
              {opt.type === 'system' ? (
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted">
                  <Monitor size={14} className="text-muted-foreground" />
                </div>
              ) : opt.type === 'light' ? (
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-100">
                  <Sun size={14} className="text-amber-500" />
                </div>
              ) : opt.type === 'dark' ? (
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-700">
                  <Moon size={14} className="text-slate-200" />
                </div>
              ) : (
                <div className="flex gap-0.5">
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-white/20"
                    style={{ backgroundColor: `hsl(${t!.vars['--primary']})` }}
                  />
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-white/20"
                    style={{ backgroundColor: `hsl(${t!.vars['--background']})` }}
                  />
                </div>
              )}
              <span className="text-sm flex-1">{opt.name}</span>
              {isActive && <Check size={14} className="text-primary shrink-0" />}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {allOptions.map((opt) => {
        const isActive = themeId === opt.id
        const t = themes[opt.id]
        return (
          <button
            key={opt.id}
            onClick={() => setTheme(opt.id)}
            className={cn(
              'flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all',
              isActive
                ? 'border-primary bg-primary/5 shadow-md'
                : 'border-border hover:bg-accent hover:border-accent-foreground/20',
            )}
          >
            <div className="flex items-center gap-2.5">
              {opt.type === 'system' ? (
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted">
                  <Monitor size={20} className="text-muted-foreground" />
                </div>
              ) : opt.type === 'light' ? (
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100">
                  <Sun size={20} className="text-amber-500" />
                </div>
              ) : opt.type === 'dark' ? (
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-700">
                  <Moon size={20} className="text-slate-200" />
                </div>
              ) : (
                <div className="flex gap-1">
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white/30 shadow-sm"
                    style={{ backgroundColor: `hsl(${t!.vars['--primary']})` }}
                  />
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white/30 shadow-sm"
                    style={{ backgroundColor: `hsl(${t!.vars['--background']})` }}
                  />
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white/30 shadow-sm"
                    style={{ backgroundColor: `hsl(${t!.vars['--accent'] || '0 0% 80%'})` }}
                  />
                </div>
              )}
              <span className="font-semibold text-sm">{opt.name}</span>
              {isActive && <Check size={16} className="text-primary shrink-0 ml-auto" />}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{opt.description}</p>
          </button>
        )
      })}
    </div>
  )
}
