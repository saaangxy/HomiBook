/** 账本领域类型(权威,以后端响应为准) */

export type BookRole = 'owner' | 'admin' | 'member';

/**
 * 账本成员角色全集 —— 全小写,与后端 Prisma `AccountBookMember.role` 及接口校验一致。
 * 注意:mobile 早期用大写 `OWNER | MEMBER` 做本地类型,提交时会把大写值发给后端(被 400 拒绝),
 * 该写法已废弃,一律使用这里的值。
 */
export const BOOK_ROLES = ['owner', 'admin', 'member'] as const;

export const BOOK_ROLE_LABELS: Record<BookRole, string> = {
  owner: '归属人',
  admin: '管理员',
  member: '成员',
};

export function isBookRole(value: unknown): value is BookRole {
  return typeof value === 'string' && (BOOK_ROLES as readonly string[]).includes(value);
}

/** 可由成员管理接口授予的角色(owner=归属人不可指派/转让) */
export const ASSIGNABLE_BOOK_ROLES = ['admin', 'member'] as const;

export interface BookItem {
  id: string;
  name: string;
  ownerId: string;
  role: BookRole;
  memberCount: number;
  createdAt: string;
  // mobile 展示派生字段(可选)
  icon?: string;
  shareCode?: string;
}

export interface BookDetail {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; nickname: string | null; email: string };
  members: BookMember[];
  memberCount: number;
}

export interface BookMember {
  id: string;
  userId: string;
  role: BookRole;
  joinedAt: string;
  user: { id: string; nickname: string | null; email: string };
  // mobile 兼容:扁平昵称
  nickname?: string;
}

export interface ShareCode {
  id: string;
  code: string;
  expiresAt: string | null;
  createdAt: string;
  isExpired: boolean;
}
