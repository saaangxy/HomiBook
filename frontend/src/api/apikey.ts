import { api } from './http'

export interface ApiKeyItem {
  id: string
  userId: string
  userName: string
  name: string
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export interface ApiKeyCreated {
  id: string
  name: string
  prefix: string
  key: string
  createdAt: string
}

export const apikeyApi = {
  list: () =>
    api.get<ApiKeyItem[]>('/api/apikeys'),

  create: (data: { name: string }) =>
    api.post<ApiKeyCreated>('/api/apikeys', data),

  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/api/apikeys/${id}`),
}
