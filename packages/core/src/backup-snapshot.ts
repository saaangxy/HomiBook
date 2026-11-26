// 备份快照：三端共用的类型、定时预设与展示工具
import { BACKUP_MODULES } from './backup.js';

/** 快照来源：手动 / 定时 / 恢复前的安全备份 */
export type BackupTrigger = 'MANUAL' | 'SCHEDULED' | 'SAFETY';

export type BackupStatus = 'SUCCESS' | 'FAILED';

/** 定时备份频率：每天 / 每周 / 每月，各自独立开关与保留份数 */
export type BackupFrequency = 'daily' | 'weekly' | 'monthly';

/** 快照的数据范围（目前始终是全量数据，仅附件文件可选） */
export interface BackupSnapshotScope {
  /** 固定为 'all'：只支持全量备份 */
  bookIds: 'all' | string[];
  /** 模块 key 列表（见 BACKUP_MODULES） */
  modules: string[];
  includeAttachments: boolean;
}

export interface BackupSnapshotMeta {
  id: string;
  filename: string;
  /** 字节数 */
  size: number;
  createdAt: string;
  trigger: BackupTrigger;
  /** 定时备份所属频率（手动/安全备份为空） */
  schedule?: BackupFrequency;
  status: BackupStatus;
  error?: string;
  appVersion: string;
  scope: BackupSnapshotScope;
}

export interface BackupLastResult {
  at: string;
  status: BackupStatus;
  error?: string;
}

/** 单个定时频率的状态与配置 */
export interface BackupScheduleState {
  enabled: boolean;
  /** 该频率备份的保留份数 */
  retention: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: BackupLastResult | null;
}

/** 备份配置（存于服务端 backups/settings.json） */
export interface BackupSettings {
  /** 是否把附件文件一起打包（手动与定时共用） */
  includeAttachments: boolean;
  schedules: Record<BackupFrequency, BackupScheduleState>;
}

/** 定时预设：频率 + 固定执行时间 */
export interface BackupSchedulePreset {
  key: BackupFrequency;
  label: string;
  /** 展示用执行时间说明 */
  timeLabel: string;
  /** 5 段 cron 表达式 */
  cron: string;
}

export const BACKUP_SCHEDULES: BackupSchedulePreset[] = [
  { key: 'daily', label: '每天', timeLabel: '每天 03:00', cron: '0 3 * * *' },
  { key: 'weekly', label: '每周', timeLabel: '每周一 03:00', cron: '0 3 * * 1' },
  { key: 'monthly', label: '每月', timeLabel: '每月 1 日 03:00', cron: '0 3 1 * *' },
];

export const BACKUP_FREQUENCY_LABELS: Record<BackupFrequency, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

export const DEFAULT_BACKUP_RETENTION = 7;

export const RETENTION_OPTIONS = [3, 7, 15, 30];

function defaultSchedule(): BackupScheduleState {
  return {
    enabled: false,
    retention: DEFAULT_BACKUP_RETENTION,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
  };
}

/** 每次返回全新对象，避免共享的可变默认值 */
export function createDefaultBackupSettings(): BackupSettings {
  return {
    includeAttachments: true,
    schedules: {
      daily: defaultSchedule(),
      weekly: defaultSchedule(),
      monthly: defaultSchedule(),
    },
  };
}

export const BACKUP_TRIGGER_LABELS: Record<BackupTrigger, string> = {
  MANUAL: '手动备份',
  SCHEDULED: '定时备份',
  SAFETY: '安全备份',
};

/** 字节数转可读大小 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 列表里的一句话范围描述 */
export function describeBackupScope(scope: BackupSnapshotScope): string {
  const books = scope.bookIds === 'all' ? '全部账本' : `${scope.bookIds.length} 个账本`;
  const fullModules = scope.modules.length >= BACKUP_MODULES.length;
  const modules = fullModules ? '全量模块' : `${scope.modules.length} 个模块`;
  const attachments = scope.includeAttachments ? '含附件' : '不含附件';
  return `${books} · ${modules} · ${attachments}`;
}
