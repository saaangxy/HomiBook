import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HeroUIProvider } from '@heroui/react'
import { MainLayout } from './layouts/MainLayout'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { useAuthStore } from './stores/auth'

const queryClient = new QueryClient()

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HeroUIProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="books" element={<PlaceholderPage title="账本管理" />} />
              <Route path="stats" element={<PlaceholderPage title="统计分析" />} />
              <Route path="settings" element={<PlaceholderPage title="设置" />} />
              <Route path="admin/users" element={<AdminUsersPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </HeroUIProvider>
    </QueryClientProvider>
  )
}

export default App
