import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
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

// 内联样式，与登录页风格一致
const s = {
  layout: {
    display: 'flex',
    height: '100vh',
    background: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#e2e8f0',
    overflow: 'hidden',
  } as React.CSSProperties,

  sidebar: {
    width: '240px',
    minWidth: '240px',
    background: '#0f172a',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    transition: 'all 0.3s ease',
    overflow: 'hidden',
  } as React.CSSProperties,

  sidebarCollapsed: {
    width: '72px',
    minWidth: '72px',
  },

  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '20px 20px 28px',
  },

  logo: {
    width: '40px',
    height: '40px',
    minWidth: '40px',
    backgroundColor: '#f97316',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  logoText: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#f97316',
    letterSpacing: '-0.5px',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  nav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '0 12px',
  } as React.CSSProperties,

  navItem: (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: '12px',
    cursor: 'pointer',
    color: active ? '#f97316' : '#94a3b8',
    backgroundColor: active ? 'rgba(249, 115, 22, 0.1)' : 'transparent',
    border: 'none',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: active ? 600 : 400,
    transition: 'all 0.2s ease',
    width: '100%',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  } as React.CSSProperties),

  navIcon: {
    width: '20px',
    height: '20px',
    minWidth: '20px',
  },

  sidebarFooter: {
    padding: '16px 12px',
    borderTop: '1px solid #1e293b',
  },

  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  avatar: {
    width: '36px',
    height: '36px',
    minWidth: '36px',
    borderRadius: '10px',
    backgroundColor: '#f97316',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
  },

  userInfo: {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  userName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },

  userEmail: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as React.CSSProperties,

  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as React.CSSProperties,

  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 32px',
    borderBottom: '1px solid #1e293b',
    height: '64px',
    minHeight: '64px',
  },

  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },

  toggleBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid #334155',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },

  pageTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e2e8f0',
  },

  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  } as React.CSSProperties,

  logoutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderRadius: '10px',
    border: '1px solid #334155',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '13px',
    transition: 'all 0.2s ease',
  },

  content: {
    flex: 1,
    overflow: 'auto',
    padding: '32px',
  } as React.CSSProperties,
}

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
    <div style={s.layout}>
      {/* 侧边栏 */}
      <aside
        style={{
          ...s.sidebar,
          ...(collapsed ? s.sidebarCollapsed : {}),
        }}
      >
        {/* Logo */}
        <div style={s.sidebarHeader}>
          <div style={s.logo}>
            <Book size={22} color="#fff" />
          </div>
          {!collapsed && <span style={s.logoText}>Homibook</span>}
        </div>

        {/* 导航 */}
        <nav style={s.nav}>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            return (
              <button
                key={item.path}
                style={s.navItem(active)}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={20} style={s.navIcon} />
                {!collapsed && item.label}
              </button>
            )
          })}
        </nav>

        {/* 用户信息 */}
        <div style={s.sidebarFooter}>
          <div style={s.userCard}>
            <div style={s.avatar}>
              {(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
            </div>
            {!collapsed && (
              <div style={s.userInfo}>
                <div style={s.userName}>{user?.name || '用户'}</div>
                <div style={s.userEmail}>{user?.email || ''}</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <main style={s.main}>
        {/* 顶部栏 */}
        <div style={s.topBar}>
          <div style={s.topBarLeft}>
            <button
              style={s.toggleBtn}
              onClick={() => setCollapsed(!collapsed)}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#1e293b'
                e.currentTarget.style.color = '#e2e8f0'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = '#94a3b8'
              }}
            >
              {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
            </button>
            <span style={s.pageTitle}>{pageTitle}</span>
          </div>

          <div style={s.topBarRight}>
            <BookSwitcher />
            <button
              style={s.logoutBtn}
              onClick={handleLogout}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#1e293b'
                e.currentTarget.style.color = '#f97316'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = '#94a3b8'
              }}
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div style={s.content}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
