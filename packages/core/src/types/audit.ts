/** AI 审计日志领域类型(权威,以后端响应为准) */

export type AuditAction = 'tool_call' | 'confirm' | 'reject' | 'model_call';

export interface AuditLogItem {
  id: string;
  sessionId: string | null;
  sessionSummary: string | null;
  userId: string;
  userNickname: string | null;
  username: string | null;
  action: AuditAction | string;
  toolName: string | null;
  input: string | null;
  output: string | null;
  modelProvider: string | null;
  modelName: string | null;
  durationMs: number | null;
  status: string;
  errorMessage: string | null;
  ip: string | null;
  createdAt: string;
}
