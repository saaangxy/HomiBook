/** AI 审计日志领域类型(权威,以后端响应为准) */

export type AuditAction = 'tool_call' | 'confirm' | 'reject' | 'model_call';

/** 审计动作全集(运行时校验用) */
export const AUDIT_ACTIONS = ['tool_call', 'confirm', 'reject', 'model_call'] as const;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  tool_call: '工具调用',
  confirm: '用户确认',
  reject: '用户拒绝',
  model_call: '模型调用',
};

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
