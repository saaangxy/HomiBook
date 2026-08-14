export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMoneyShort(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 10000) return `${sign}¥${(abs / 10000).toFixed(1)}万`;
  return `${sign}¥${abs.toLocaleString('zh-CN')}`;
}