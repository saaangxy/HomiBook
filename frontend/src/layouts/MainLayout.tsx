import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Button,
  Avatar,
  Listbox,
  ListboxItem,
  Navbar,
  NavbarContent,
  NavbarItem,
  Divider,
} from '@heroui/react'
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
    <div className="flex h-screen bg-[#0f172a] text-[#e2e8f0] overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* 侧边栏 */}
      <aside
        className={`flex flex-col border-r border-[#1e293b] bg-[#0f172a] transition-all duration-300 ${
          collapsed ? 'w-[72px] min-w-[72px]' : 'w-[240px] min-w-[240px]'
        }`}
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

        {/* 导航 — 使用 Listbox */}
        <nav className="flex-1 px-3 overflow-y-auto">
          <Listbox
            aria-label="主导航"
            selectedKeys={new Set([location.pathname])}
            disallowEmptySelection
            onAction={(key) => navigate(key as string)}
            variant="light"
            className="gap-1"
            classNames={{
              base: 'p-0 gap-1',
              list: 'gap-1',
            }}
            itemClasses={{
              base: [
                'rounded-xl px-4 h-11 text-sm data-[hover=true]:bg-[#1e293b] data-[hover=true]:!text-[#e2e8f0]',
                'data-[selected=true]:!bg-[#f97316]/10 data-[selected=true]:!text-[#f97316] data-[selected=true]:font-semibold',
                'text-[#94a3b8]',
              ],
              title: 'text-sm font-medium',
            }}
          >
            {navItems.map((item) => (
              <ListboxItem
                key={item.path}
                startContent={<item.icon size={20} />}
                title={collapsed ? item.label : undefined}
              >
                {collapsed ? '' : item.label}
              </ListboxItem>
            ))}
          </Listbox>
        </nav>

        <Divider className="bg-[#1e293b]" />

        {/* 用户信息 */}
        <div className="p-3">
          <div className="flex items-center gap-3 p-3 rounded-xl">
            <Avatar
              name={user?.name || user?.email || 'U'}
              size="sm"
              classNames={{
                base: 'w-9 h-9 min-w-9 rounded-[10px] bg-[#f97316] shrink-0',
                name: 'text-white text-sm font-bold',
              }}
            />
            {!collapsed && (
              <div className="overflow-hidden whitespace-nowrap">
                <div className="text-sm font-semibold">{user?.name || '用户'}</div>
                <div className="text-xs text-[#64748b] mt-0.5 overflow-hidden text-ellipsis">
                  {user?.email || ''}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 — 使用 Navbar */}
        <Navbar
          maxWidth="full"
          position="static"
          className="h-16 min-h-16 border-b border-[#1e293b] bg-[#0f172a]"
          classNames={{ wrapper: 'px-8 h-full max-w-full' }}
        >
          <NavbarContent className="gap-4" justify="start">
            <NavbarItem>
              <Button
                isIconOnly
                variant="bordered"
                size="sm"
                onPress={() => setCollapsed(!collapsed)}
                className="w-9 h-9 min-w-9 rounded-[10px] border-[#334155] text-[#94a3b8] hover:!bg-[#1e293b] hover:!text-[#e2e8f0]"
              >
                {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
              </Button>
            </NavbarItem>
            <NavbarItem className="text-lg font-semibold text-[#e2e8f0]">
              {pageTitle}
            </NavbarItem>
          </NavbarContent>

          <NavbarContent className="gap-3" justify="end">
            <NavbarItem>
              <BookSwitcher />
            </NavbarItem>
            <NavbarItem>
              <Button
                variant="bordered"
                startContent={<LogOut size={16} />}
                onPress={handleLogout}
                className="rounded-[10px] border-[#334155] text-[#94a3b8] text-[13px] hover:!text-[#f97316] hover:!bg-[#1e293b]"
              >
                退出登录
              </Button>
            </NavbarItem>
          </NavbarContent>
        </Navbar>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
