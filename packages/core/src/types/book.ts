/** 账本领域类型(权威,以后端响应为准) */

export type BookRole = 'owner' | 'admin' | 'member';

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
  role: string;
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
