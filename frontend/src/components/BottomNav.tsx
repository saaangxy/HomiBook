import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ArrowLeftRight, BarChart3, Settings, type LucideIcon } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

const ITEMS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: '/', label: '首页', icon: LayoutDashboard },
  { path: '/records', label: '流水', icon: ArrowLeftRight },
  { path: '/stats', label: '统计', icon: BarChart3 },
  { path: '/settings', label: '设置', icon: Settings },
]

export function BottomNav() {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  if (!isMobile) return null

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4 h-16">
        {ITEMS.map((item) => {
          const active = pathname === item.path
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 text-[11px]',
                'transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}