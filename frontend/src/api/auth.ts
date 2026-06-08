import { api } from './http'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: { id: string; email: string; name: string | null; role: string } }>('/api/auth/login', { email, password }),

  register: (email: string, password: string, name?: string) =>
    api.post<{ id: string; email: string; name: string | null; role: string }>('/api/auth/register', { email, password, name }),

  me: () =>
    api.get<{ id: string; email: string; name: string | null; role: string }>('/api/auth/me'),

  updateProfile: (name: string) =>
    api.patch<{ id: string; email: string; name: string | null; role: string }>('/api/auth/me', { name }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<{ success: boolean }>('/api/auth/me/password', { currentPassword, newPassword }),
}