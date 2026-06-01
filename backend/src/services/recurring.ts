import { prisma } from '../app.js'
import cronParser from 'cron-parser'

// 等额本息：计算月还款额
export function calcEqualInstallment(
  total: number,
  annualRate: number, // 年利率百分比，如 4.5 表示 4.5%
  months: number,
): { monthlyPayment: number; totalPayment: number; totalInterest: number } {
  const monthlyRate = annualRate / 100 / 12
  if (monthlyRate === 0) {
    return { monthlyPayment: total / months, totalPayment: total, totalInterest: 0 }
  }
  // M = P * r * (1+r)^n / ((1+r)^n - 1)
  const pow = Math.pow(1 + monthlyRate, months)
  const monthlyPayment = total * monthlyRate * pow / (pow - 1)
  const totalPayment = monthlyPayment * months
  return {
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    totalPayment: Math.round(totalPayment * 100) / 100,
    totalInterest: Math.round((totalPayment - total) * 100) / 100,
  }
}

// 生成还款计划（等额本息）
export function generateEqualInstallmentPlan(
  total: number,
  annualRate: number,
  months: number,
  startDate: Date,
): Array<{ period: number; dueDate: Date; totalPayment: number; principal: number; interest: number; remainingPrincipal: number }> {
  const monthlyRate = annualRate / 100 / 12
  const monthlyPayment = calcEqualInstallment(total, annualRate, months).monthlyPayment
  const plan: Array<{ period: number; dueDate: Date; totalPayment: number; principal: number; interest: number; remainingPrincipal: number }> = []

  let remaining = total
  for (let i = 1; i <= months; i++) {
    const interest = Math.round(remaining * monthlyRate * 100) / 100
    let principal = monthlyPayment - interest
    if (i === months) {
      principal = remaining // 最后一期收尾差异
    }
    principal = Math.round(principal * 100) / 100
    remaining = Math.round((remaining - principal) * 100) / 100

    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + i)

    plan.push({
      period: i,
      dueDate,
      totalPayment: Math.round(monthlyPayment * 100) / 100,
      principal,
      interest,
      remainingPrincipal: Math.max(0, remaining),
    })
  }
  return plan
}

// 等额本金：计算还款计划
export function generateEqualPrincipalPlan(
  total: number,
  annualRate: number,
  months: number,
  startDate: Date,
): Array<{ period: number; dueDate: Date; totalPayment: number; principal: number; interest: number; remainingPrincipal: number }> {
  const monthlyRate = annualRate / 100 / 12
  const monthlyPrincipal = Math.round((total / months) * 100) / 100
  const plan: Array<{ period: number; dueDate: Date; totalPayment: number; principal: number; interest: number; remainingPrincipal: number }> = []

  let remaining = total
  for (let i = 1; i <= months; i++) {
    const interest = Math.round(remaining * monthlyRate * 100) / 100
    let principal = monthlyPrincipal
    if (i === months) {
      principal = remaining // 最后一期收尾
    }
    principal = Math.round(principal * 100) / 100
    remaining = Math.round((remaining - principal) * 100) / 100

    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + i)

    plan.push({
      period: i,
      dueDate,
      totalPayment: Math.round((principal + interest) * 100) / 100,
      principal,
      interest,
      remainingPrincipal: Math.max(0, remaining),
    })
  }
  return plan
}

// 根据 cron 表达式计算下一次触发时间
export function getNextTriggerTime(cron: string, fromDate?: Date): Date | null {
  try {
    const interval = cronParser.parseExpression(cron, {
      currentDate: fromDate || new Date(),
    })
    return interval.next().toDate()
  } catch {
    return null
  }
}

// 计算当前期数（从 startDate 到现在的月份数 + 1）
export function getCurrentPeriod(startDate: Date, termMonths: number): number {
  const now = new Date()
  const monthsDiff = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth())
  const period = monthsDiff + 1
  return Math.max(1, Math.min(period, termMonths))
}

// 获取当前期对应的还款计划项
export function getCurrentPlanItem(recurringId: string, startDate: Date, termMonths: number) {
  const period = getCurrentPeriod(startDate, termMonths)
  return prisma.repaymentPlan.findFirst({
    where: { recurringTransactionId: recurringId, period },
  })
}

// 标签追加"固定收支"
export function ensureFixedTag(tags: string[]): string[] {
  const fixed = '固定收支'
  if (!tags.includes(fixed)) return [fixed, ...tags]
  return tags
}
