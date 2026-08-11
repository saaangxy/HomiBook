import { api } from './http'

export interface BackupBook {
  id: string
  name: string
}

/** 与后端 services/backup/modules.ts 的 MODULE_OPTIONS 保持一致 */
export interface BackupModule {
  key: string
  label: string
  core: boolean
  bookScoped: boolean
}

export const BACKUP_MODULES: BackupModule[] = [
  { key: 'systemConfig', label: '系统配置', core: true, bookScoped: false },
  { key: 'dictionary', label: '字典', core: false, bookScoped: false },
  { key: 'holiday', label: '节假日', core: false, bookScoped: false },
  { key: 'user', label: '用户', core: true, bookScoped: false },
  { key: 'accountBook', label: '账本', core: true, bookScoped: true },
  { key: 'account', label: '账户', core: true, bookScoped: true },
  { key: 'record', label: '流水', core: true, bookScoped: true },
  { key: 'budget', label: '预算', core: false, bookScoped: true },
  { key: 'recurring', label: '固定收支', core: false, bookScoped: true },
  { key: 'importMapping', label: '导入映射', core: false, bookScoped: false },
  { key: 'aiConfig', label: 'AI 助手配置', core: false, bookScoped: false },
  { key: 'aiChat', label: 'AI 聊天记录', core: false, bookScoped: true },
  { key: 'apiKey', label: 'API Key', core: false, bookScoped: false },
  { key: 'attachments', label: '附件（含文件）', core: false, bookScoped: true },
]

export interface ExportBackupParams {
  scope: 'full' | 'attachments'
  bookIds?: string[]
  modules?: string[]
  includeAttachments?: boolean
}

/** 导入前检查备份包（返回 manifest 关键信息，用于区分数据包/附件包） */
export interface BackupInspectResult {
  scope: 'full' | 'attachments'
  appVersion?: string
  exportedAt?: string
  modules?: string[]
  includeAttachments?: boolean
}

export interface ImportResult {
  scope: 'full' | 'attachments'
  results: Record<string, number>
  attachmentsRestored: number
  skipped?: number
  appVersion?: string
}

export const backupApi = {
  listBooks: () => api.get<BackupBook[]>('/api/settings/backup/books'),
  exportBackup: (params: ExportBackupParams) => api.download('/api/settings/backup/export', params),
  inspectBackup: (file: File) => api.uploadForm('/api/settings/backup/import/inspect', file, {}),
  importBackup: (file: File) => api.uploadForm<ImportResult>('/api/settings/backup/import', file, {}),
}
