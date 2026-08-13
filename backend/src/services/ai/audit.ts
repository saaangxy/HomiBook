import { prisma } from '../../app.js'

export interface AuditLogInput {
  userId: string
  sessionId?: string
  action: string
  toolName?: string
  input?: unknown
  output?: unknown
  modelProvider?: string
  modelName?: string
  durationMs?: number
  status?: string
  errorMessage?: string
  ip?: string
}

// 工具调用审计日志
export async function logToolCall(input: AuditLogInput): Promise<void> {
  try {
    await prisma.agentAuditLog.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId,
        action: input.action,
        toolName: input.toolName,
        input: input.input ? JSON.stringify(input.input) : null,
        output: input.output ? JSON.stringify(input.output) : null,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        durationMs: input.durationMs,
        status: input.status ?? 'success',
        errorMessage: input.errorMessage,
        ip: input.ip,
      },
    })
  } catch {
    // 审计日志写入失败不影响主流程
  }
}

// LLM 调用审计日志
export async function logModelCall(params: {
  userId: string
  sessionId?: string
  modelProvider: string
  modelName: string
  durationMs: number
  status: string
  errorMessage?: string
  input?: unknown
  output?: unknown
  ip?: string
}): Promise<void> {
  await logToolCall({
    userId: params.userId,
    sessionId: params.sessionId,
    action: 'model_call',
    modelProvider: params.modelProvider,
    modelName: params.modelName,
    durationMs: params.durationMs,
    status: params.status,
    errorMessage: params.errorMessage,
    input: params.input,
    output: params.output,
    ip: params.ip,
  })
}

// 清理过期审计日志，返回删除数量。保留天数从 SystemConfig.auditLogRetentionDays 读取，默认 7 天
export async function cleanupExpiredAuditLogs(): Promise<number> {
  const config = await prisma.systemConfig.findUnique({ where: { key: 'auditLogRetentionDays' } })
  let retentionDays = 7
  if (config?.value) {
    try { retentionDays = parseInt(JSON.parse(config.value)) || 7 } catch { /* 用默认值 */ }
  }
  const cutoff = new Date(Date.now() - retentionDays * 86400000)
  const result = await prisma.agentAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => null)
  return result?.count ?? 0
}
