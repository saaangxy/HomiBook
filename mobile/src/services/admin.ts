import { http } from './http';
import type { AdminUser, AuditLogItem } from '@/types';
import type { AdminUser as CoreAdminUser, AuditLogItem as CoreAuditLog } from '@homibook/core';

// 用户与 AI 审计数据访问层 —— 真实后端 API

function toAdminUser(u: CoreAdminUser): AdminUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username ?? '',
    nickname: u.nickname ?? '',
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
  };
}

function toAuditLog(l: CoreAuditLog): AuditLogItem {
  return {
    id: l.id,
    userNickname: l.userNickname ?? '',
    action: l.action as AuditLogItem['action'],
    toolName: l.toolName ?? undefined,
    input: l.input ?? undefined,
    output: l.output ?? undefined,
    modelName: l.modelName ?? undefined,
    durationMs: l.durationMs ?? undefined,
    status: l.status === 'error' ? 'error' : 'success',
    errorMessage: l.errorMessage ?? undefined,
    createdAt: l.createdAt,
  };
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const res = await http.get<CoreAdminUser[]>('/api/admin/users');
  return (res ?? []).map(toAdminUser);
}

export async function fetchAuditLogs(): Promise<AuditLogItem[]> {
  const res = await http.get<CoreAuditLog[]>('/api/admin/audit-logs');
  return (res ?? []).map(toAuditLog);
}
