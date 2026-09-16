/** 用户领域类型(权威,以后端响应为准) */

export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'DISABLED';

/** 用户角色/状态全集(后端正则校验复用) */
export const USER_ROLES = ['ADMIN', 'USER'] as const;
export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

/** 登录用户(对应后端 /api/auth/me 响应) */
export interface UserInfo {
  id: string;
  email: string;
  username: string | null;
  nickname: string | null;
  role: string;
  theme: string;
}

/** 后台用户管理 */
export interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  nickname: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}
