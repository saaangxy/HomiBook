// 评分函数与 7 维雷达组装统一在 @homibook/core(与 web 共享);
// 本文件只保留依赖端内类型的时间段评估,并维持既有导入路径
import type { RecordSummary } from '@/types';
import { scoreDebtBurden, scoreFreedom, scoreSavings, type RadarMetric } from '@homibook/core';

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

// 7 维雷达的输入与组装同样来自 core
export type { RadarInput } from '@homibook/core';
export { computeRadarMetrics } from '@homibook/core';

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


