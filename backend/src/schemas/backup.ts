import { z } from 'zod'

/** 单个频率的可编辑配置（状态字段由服务端维护，不接受客户端写入） */
const backupSchedulePatchSchema = z.object({
  enabled: z.boolean().optional(),
  retention: z.number().int().min(1).max(30).optional(),
})

export const backupSettingsSchema = z.object({
  includeAttachments: z.boolean().optional(),
  schedules: z
    .object({
      daily: backupSchedulePatchSchema.optional(),
      weekly: backupSchedulePatchSchema.optional(),
      monthly: backupSchedulePatchSchema.optional(),
    })
    .optional(),
})

/** 备份固定为全量数据，只允许选择是否打包附件文件 */
export const createSnapshotSchema = z.object({
  includeAttachments: z.boolean().optional(),
})

export const restoreSnapshotSchema = z.object({
  safetyBackup: z.boolean().optional().default(true),
})
