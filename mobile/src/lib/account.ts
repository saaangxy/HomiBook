import type { AccountItem } from '@/types';

/** 账本内账户归属人数是否大于 1（大于 1 时账户选项需标注归属人，避免多成员同名账户混淆） */
export function isMultiOwnerAccounts(accounts: { ownerId?: string }[]): boolean {
  const ids = accounts.filter((a) => a.ownerId).map((a) => a.ownerId);
  return new Set(ids).size > 1;
}

/** 账户展示标签：多归属人账本下显示 `账户名 · 归属人`，单归属人账本仅显示账户名 */
export function accountLabel(a: { name: string; ownerName?: string | null }, multiOwner: boolean): string {
  return multiOwner && a.ownerName ? `${a.name} · ${a.ownerName}` : a.name;
}
