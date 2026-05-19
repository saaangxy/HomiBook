import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Tooltip } from '@heroui/react'
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

        {/* 导航 */}
        <nav className="flex-1 flex flex-col gap-1 px-3">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            return (
              <Tooltip
                key={item.path}
                content={item.label}
                placement="right"
                isDisabled={!collapsed}
                showArrow
                classNames={{ content: 'bg-[#1e293b] border border-[#334155] text-[#e2e8f0] text-sm rounded-lg' }}
              >
                <button
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors duration-200 w-full text-left whitespace-nowrap text-sm ${
                    active
                      ? 'bg-[#f97316]/10 text-[#f97316] font-semibold'
                      : 'text-[#94a3b8] hover:bg-[#1e293b]'
                  }`}
                  style={{ border: 'none', background: active ? 'rgba(249,115,22,0.1)' : 'transparent', fontFamily: 'inherit', fontSize: 14 }}
                  onClick={() => navigate(item.path)}
                >
                  <Icon size={20} className="min-w-5" />
                  {!collapsed && item.label}
                </button>
              </Tooltip>
            )
          })}
        </nav>

        {/* 用户信息 */}
        <div className="p-3 border-t border-[#1e293b]">
          <div className="flex items-center gap-3 p-3 rounded-xl">
            <div className="w-9 h-9 min-w-9 rounded-[10px] bg-[#f97316] text-white flex items-center justify-center text-sm font-bold">
              {(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
            </div>
            {!collapsed && (
              <div className="overflow-hidden whitespace-nowrap">
                <div className="text-sm font-semibold text-[#e2e8f0]">
                  {user?.name || '用户'}
                </div>
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
        {/* 顶部栏 */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-[#1e293b] h-16 min-h-16">
          <div className="flex items-center gap-4">
            <button
              className="w-9 h-9 rounded-[10px] border border-[#334155] bg-transparent text-[#94a3b8] cursor-pointer flex items-center justify-center transition-colors duration-200 hover:bg-[#1e293b] hover:text-[#e2e8f0]"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
            </button>
            <span className="text-lg font-semibold text-[#e2e8f0]">{pageTitle}</span>
          </div>

          <div className="flex items-center gap-3">
            <BookSwitcher />
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[#334155] bg-transparent text-[#94a3b8] cursor-pointer text-[13px] transition-colors duration-200 hover:bg-[#1e293b] hover:text-[#f97316]"
              style={{ fontFamily: 'inherit' }}
              onClick={handleLogout}
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
