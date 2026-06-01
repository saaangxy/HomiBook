import cron from 'node-cron'
import { prisma } from '../app.js'
import { getNextTriggerTime, getCurrentPeriod, ensureFixedTag } from './recurring.js'

let task: cron.ScheduledTask | null = null

export function startScheduler() {
  if (task) return

  // 每分钟检查一次
  task = cron.schedule('* * * * *', async () => {
    try {
      const now = new Date()
      const due = await prisma.recurringTransaction.findMany({
        where: {
          active: true,
          nextGenerateAt: { lte: now },
        },
      })

      for (const rt of due) {
        await generateRecord(rt)
      }
    } catch (e) {
      console.error('[Scheduler] 执行失败:', e)
    }
  })

  console.log('[Scheduler] 固定收支调度器已启动')
}

export function stopScheduler() {
  task?.stop()
  task = null
}

async function generateRecord(rt: {
  id: string
  accountBookId: string
  type: string
  amount: number
  remark: string | null
  tags: string
  accountId: string
  categoryCode: string | null
  payer: string | null
  ownerId: string
  cron: string
  recurringType: string
  loanTotalAmount: number | null
  loanRemainingAmount: number | null
  loanInterestRate: number | null
  loanInterestMethod: string | null
  loanStartDate: Date | null
  loanTermMonths: number | null
  loanMonthlyPayment: number | null
}) {
  const now = new Date()
  let amount = rt.amount
  let remark = rt.remark || ''

  // 贷款类型：获取当前期还款计划
  if (rt.recurringType === 'LOAN' && rt.loanInterestMethod && rt.loanStartDate && rt.loanTermMonths) {
    const planItem = await prisma.repaymentPlan.findFirst({
      where: {
        recurringTransactionId: rt.id,
        status: 'PENDING',
        dueDate: { lte: now },
      },
      orderBy: { period: 'asc' },
    })

    if (planItem) {
      amount = planItem.totalPayment
      remark = `${remark}\n本金: ${planItem.principal.toFixed(2)} | 利息: ${planItem.interest.toFixed(2)}`

      // 更新计划项
      const tags = ensureFixedTag(JSON.parse(rt.tags))
      const record = await prisma.record.create({
        data: {
          accountBookId: rt.accountBookId,
          type: rt.type,
          amount: amount,
          date: now,
          remark: remark.trim(),
          tags: JSON.stringify(tags),
          accountId: rt.accountId,
          categoryCode: rt.categoryCode,
          payer: rt.payer,
          ownerId: rt.ownerId,
        },
      })

      await prisma.repaymentPlan.update({
        where: { id: planItem.id },
        data: {
          status: 'GENERATED',
          generatedRecordId: record.id,
        },
      })

      // 更新剩余本金
      await prisma.recurringTransaction.update({
        where: { id: rt.id },
        data: {
          loanRemainingAmount: planItem.remainingPrincipal,
          lastGeneratedAt: now,
          nextGenerateAt: getNextTriggerTime(rt.cron, now),
        },
      })
      return
    }
    // 没有待生成计划项，则使用标准金额
  }

  // 周期类型：直接生成流水
  const tags = ensureFixedTag(JSON.parse(rt.tags))
  await prisma.record.create({
    data: {
      accountBookId: rt.accountBookId,
      type: rt.type,
      amount: amount,
      date: now,
      remark: remark || undefined,
      tags: JSON.stringify(tags),
      accountId: rt.accountId,
      categoryCode: rt.categoryCode,
      payer: rt.payer,
      ownerId: rt.ownerId,
    },
  })

  await prisma.recurringTransaction.update({
    where: { id: rt.id },
    data: {
      lastGeneratedAt: now,
      nextGenerateAt: getNextTriggerTime(rt.cron, now),
    },
  })
}
