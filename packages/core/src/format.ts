/**
 * 金额/数字格式化 —— 纯 TS,三端共享。
 * 与 mobile lib/format.ts 保持一致。
 */

/** 金额格式化:¥ 前缀 + 千分位 + 两位小数 */
export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 短金额格式化:万 单位 */
export function formatMoneyShort(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 10000) return `${sign}¥${(abs / 10000).toFixed(1)}万`;
  return `${sign}¥${abs.toLocaleString('zh-CN')}`;
}
