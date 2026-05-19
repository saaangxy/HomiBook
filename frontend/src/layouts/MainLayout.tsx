import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { useAuthStore } from '../stores/auth'
import { useBookStore } from '../stores/book'
import { BookSwitcher } from '../components/BookSwitcher'
import {
  Book,
  LayoutDashboard,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  Menu,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const allNavItems = [
  { path: '/', label: '首页', icon: LayoutDashboard },
  { path: '/books', label: '账本管理', icon: Book },
  { path: '/stats', label: '统计分析', icon: BarChart3 },
  { path: '/admin/users', label: '用户管理', icon: Users, adminOnly: true },
  { path: '/settings', label: '设置', icon: Settings },
]

export function MainLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const isAdmin = user?.role === 'ADMIN'
  const { fetchBooks, booksLoaded } = useBookStore()

  useEffect(() => {
    if (!booksLoaded) {
      fetchBooks()
    }
  }, [booksLoaded, fetchBooks])

  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const currentPage = allNavItems.find((item) => item.path === location.pathname)
  const pageTitle = currentPage?.label || '首页'

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* 侧边栏 */}
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-background transition-all duration-300',
          collapsed ? 'w-[72px] min-w-[72px]' : 'w-[240px] min-w-[240px]',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-7">
          <div className="w-10 h-10 min-w-10 rounded-xl bg-[#f97316] flex items-center justify-center">
            <Book size={22} color="#fff" />
          </div>
          {!collapsed && (
            <span className="text-xl font-extrabold text-[#f97316] tracking-tight whitespace-nowrap">
              Homibook
            </span>
          )}
        </div>

        {/* 导航 */}
        <nav className="flex-1 flex flex-col gap-1 px-3">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            const button = (
              <Button
                variant="ghost"
                onClick={() => navigate(item.path)}
                className={cn(
                  'justify-start px-4 h-11 rounded-xl text-sm w-full',
                  active
                    ? 'bg-[#f97316]/10 text-[#f97316] font-semibold hover:bg-[#f97316]/15 hover:text-[#f97316]'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon size={20} className="shrink-0" />
                {!collapsed && <span className="ml-3">{item.label}</span>}
              </Button>
            )

            if (collapsed) {
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              )
            }
            return <div key={item.path}>{button}</div>
          })}
        </nav>

        <Separator />

        {/* 用户信息 */}
        <div className="p-3">
          <div className="flex items-center gap-3 p-3 rounded-xl">
            <Avatar className="w-9 h-9 rounded-[10px] bg-[#f97316] shrink-0">
              <AvatarFallback className="text-white text-sm font-bold bg-[#f97316]">
                {(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="overflow-hidden whitespace-nowrap">
                <div className="text-sm font-semibold">{user?.name || '用户'}</div>
                <div className="text-xs text-muted-foreground mt-0.5 overflow-hidden text-ellipsis">
                  {user?.email || ''}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="flex items-center justify-between px-8 py-4 border-b border-border h-16 min-h-16 bg-background">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCollapsed(!collapsed)}
              className="w-9 h-9 rounded-[10px] border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
            </Button>
            <span className="text-lg font-semibold">{pageTitle}</span>
          </div>

          <div className="flex items-center gap-3">
            <BookSwitcher />
            <Button
              variant="outline"
              onClick={handleLogout}
              className="rounded-[10px] border-border text-muted-foreground text-[13px] hover:text-[#f97316] hover:bg-accent"
            >
              <LogOut size={16} />
              退出登录
            </Button>
          </div>
        </header>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
