import { Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, User } from '@heroui/react'
import { LogOut, Book, Settings } from 'lucide-react'

export function MainLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Book className="w-6 h-6 text-primary" />
            <span className="font-bold text-xl">Homibook</span>
          </div>

          <div className="flex items-center gap-4">
            <Dropdown>
              <DropdownTrigger>
                <Button variant="light" className="p-0 min-w-0 h-auto">
                  <User
                    name={user?.name || user?.email || 'User'}
                    description={user?.email || ''}
                    avatarProps={{ name: user?.name?.[0] || user?.email?.[0] || 'U' }}
                  />
                </Button>
              </DropdownTrigger>
              <DropdownMenu aria-label="User menu">
                <DropdownItem key="settings" startContent={<Settings className="w-4 h-4" />}>
                  Settings
                </DropdownItem>
                <DropdownItem
                  key="logout"
                  color="danger"
                  startContent={<LogOut className="w-4 h-4" />}
                  onClick={handleLogout}
                >
                  Logout
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}