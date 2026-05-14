import { api } from './http'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: { id: string; email: string; name: string | null } }>('/api/auth/login', { email, password }),

  register: (email: string, password: string, name?: string) =>
    api.post<{ id: string; email: string; name: string | null }>('/api/auth/register', { email, password, name }),

  me: () =>
    api.get<{ id: string; email: string; name: string | null }>('/api/auth/me'),
}