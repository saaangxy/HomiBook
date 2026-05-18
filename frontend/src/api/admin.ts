import { api } from './http'

export interface AdminUser {
  id: string
  email: string
  name: string | null
  role: 'ADMIN' | 'USER'
  status: 'ACTIVE' | 'DISABLED'
  createdAt: string
}

export const adminApi = {
  listUsers: () => api.get<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users),

  createUser: (data: { email: string; password: string; name?: string; role?: string }) =>
    api.post<AdminUser>('/api/admin/users', data),

  updateUser: (id: string, data: { name?: string; role?: string; status?: string }) =>
    api.patch<AdminUser>(`/api/admin/users/${id}`, data),

  changePassword: (id: string, password: string) =>
    api.patch<{ success: boolean }>(`/api/admin/users/${id}/password`, { password }),

  deleteUser: (id: string) =>
    api.delete<{ success: boolean }>(`/api/admin/users/${id}`),
}
