import type { BackupFrequency, BackupSettings, BackupSnapshotMeta } from '@homibook/core';
import { http } from './http';

// 服务端快照备份(与 web 端 backupApi 共用同一组接口;移动端不提供下载)

export interface BackupSchedulePatch {
  enabled?: boolean;
  retention?: number;
}

export interface BackupSettingsPatch {
  includeAttachments?: boolean;
  schedules?: Partial<Record<BackupFrequency, BackupSchedulePatch>>;
}

export interface CreateSnapshotParams {
  includeAttachments?: boolean;
}

export interface RestoreSnapshotResult {
  restored: boolean;
  safetySnapshotId: string | null;
  results: Record<string, number>;
  attachmentsRestored: number;
  skipped?: number;
  appVersion?: string;
  exportedAt?: string;
}

const BASE = '/api/settings/backup';
const SNAPSHOTS = `${BASE}/snapshots`;

// 备份/恢复涉及磁盘归档,默认 10s 超时不够用
const LONG_TIMEOUT = { timeoutMs: 5 * 60_000 };

export const backupApi = {
  getSettings: () => http.get<BackupSettings>(`${BASE}/settings`),
  updateSettings: (data: BackupSettingsPatch) => http.put<BackupSettings>(`${BASE}/settings`, data),
  listSnapshots: () => http.get<BackupSnapshotMeta[]>(SNAPSHOTS),
  createSnapshot: (params: CreateSnapshotParams) => http.post<BackupSnapshotMeta>(SNAPSHOTS, params, LONG_TIMEOUT),
  deleteSnapshot: (id: string) => http.delete<{ success: boolean }>(`${SNAPSHOTS}/${id}`),
  restoreSnapshot: (id: string, data: { safetyBackup?: boolean }) =>
    http.post<RestoreSnapshotResult>(`${SNAPSHOTS}/${id}/restore`, data, LONG_TIMEOUT),
};
