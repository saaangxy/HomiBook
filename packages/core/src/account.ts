/**
 * 账户展示相关的纯函数(Web / 移动端共用)。
 * 之前两端各写了一份,行为细节容易漂移,统一收在这里。
 */

/** 账本内账户归属人数量是否 > 1(>1 时账户选项需标注归属人,避免多成员同名账户混淆) */
export function isMultiOwnerAccounts(accounts: { ownerId?: string | null }[]): boolean {
  const ids = accounts.filter((a) => a.ownerId).map((a) => a.ownerId);
  return new Set(ids).size > 1;
}

/** 账户展示标签:多归属人账本显示 `账户名 · 归属人`,单归属人账本仅显示账户名 */
export function accountLabel(
  a: { name: string; ownerName?: string | null },
  multiOwner: boolean,
): string {
  return multiOwner && a.ownerName ? `${a.name} · ${a.ownerName}` : a.name;
}
