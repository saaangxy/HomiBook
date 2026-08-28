// 家庭财务健康雷达图评分工具(概览页 7 维,逻辑对齐 web 端 frontend/src/lib/financial-health.ts)
import type { AccountItem, RadarMetric, RecurringTransaction, RecordSummary } from '@/types';

// 分段线性插值评分:在 [x0,x1] 区间上,分值从 s0 线性过渡到 s1
export function lerpScore(x: number, x0: number, x1: number, s0: number, s1: number): number {
  if (x1 === x0) return s1;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return Math.round(s0 + (s1 - s0) * t);
}

// 应急能力:紧急备用金覆盖月数
export function scoreEmergency(months: number): number {
  if (months >= 12) return 100;
  if (months >= 6) return lerpScore(months, 6, 12, 90, 100);
  if (months >= 3) return lerpScore(months, 3, 6, 60, 80);
  return lerpScore(months, 0, 3, 20, 50);
}

// 偿债压力(反向):月供 ÷ 月均收入,越低越健康
export function scoreDebtBurden(ratio: number): number {
  if (ratio <= 0.35) return lerpScore(ratio, 0, 0.35, 100, 90);
  if (ratio <= 0.5) return lerpScore(ratio, 0.35, 0.5, 90, 60);
  return lerpScore(ratio, 0.5, 1, 60, 20);
}

// 杠杆水平(反向):总负债 ÷ 总资产,越低越健康
export function scoreLeverage(ratio: number): number {
  if (ratio <= 0.5) return lerpScore(ratio, 0, 0.5, 100, 90);
  if (ratio <= 0.7) return lerpScore(ratio, 0.5, 0.7, 90, 60);
  return lerpScore(ratio, 0.7, 1, 60, 20);
}

// 储蓄能力:年储蓄 ÷ 年收入
export function scoreSavings(ratio: number): number {
  if (ratio >= 0.3) return lerpScore(ratio, 0.3, 0.5, 90, 100);
  if (ratio >= 0.2) return lerpScore(ratio, 0.2, 0.3, 60, 80);
  if (ratio >= 0.1) return lerpScore(ratio, 0.1, 0.2, 40, 60);
  return lerpScore(ratio, 0, 0.1, 20, 40);
}

// 投资积累:投资资产 ÷ 净资产
export function scoreInvestment(ratio: number): number {
  if (ratio >= 0.5) return lerpScore(ratio, 0.5, 0.8, 90, 100);
  if (ratio >= 0.2) return lerpScore(ratio, 0.2, 0.5, 60, 80);
  return lerpScore(ratio, 0, 0.2, 20, 50);
}

// 财务自由度:被动收入 ÷ 年支出
export function scoreFreedom(ratio: number): number {
  if (ratio >= 1) return 100;
  if (ratio >= 0.5) return lerpScore(ratio, 0.5, 1, 60, 100);
  if (ratio >= 0.2) return lerpScore(ratio, 0.2, 0.5, 40, 60);
  return lerpScore(ratio, 0, 0.2, 20, 40);
}

// 保障充足度(保费占比近似):保费支出 ÷ 年收入,健康区间 5%-15%
export function scoreInsurance(ratio: number): number {
  if (ratio >= 0.05 && ratio <= 0.15) {
    const peak = 0.1;
    if (ratio <= peak) return lerpScore(ratio, 0.05, peak, 90, 100);
    return lerpScore(ratio, peak, 0.15, 100, 90);
  }
  if (ratio >= 0.03 && ratio < 0.05) return lerpScore(ratio, 0.03, 0.05, 60, 80);
  if (ratio > 0.15 && ratio <= 0.2) return lerpScore(ratio, 0.15, 0.2, 80, 60);
  if (ratio < 0.03) return lerpScore(ratio, 0, 0.03, 20, 50);
  return lerpScore(ratio, 0.2, 0.3, 50, 20);
}

export interface RadarInput {
  accounts: AccountItem[];
  loans: RecurringTransaction[];
  summary: RecordSummary;
  passiveIncome: number;
  insuranceExpense: number;
}

// 家庭财务健康 7 维评分(近 12 个月口径,对齐 web StatsOverview)
export function computeRadarMetrics(input: RadarInput): RadarMetric[] {
  const act = input.accounts.filter((a) => a.status === 'ACTIVE');
  // 信用卡余额为负数(欠款),取绝对值作为负债
  const creditBal = Math.abs(act.filter((a) => a.type === 'CREDIT_CARD').reduce((s, a) => s + (a.balance ?? 0), 0));
  const totalLiab = creditBal + input.loans.reduce((s, l) => s + (l.loanRemainingAmount ?? 0), 0);
  // 总资产剔除信用卡,避免重复计算
  const assetTypes = ['BANK_DEBIT', 'ALIPAY', 'WECHAT', 'CASH', 'RECHARGE_CARD', 'INVESTMENT', 'OTHER'];
  const totalAssets = act.filter((a) => assetTypes.includes(a.type)).reduce((s, a) => s + (a.balance ?? 0), 0);
  const netAssets = totalAssets - totalLiab;
  const investAssets = act.filter((a) => a.type === 'INVESTMENT').reduce((s, a) => s + (a.balance ?? 0), 0);
  // 紧急备用金:流动性现金账户
  const emergency = act.filter((a) => ['BANK_DEBIT', 'ALIPAY', 'WECHAT', 'CASH'].includes(a.type)).reduce((s, a) => s + (a.balance ?? 0), 0);

  const monthlyPayment = input.loans.reduce((s, l) => s + (l.amount ?? 0), 0);
  const income = input.summary.income || 0;
  const expense = input.summary.expense || 0;
  const monthlyIncome = income / 12;
  const monthlyExpense = expense / 12;

  const metrics: RadarMetric[] = [];

  // 1. 应急能力
  if (monthlyExpense > 0) {
    const months = emergency / monthlyExpense;
    metrics.push({ name: '应急能力', value: scoreEmergency(months), detail: `备用金可覆盖 ${months.toFixed(1)} 个月支出` });
  } else {
    metrics.push({ name: '应急能力', value: 0, available: false, detail: '数据不足(无支出记录)' });
  }

  // 2. 偿债压力(反向)
  if (monthlyPayment > 0 && monthlyIncome > 0) {
    const ratio = monthlyPayment / monthlyIncome;
    metrics.push({ name: '偿债压力', value: scoreDebtBurden(ratio), detail: `月供占比 ${(ratio * 100).toFixed(1)}%` });
  } else if (monthlyPayment <= 0) {
    metrics.push({ name: '偿债压力', value: 100, detail: '无贷款,无负债压力' });
  } else {
    metrics.push({ name: '偿债压力', value: 20, available: false, detail: '数据不足(无收入记录)' });
  }

  // 3. 杠杆水平(反向)
  if (totalAssets > 0) {
    const ratio = totalLiab / totalAssets;
    metrics.push({ name: '杠杆水平', value: scoreLeverage(ratio), detail: `负债率 ${(ratio * 100).toFixed(1)}%` });
  } else if (totalAssets === 0 && totalLiab === 0) {
    metrics.push({ name: '杠杆水平', value: 100, detail: '无资产与负债' });
  } else {
    metrics.push({ name: '杠杆水平', value: 20, available: false, detail: '数据不足(无资产数据)' });
  }

  // 4. 储蓄能力
  if (income > 0) {
    const savings = (income - expense) / income;
    metrics.push({ name: '储蓄能力', value: scoreSavings(savings), detail: `储蓄率 ${(savings * 100).toFixed(1)}%` });
  } else {
    metrics.push({ name: '储蓄能力', value: 0, available: false, detail: '数据不足(无收入记录)' });
  }

  // 5. 投资积累
  if (netAssets > 0) {
    const ratio = investAssets / netAssets;
    metrics.push({ name: '投资积累', value: scoreInvestment(ratio), detail: `投资占净资产 ${(ratio * 100).toFixed(1)}%` });
  } else {
    metrics.push({ name: '投资积累', value: 0, available: false, detail: '数据不足(净资产非正)' });
  }

  // 6. 财务自由度
  if (expense > 0) {
    const ratio = input.passiveIncome / expense;
    metrics.push({ name: '财务自由度', value: scoreFreedom(ratio), detail: `被动收入覆盖支出 ${(ratio * 100).toFixed(1)}%` });
  } else {
    metrics.push({ name: '财务自由度', value: 0, available: false, detail: '数据不足(无支出记录)' });
  }

  // 7. 保障充足度(保费占比近似)
  if (income > 0) {
    const ratio = input.insuranceExpense / income;
    metrics.push({ name: '保障充足度', value: scoreInsurance(ratio), detail: `保费占收入 ${(ratio * 100).toFixed(1)}%` });
  } else {
    metrics.push({ name: '保障充足度', value: 0, available: false, detail: '数据不足(无收入记录)' });
  }

  return metrics;
}
