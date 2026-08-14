// 家庭财务健康雷达图共享评分工具(概览页 7 维 + 时间视图 5 维共用)

export interface RadarMetric {
  name: string
  value: number
  detail?: string   // tooltip 展示的实际指标值
  available?: boolean // false 表示数据不足
}

// 分段线性插值评分:在 [x0,x1] 区间上,分值从 s0 线性过渡到 s1
export function lerpScore(x: number, x0: number, x1: number, s0: number, s1: number): number {
  if (x1 === x0) return s1
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)))
  return Math.round(s0 + (s1 - s0) * t)
}

// 应急能力:紧急备用金覆盖月数
export function scoreEmergency(months: number): number {
  if (months >= 12) return 100
  if (months >= 6) return lerpScore(months, 6, 12, 90, 100)
  if (months >= 3) return lerpScore(months, 3, 6, 60, 80)
  return lerpScore(months, 0, 3, 20, 50)
}

// 偿债压力(反向):月供 ÷ 月均收入,越低越健康
export function scoreDebtBurden(ratio: number): number {
  if (ratio <= 0.35) return lerpScore(ratio, 0, 0.35, 100, 90)
  if (ratio <= 0.5) return lerpScore(ratio, 0.35, 0.5, 90, 60)
  return lerpScore(ratio, 0.5, 1, 60, 20)
}

// 杠杆水平(反向):总负债 ÷ 总资产,越低越健康
export function scoreLeverage(ratio: number): number {
  if (ratio <= 0.5) return lerpScore(ratio, 0, 0.5, 100, 90)
  if (ratio <= 0.7) return lerpScore(ratio, 0.5, 0.7, 90, 60)
  return lerpScore(ratio, 0.7, 1, 60, 20)
}

// 储蓄能力:年储蓄 ÷ 年收入
export function scoreSavings(ratio: number): number {
  if (ratio >= 0.3) return lerpScore(ratio, 0.3, 0.5, 90, 100)
  if (ratio >= 0.2) return lerpScore(ratio, 0.2, 0.3, 60, 80)
  if (ratio >= 0.1) return lerpScore(ratio, 0.1, 0.2, 40, 60)
  return lerpScore(ratio, 0, 0.1, 20, 40)
}

// 投资积累:投资资产 ÷ 净资产
export function scoreInvestment(ratio: number): number {
  if (ratio >= 0.5) return lerpScore(ratio, 0.5, 0.8, 90, 100)
  if (ratio >= 0.2) return lerpScore(ratio, 0.2, 0.5, 60, 80)
  return lerpScore(ratio, 0, 0.2, 20, 50)
}

// 财务自由度:被动收入 ÷ 年支出
export function scoreFreedom(ratio: number): number {
  if (ratio >= 1) return 100
  if (ratio >= 0.5) return lerpScore(ratio, 0.5, 1, 60, 100)
  if (ratio >= 0.2) return lerpScore(ratio, 0.2, 0.5, 40, 60)
  return lerpScore(ratio, 0, 0.2, 20, 40)
}

// 保障充足度(保费占比近似):保费支出 ÷ 年收入,健康区间 5%-15%
export function scoreInsurance(ratio: number): number {
  if (ratio >= 0.05 && ratio <= 0.15) {
    const peak = 0.1
    if (ratio <= peak) return lerpScore(ratio, 0.05, peak, 90, 100)
    return lerpScore(ratio, peak, 0.15, 100, 90)
  }
  if (ratio >= 0.03 && ratio < 0.05) return lerpScore(ratio, 0.03, 0.05, 60, 80)
  if (ratio > 0.15 && ratio <= 0.2) return lerpScore(ratio, 0.15, 0.2, 80, 60)
  if (ratio < 0.03) return lerpScore(ratio, 0, 0.03, 20, 50)
  return lerpScore(ratio, 0.2, 0.3, 50, 20)
}