import { useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAuthStore } from '../stores/auth'
import { useBookStore } from '../stores/book'
import { BookSwitcher } from '../components/BookSwitcher'
import {
  Book,
  LayoutDashboard,
  BarChart3,
  Settings,
  LogOut,
  Users,
  Wallet,
  ArrowLeftRight,
  CalendarDays,
  Target,
  Repeat,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const allNavItems = [
  { path: '/', label: '首页', icon: LayoutDashboard },
  { path: '/stats', label: '统计分析', icon: BarChart3 },
  { path: '/records/calendar', label: '流水日历', icon: CalendarDays },
  { path: '/records', label: '流水管理', icon: ArrowLeftRight },
  { path: '/accounts', label: '账户管理', icon: Wallet },
  { path: '/budgets', label: '预算管理', icon: Target },
  { path: '/recurring', label: '固定收支', icon: Repeat },
  { path: '/books', label: '账本管理', icon: Book },
  { path: '/admin/users', label: '用户管理', icon: Users, adminOnly: true },
  { path: '/settings', label: '设置', icon: Settings, adminOnly: true },
]

function NavItems() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'
  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin)

  return (
    <SidebarMenu>
      {navItems.map((item) => {
        const active = location.pathname === item.path
        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton
              onClick={() => navigate(item.path)}
              isActive={active}
              size="lg"
              tooltip={item.label}
              className={cn(
                active && 'text-[#f97316] hover:text-[#f97316]',
                '[&>svg]:size-5',
                'group-data-[collapsible=icon]:justify-center',
              )}
            >
              <item.icon />
              <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function SidebarUserFooter() {
  const { user } = useAuthStore()
  const { state } = useSidebar()

  return (
    <div className="flex items-center gap-3 p-3 group-data-[collapsible=icon]:p-1">
      <Avatar className="w-9 h-9 group-data-[collapsible=icon]:w-7 group-data-[collapsible=icon]:h-7 rounded-[10px] bg-[#f97316] shrink-0">
        <AvatarFallback className="text-white text-sm font-bold bg-[#f97316]">
          {(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {state === 'expanded' && (
        <div className="overflow-hidden whitespace-nowrap">
          <div className="text-sm font-semibold text-sidebar-foreground">
            {user?.name || '用户'}
          </div>
          <div className="text-xs text-sidebar-foreground/50 mt-0.5 overflow-hidden text-ellipsis">
            {user?.email || ''}
          </div>
        </div>
      )}
    </div>
  )
}

export function MainLayout() {
  const { logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const { fetchBooks, booksLoaded } = useBookStore()

  useEffect(() => {
    if (!booksLoaded) {
      fetchBooks()
    }
  }, [booksLoaded, fetchBooks])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const currentPage = allNavItems.find((item) => item.path === location.pathname)
  const pageTitle = currentPage?.label || '首页'

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar collapsible="icon">
        {/* Logo */}
        <SidebarHeader className="px-5 pt-5 pb-7 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:pt-4 group-data-[collapsible=icon]:pb-4">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
            <div className="w-10 h-10 min-w-10 group-data-[collapsible=icon]:w-7 group-data-[collapsible=icon]:h-7 group-data-[collapsible=icon]:min-w-7 rounded-xl bg-[#f97316] flex items-center justify-center">
              <Book size={22} color="#fff" />
            </div>
            <span className="text-xl font-extrabold text-[#f97316] tracking-tight whitespace-nowrap group-data-[collapsible=icon]:hidden">
              Homibook
            </span>
          </div>
        </SidebarHeader>

        {/* 导航 */}
        <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1.5">
          <NavItems />
        </SidebarContent>

        <SidebarSeparator />

        {/* 用户信息 */}
        <SidebarFooter className="group-data-[collapsible=icon]:p-1">
          <SidebarUserFooter />
        </SidebarFooter>
      </Sidebar>

      {/* 主区域 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="flex items-center justify-between px-8 py-4 border-b border-border h-16 min-h-16 bg-background">
          <div className="flex items-center gap-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
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
    </SidebarProvider>
  )
}
