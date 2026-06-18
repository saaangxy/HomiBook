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
