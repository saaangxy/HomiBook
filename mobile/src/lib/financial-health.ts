// 评分函数单一来源在 @homibook/core(与 web 共享);本文件保留依赖端内类型的编排函数并维持既有导入路径
import type { AccountItem, RecurringTransaction, RecordSummary } from '@/types';
import type { RadarMetric } from '@homibook/core';
import {
  scoreEmergency,
  scoreDebtBurden,
  scoreLeverage,
  scoreSavings,
  scoreInvestment,
  scoreFreedom,
  scoreInsurance,
} from '@homibook/core';

// RadarMetric 以 core 定义为准(与本地结构一致),re-export 保持既有引用可用
export type { RadarMetric };

// 评分函数直接从 core 透出,保持 '@/lib/financial-health' 导入路径可用
export {
  lerpScore,
  scoreEmergency,
  scoreDebtBurden,
  scoreLeverage,
  scoreSavings,
  scoreInvestment,
  scoreFreedom,
  scoreInsurance,
} from '@homibook/core';

export interface RadarInput {
  accounts: AccountItem[];
  loans: RecurringTransaction[];
  summary: RecordSummary;
  passiveIncome: number;
  insuranceExpense: number;
}

export interface TimeRadarInput {
  summary: RecordSummary;
  budgetHealth: number; // 固定预算契合度 0-100(无预算=100)
  monthlyPayment: number; // 活跃贷款月供合计
  monthsInPeriod: number; // 时间段跨月数(最少 1)
  passiveIncome: number; // 时间段内被动收入(投资收益,分红)
}

// 时间段财务健康 5 维评估(对齐 web StatsTimeView.computeRadar,全部为所选时间段内的流指标)
export function computeTimeRadar(input: TimeRadarInput): RadarMetric[] {
  const income = input.summary.income || 0;
  const expense = input.summary.expense || 0;
  const metrics: RadarMetric[] = [];

  // 1. 储蓄率
  if (income > 0) {
    const savings = (income - expense) / income;
    metrics.push({ name: '储蓄率', value: scoreSavings(savings), detail: `储蓄率 ${(savings * 100).toFixed(1)}%` });
  } else {
    metrics.push({ name: '储蓄率', value: 0, available: false, detail: '数据不足(无收入记录)' });
  }

  // 2. 收支平衡
  if (expense > 0) {
    const balance = income >= expense ? 100 : Math.round((income / expense) * 100);
    metrics.push({ name: '收支平衡', value: balance, detail: `收入/支出 ${income >= expense ? '≥100%' : `${((income / expense) * 100).toFixed(1)}%`}` });
  } else if (income > 0) {
    metrics.push({ name: '收支平衡', value: 100, detail: '本期内无支出' });
  } else {
    metrics.push({ name: '收支平衡', value: 0, available: false, detail: '数据不足' });
  }

  // 3. 预算执行
  metrics.push({ name: '预算执行', value: Math.max(0, Math.min(100, Math.round(input.budgetHealth))), detail: `预算契合度 ${Math.round(input.budgetHealth)} 分` });

  // 4. 偿债压力(反向)
  const monthlyIncome = income > 0 ? income / input.monthsInPeriod : 0;
  if (input.monthlyPayment > 0 && monthlyIncome > 0) {
    const ratio = input.monthlyPayment / monthlyIncome;
    metrics.push({ name: '偿债压力', value: scoreDebtBurden(ratio), detail: `月供占比 ${(ratio * 100).toFixed(1)}%` });
  } else if (input.monthlyPayment <= 0) {
    metrics.push({ name: '偿债压力', value: 100, detail: '无贷款,无负债压力' });
  } else {
    metrics.push({ name: '偿债压力', value: 20, available: false, detail: '数据不足(无收入记录)' });
  }

  // 5. 财务自由度
  if (expense > 0) {
    const ratio = input.passiveIncome / expense;
    metrics.push({ name: '财务自由度', value: scoreFreedom(ratio), detail: `被动收入覆盖支出 ${(ratio * 100).toFixed(1)}%` });
  } else {
    metrics.push({ name: '财务自由度', value: 0, available: false, detail: '数据不足(无支出记录)' });
  }

  return metrics;
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
