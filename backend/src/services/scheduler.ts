import cron from 'node-cron'
import { prisma } from '../app.js'
import { getNextTriggerTime, ensureFixedTag } from './recurring.js'
import { cleanupExpiredAuditLogs } from './ai/audit.js'

interface CronLike {
  schedule(cronExpression: string, fn: () => void): { stop(): void }
}

interface PrismaLike {
  recurringTransaction: {
    findMany(args: any): Promise<any[]>
    update(args: any): Promise<any>
  }
  repaymentPlan: {
    findFirst(args: any): Promise<any>
    update(args: any): Promise<any>
  }
  record: {
    create(args: any): Promise<any>
  }
  $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
}

interface RecurringTxParams {
  id: string
  accountBookId: string
  type: string
  amount: number
  remark: string | null
  tags: string
  accountId: string
  toAccountId: string | null
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
}

let recurringTask: { stop(): void } | null = null
let auditCleanupTask: { stop(): void } | null = null

export function startScheduler(client: PrismaLike = prisma, cronLib: CronLike = cron) {
  if (recurringTask) return

  recurringTask = cronLib.schedule('* * * * *', async () => {
    try {
      const now = new Date()
      const due = await client.recurringTransaction.findMany({
        where: { active: true, nextGenerateAt: { lte: now } },
      })

      for (const rt of due) {
        await generateRecord(rt, client)
      }
    } catch (e) {
      console.error('[Scheduler] 执行失败:', e)
    }
  })

  // 每周日凌晨 3 点清理过期审计日志
  auditCleanupTask = cronLib.schedule('0 3 * * 0', async () => {
    try {
      const deleted = await cleanupExpiredAuditLogs()
      console.log(`[Scheduler] 审计日志清理完成，删除 ${deleted} 条过期记录`)
    } catch (e) {
      console.error('[Scheduler] 审计日志清理失败:', e)
    }
  })

  console.log('[Scheduler] 固定收支调度器已启动')
}

export function stopScheduler() {
  recurringTask?.stop()
  auditCleanupTask?.stop()
  recurringTask = null
  auditCleanupTask = null
}

export async function generateRecord(rt: RecurringTxParams, client: PrismaLike = prisma) {
  const now = new Date()
  let amount = rt.amount
  let remark = rt.remark || ''

  // 贷款类型：获取当前期还款计划
  if (rt.recurringType === 'LOAN' && rt.loanInterestMethod && rt.loanStartDate && rt.loanTermMonths) {
    const planItem = await client.repaymentPlan.findFirst({
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

      // 原子事务：创建记录 + 更新计划 + 更新定期交易
      await client.$transaction(async (tx) => {
        const tags = ensureFixedTag(JSON.parse(rt.tags))
        const record = await tx.record.create({
          data: {
            accountBookId: rt.accountBookId,
            type: rt.type,
            amount,
            date: now,
            remark: remark.trim(),
            tags: JSON.stringify(tags),
            accountId: rt.accountId,
            categoryCode: rt.categoryCode,
            payer: rt.payer,
            ownerId: rt.ownerId,
          },
        })

        await tx.repaymentPlan.update({
          where: { id: planItem.id },
          data: { status: 'GENERATED', generatedRecordId: record.id },
        })

        await tx.recurringTransaction.update({
          where: { id: rt.id },
          data: {
            loanRemainingAmount: planItem.remainingPrincipal,
            lastGeneratedAt: now,
            nextGenerateAt: getNextTriggerTime(rt.cron, now),
          },
        })
      })
      return
    }
  }

  // 周期类型：直接生成流水
  const isTransfer = rt.type === 'TRANSFER'
  const tags = ensureFixedTag(JSON.parse(rt.tags))
  await client.record.create({
    data: {
      accountBookId: rt.accountBookId,
      type: rt.type,
      amount,
      date: now,
      remark: remark || undefined,
      tags: JSON.stringify(tags),
      accountId: rt.accountId,
      fromAccountId: isTransfer ? rt.accountId : undefined,
      toAccountId: isTransfer ? rt.toAccountId : undefined,
      categoryCode: rt.categoryCode,
      payer: rt.payer,
      ownerId: rt.ownerId,
    },
  })

  await client.recurringTransaction.update({
    where: { id: rt.id },
    data: {
      lastGeneratedAt: now,
      nextGenerateAt: getNextTriggerTime(rt.cron, now),
    },
  })
}
