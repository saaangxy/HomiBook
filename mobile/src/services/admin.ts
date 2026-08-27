import { http } from './http';
import type { AdminUser } from '@/types';
import type { AdminUser as CoreAdminUser } from '@homibook/core';

// 用户管理数据访问层 —— 真实后端 API

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

export async function fetchUsers(): Promise<AdminUser[]> {
  // 后端返回 { users: [...] }(对齐 frontend/src/api/admin.ts)
  const res = await http.get<{ users?: CoreAdminUser[] }>('/api/admin/users');
  return (res?.users ?? []).map(toAdminUser);
}
