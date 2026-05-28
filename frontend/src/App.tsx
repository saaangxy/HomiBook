import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainLayout } from './layouts/MainLayout'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'
import { UsersPage } from './pages/UsersPage.tsx'
import { BooksPage } from './pages/BooksPage'
import { AccountsPage } from './pages/AccountsPage'
import { RecordsPage } from './pages/RecordsPage'
import { CalendarPage } from './pages/CalendarPage'
import { BudgetsPage } from './pages/BudgetsPage'
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
      <TooltipProvider delayDuration={300}>
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
              <Route path="stats" element={<PlaceholderPage title="统计分析" />} />
              <Route path="records/calendar" element={<CalendarPage />} />
              <Route path="records" element={<RecordsPage />} />
              <Route path="books" element={<BooksPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="budgets" element={<BudgetsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="admin/users" element={<UsersPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
