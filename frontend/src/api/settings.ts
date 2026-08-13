import { api } from './http'

export interface DictItem {
  id: string
  group: string
  code: string
  label: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface PublicConfig {
  registrationOpen: boolean
  defaultTheme?: string
}

export const settingsApi = {
  getPublicConfig: () =>
    api.get<PublicConfig>('/api/settings/public'),

  getConfig: () =>
    api.get<Record<string, unknown>>('/api/settings/config'),

  updateConfig: (data: { registrationOpen?: boolean; defaultCurrency?: string; amountHighlightThreshold?: number; holidayApiUrl?: string; defaultTheme?: string; jwtExpiresIn?: string; auditLogRetentionDays?: string }) =>
    api.put<{ success: boolean }>('/api/settings/config', data),

  getDictionary: (group: string) =>
    api.get<DictItem[]>(`/api/settings/dictionary/${group}`),

  createDictionaryItem: (data: { group: string; code: string; label: string; order?: number }) =>
    api.post<DictItem>('/api/settings/dictionary', data),

  updateDictionaryItem: (id: string, data: { code?: string; label?: string; order?: number }) =>
    api.patch<DictItem>(`/api/settings/dictionary/${id}`, data),

  deleteDictionaryItem: (id: string) =>
    api.delete<{ success: boolean }>(`/api/settings/dictionary/${id}`),

  getOrphanAttachments: () =>
    api.get<Array<{ id: string; path: string; originalFilename: string; createdAt: string; fileExists: boolean }>>('/api/settings/attachments/orphans'),

  cleanOrphanAttachments: () =>
    api.post<{ deletedFiles: number; deletedRecords: number }>('/api/settings/attachments/clean-orphans', {}),
}
