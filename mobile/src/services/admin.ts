import { mockAuditLogs, mockUsers } from '@/mock/data';
import type { AdminUser, AuditLogItem } from '@/types';

// 用户与 AI 审计数据访问层:当前返回 mock,后续替换为真实 API(adminApi.*)时仅改这里
export function fetchUsers(): Promise<AdminUser[]> {
  return Promise.resolve(mockUsers);
}

export function fetchAuditLogs(): Promise<AuditLogItem[]> {
  return Promise.resolve(mockAuditLogs);
}