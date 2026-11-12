import { BACKUP_MODULES as CORE_BACKUP_MODULES, type BackupModuleOption } from '@homibook/core'
import { api } from './http'

export interface BackupBook {
  id: string
  name: string
}

/** 模块清单与后端共用（@homibook/core/src/backup.ts），此处只做类型别名 */
export type BackupModule = BackupModuleOption

export const BACKUP_MODULES: BackupModule[] = CORE_BACKUP_MODULES

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
