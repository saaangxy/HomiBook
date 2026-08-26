import { api } from './http'
import type { AdminUser, AuditLogItem } from '@homibook/core'

export { type AdminUser, type AuditLogItem }

export const adminApi = {
  listUsers: () => api.get<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users),

  createUser: (data: { username: string; email: string; password: string; nickname?: string; role?: string }) =>
    api.post<AdminUser>('/api/admin/users', data),

  updateUser: (id: string, data: { nickname?: string; role?: string; status?: string }) =>
    api.patch<AdminUser>(`/api/admin/users/${id}`, data),

  changePassword: (id: string, password: string) =>
    api.patch<{ success: boolean }>(`/api/admin/users/${id}/password`, { password }),

  deleteUser: (id: string) =>
    api.delete<{ success: boolean }>(`/api/admin/users/${id}`),

  getAuditLogs: (query: {
    page?: number
    pageSize?: number
    userId?: string
    action?: string
    toolName?: string
    status?: string
    sessionId?: string
    startTime?: string
    endTime?: string
  }) => {
    const params = new URLSearchParams()
    if (query.page) params.set('page', String(query.page))
    if (query.pageSize) params.set('pageSize', String(query.pageSize))
    if (query.userId) params.set('userId', query.userId)
    if (query.action) params.set('action', query.action)
    if (query.toolName) params.set('toolName', query.toolName)
    if (query.status) params.set('status', query.status)
    if (query.sessionId) params.set('sessionId', query.sessionId)
    if (query.startTime) params.set('startTime', query.startTime)
    if (query.endTime) params.set('endTime', query.endTime)
    const qs = params.toString()
    return api.get<{ items: AuditLogItem[]; total: number; page: number; pageSize: number }>(
      `/api/admin/audit-logs${qs ? `?${qs}` : ''}`,
    )
  },
}


