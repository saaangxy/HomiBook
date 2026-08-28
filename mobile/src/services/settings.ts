import { http } from './http';

// 设置页数据访问层(对齐 web settingsApi/apikeyApi/importExportApi/holidayApi 及 AI 配置端点)

export interface DictItem {
  id: string;
  group: string;
  code: string;
  label: string;
  order: number;
}

export const settingsApi = {
  getConfig: () => http.get<Record<string, unknown>>('/api/settings/config'),
  updateConfig: (data: {
    registrationOpen?: boolean;
    defaultCurrency?: string;
    amountHighlightThreshold?: number;
    holidayApiUrl?: string;
    defaultTheme?: string;
    jwtExpiresIn?: string;
    auditLogRetentionDays?: string;
  }) => http.put<{ success: boolean }>('/api/settings/config', data),
  getDictionary: (group: string) => http.get<DictItem[]>(`/api/settings/dictionary/${group}`),
  createDictionaryItem: (data: { group: string; code: string; label: string; order?: number }) =>
    http.post<DictItem>('/api/settings/dictionary', data),
  updateDictionaryItem: (id: string, data: { code?: string; label?: string; order?: number }) =>
    http.patch<DictItem>(`/api/settings/dictionary/${id}`, data),
  deleteDictionaryItem: (id: string) => http.delete<{ success: boolean }>(`/api/settings/dictionary/${id}`),
  getOrphanAttachments: () =>
    http.get<Array<{ id: string; path: string; originalFilename: string; createdAt: string; fileExists: boolean }>>('/api/settings/attachments/orphans'),
  cleanOrphanAttachments: () => http.post<{ deletedFiles: number; deletedRecords: number }>('/api/settings/attachments/clean-orphans', {}),
};

export const holidayApi = {
  sync: () => http.post<{ imported: number }>('/api/holidays/sync', {}),
};

export interface ApiKeyItem {
  id: string;
  userName: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const apikeyApi = {
  list: () => http.get<ApiKeyItem[]>('/api/apikeys'),
  create: (data: { name: string }) => http.post<{ id: string; name: string; prefix: string; key: string }>('/api/apikeys', data),
  delete: (id: string) => http.delete<{ success: boolean }>(`/api/apikeys/${id}`),
};

export interface CategoryMapping {
  id: string;
  source: string;
  sourceCategory: string;
  payerContains: string;
  descriptionContains: string;
  recordType: string;
  targetCategoryCode: string;
}

export interface AccountMapping {
  id: string;
  source: string;
  sourceAccountName: string;
  payerContains: string;
  descriptionContains: string;
  targetAccountName: string;
}

export const importExportApi = {
  getMappings: (source?: string) =>
    http.get<{ mappings: CategoryMapping[] }>(`/api/records/import/mappings${source ? `?source=${encodeURIComponent(source)}` : ''}`),
  saveMappings: (mappings: { source: string; sourceCategory: string; payerContains?: string; descriptionContains?: string; recordType?: string; targetCategoryCode: string }[]) =>
    http.post<{ success: boolean }>('/api/records/import/mappings', { mappings }),
  deleteMapping: (id: string) => http.delete<{ success: boolean }>(`/api/records/import/mappings/${id}`),
  getAccountMappings: (source?: string) =>
    http.get<{ mappings: AccountMapping[] }>(`/api/records/import/account-mappings${source ? `?source=${encodeURIComponent(source)}` : ''}`),
  saveAccountMappings: (mappings: { source: string; sourceAccountName: string; payerContains?: string; descriptionContains?: string; targetAccountName: string }[]) =>
    http.post<{ success: boolean }>('/api/records/import/account-mappings', { mappings }),
  deleteAccountMapping: (id: string) => http.delete<{ success: boolean }>(`/api/records/import/account-mappings/${id}`),
};

// ── AI 配置(对齐 web /api/chat 端点) ──
export interface ProviderInfo {
  value: string;
  label: string;
  defaultModels: string[];
  defaultBaseURL: string;
}

export interface UserAIConfig {
  enabled: boolean;
  simpleProviderConfigId: string | null;
  simpleModel: string;
  complexProviderConfigId: string | null;
  complexModel: string;
  autoConfirmCreate: boolean;
  language: string;
  maxSteps: number;
  visionProviderConfigId: string | null;
  visionModel: string;
  disabledTools: string[];
}

export interface UserProviderConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseURL: string;
  models: string;
  temperature: number | null;
  maxTokens: number | null;
  contextWindow: number | null;
  testStatus: string;
}

export interface ToolInfo {
  name: string;
  displayName: string;
  description: string;
  requireConfirm: boolean;
}

const AI_BASE = '/api/chat';

export const aiAdminApi = {
  fetchAIConfig: () => http.get<UserAIConfig>(`${AI_BASE}/ai-config`),
  updateAIConfig: (data: Partial<UserAIConfig>) => http.put(`${AI_BASE}/ai-config`, data),
  fetchProviders: () => http.get<{ providers: ProviderInfo[] }>(`${AI_BASE}/providers`).then((r) => r.providers),
  fetchProviderConfigs: () => http.get<UserProviderConfig[]>(`${AI_BASE}/provider-configs`),
  createProviderConfig: (data: Partial<UserProviderConfig>) => http.post<UserProviderConfig>(`${AI_BASE}/provider-configs`, data),
  updateProviderConfig: (id: string, data: Partial<UserProviderConfig>) => http.put<UserProviderConfig>(`${AI_BASE}/provider-configs/${id}`, data),
  deleteProviderConfig: (id: string) => http.delete(`${AI_BASE}/provider-configs/${id}`),
  copyProviderConfig: (id: string) => http.post<UserProviderConfig>(`${AI_BASE}/provider-configs/${id}/copy`, {}),
  testProviderConnection: (data: { provider: string; apiKey: string; baseURL: string; model?: string; configId?: string }) =>
    http.post<{ success: boolean; message: string; models?: string[] }>(`${AI_BASE}/providers/test`, data),
  fetchProviderModels: (provider: string, baseURL?: string, apiKey?: string, configId?: string) => {
    const q = new URLSearchParams({ provider } as Record<string, string>);
    if (baseURL) q.set('baseURL', baseURL);
    if (apiKey) q.set('apiKey', apiKey);
    if (configId) q.set('configId', configId);
    return http.get<{ models: string[] }>(`${AI_BASE}/providers/models?${q}`).then((r) => r.models);
  },
  fetchTools: () => http.get<{ groups: { label: string; tools: ToolInfo[] }[] }>(`${AI_BASE}/tools`).then((r) => r.groups),
  fetchSearchEngine: () => http.get<{ engine: string }>(`${AI_BASE}/search-engine`).then((r) => r.engine),
  updateSearchEngine: (engine: string) => http.post(`${AI_BASE}/search-engine`, { engine }),
};

// ── AI 记忆 ──
export interface UserMemory {
  id: string;
  content: string;
  memoryType: string;
  importance: number;
}

export const memoryApi = {
  fetchMemories: () => http.get<{ memories: UserMemory[] }>(`${AI_BASE}/memories`).then((r) => r.memories),
  deleteMemory: (id: string) => http.delete(`${AI_BASE}/memories/${id}`),
  updateMemory: (id: string, data: { content?: string; importance?: number }) => http.patch(`${AI_BASE}/memories/${id}`, data),
};

export async function fetchAppVersion(): Promise<string> {
  const res = await http.get<{ version: string }>('/api/version').catch(() => null);
  return res?.version ?? '';
}
