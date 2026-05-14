import { http } from './http'

export const authApi = {
  login: (email: string, password: string) =>
    http.post<{ token: string; user: { id: string; email: string; name: string | null } }>('/auth/login', { email, password }),

  register: (email: string, password: string, name?: string) =>
    http.post<{ id: string; email: string; name: string | null }>('/auth/register', { email, password, name }),

  me: () =>
    http.get<{ id: string; email: string; name: string | null }>('/auth/me'),
}