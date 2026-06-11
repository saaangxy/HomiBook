import { api } from './http'

export const authApi = {
  login: (account: string, password: string) =>
    api.post<{ token: string; user: { id: string; username: string | null; email: string; nickname: string | null; role: string; theme: string } }>('/api/auth/login', { account, password }),

  register: (username: string, email: string, password: string, nickname?: string) =>
    api.post<{ id: string; username: string; email: string; nickname: string | null; role: string }>('/api/auth/register', { username, email, password, nickname }),

  me: () =>
    api.get<{ id: string; email: string; username: string | null; nickname: string | null; role: string; theme: string }>('/api/auth/me'),

  updateProfile: (nickname?: string, theme?: string) =>
    api.patch<{ id: string; email: string; username: string | null; nickname: string | null; role: string; theme: string }>('/api/auth/me', { nickname, theme }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<{ success: boolean }>('/api/auth/me/password', { currentPassword, newPassword }),
}
