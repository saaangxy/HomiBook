import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import {
  createRecurringSchema,
  updateRecurringSchema,
  listRecurringSchema,
} from '../schemas/recurring.js'
import {
  calcEqualInstallment,
  generateEqualInstallmentPlan,
  generateEqualPrincipalPlan,
  getNextTriggerTime,
  getCurrentPeriod,
  ensureFixedTag,
} from '../services/recurring.js'

async function assertIsMember(bookId: string, userId: string) {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  if (book.ownerId === userId) return
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) throw Object.assign(new Error('无权访问该账本'), { statusCode: 403 })
}

export async function recurringRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 列表
  app.get('/', async (req) => {
    const parsed = listRecurringSchema.safeParse(req.query)
    if (!parsed.success) throw Object.assign(new Error('参数错误'), { statusCode: 400 })

    const { bookId } = parsed.data
    const userId = (req as any).user.id as string
    await assertIsMember(bookId, userId)

    const list = await prisma.recurringTransaction.findMany({
      where: { accountBookId: bookId },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        owner: { select: { id: true, name: true, email: true } },
        repaymentPlans: {
          orderBy: { period: 'asc' },
          take: 6,
        },
      },
    })

    return list.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
      nextGenerateAt: r.nextGenerateAt || (r.active ? getNextTriggerTime(r.cron) : null),
    }))
  })

  // 计算贷款预览
  app.post('/loan-preview', async (req) => {
    const { total, annualRate, months, startDate, method } = req.body as {
      total: number
      annualRate: number
      months: number
      startDate: string
      method: string
    }

    if (!total || !months || !startDate || !method) {
      throw Object.assign(new Error('缺少参数'), { statusCode: 400 })
    }

    const start = new Date(startDate)
    const calc = calcEqualInstallment(total, annualRate, months)
    const plan = method === 'EQUAL_PRINCIPAL'
      ? generateEqualPrincipalPlan(total, annualRate, months, start)
      : generateEqualInstallmentPlan(total, annualRate, months, start)

    return {
      monthlyPayment: calc.monthlyPayment,
      totalPayment: calc.totalPayment,
      totalInterest: calc.totalInterest,
      plan,
    }
  })

  // 获取还款计划
  app.get('/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string }

    const rt = await prisma.recurringTransaction.findUnique({ where: { id } })
    if (!rt) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(rt.accountBookId, userId)

    const plans = await prisma.repaymentPlan.findMany({
      where: { recurringTransactionId: id },
      orderBy: { period: 'asc' },
    })

    return plans
  })

  // 详情
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }

    const rt = await prisma.recurringTransaction.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        owner: { select: { id: true, name: true, email: true } },
        repaymentPlans: { orderBy: { period: 'asc' } },
      },
    })
    if (!rt) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(rt.accountBookId, userId)

    return { ...rt, tags: JSON.parse(rt.tags) }
  })

  // 创建
  app.post('/', async (req, reply) => {
    const parsed = createRecurringSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const data = parsed.data
    const userId = (req as any).user.id as string
    await assertIsMember(data.accountBookId, userId)

    const tags = ensureFixedTag(data.tags || [])
    let monthlyPayment = data.amount
    let finalType = data.type
    let finalAmount = data.amount

    // 贷款类型：固定支出，金额自动计算
    if (data.recurringType === 'LOAN') {
      finalType = 'EXPENSE'
      const calc = calcEqualInstallment(
        data.loanTotalAmount!,
        data.loanInterestRate!,
        data.loanTermMonths!,
      )
      monthlyPayment = calc.monthlyPayment
      finalAmount = monthlyPayment
    }

    const nextGenerate = getNextTriggerTime(data.cron)
    const rt = await prisma.recurringTransaction.create({
      data: {
        accountBookId: data.accountBookId,
        name: data.name,
        type: finalType,
        amount: finalAmount,
        remark: data.remark,
        tags: JSON.stringify(tags),
        accountId: data.accountId,
        toAccountId: data.toAccountId,
        categoryCode: data.categoryCode,
        payer: data.payer,
        ownerId: data.ownerId || userId,
        cron: data.cron,
        active: data.active,
        recurringType: data.recurringType,
        loanTotalAmount: data.loanTotalAmount,
        loanRemainingAmount: data.loanTotalAmount,
        loanInterestRate: data.loanInterestRate,
        loanInterestMethod: data.loanInterestMethod,
        loanStartDate: data.loanStartDate ? new Date(data.loanStartDate) : null,
        loanTermMonths: data.loanTermMonths,
        loanMonthlyPayment: data.recurringType === 'LOAN' ? monthlyPayment : null,
        nextGenerateAt: nextGenerate,
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    })

    // 贷款类型：生成还款计划
    if (data.recurringType === 'LOAN') {
      const startDate = new Date(data.loanStartDate!)
      const plan = data.loanInterestMethod === 'EQUAL_PRINCIPAL'
        ? generateEqualPrincipalPlan(data.loanTotalAmount!, data.loanInterestRate!, data.loanTermMonths!, startDate)
        : generateEqualInstallmentPlan(data.loanTotalAmount!, data.loanInterestRate!, data.loanTermMonths!, startDate)

      const now = new Date()

      const planData = plan.map((p) => {
        const isPastDue = p.dueDate <= now
        let status: string = 'PENDING'
        if (isPastDue && data.generateAll !== false) {
          status = 'PENDING' // will be generated below
        }
        return {
          recurringTransactionId: rt.id,
          period: p.period,
          dueDate: p.dueDate,
          totalPayment: p.totalPayment,
          principal: p.principal,
          interest: p.interest,
          remainingPrincipal: p.remainingPrincipal,
          status,
        }
      })

      await prisma.repaymentPlan.createMany({ data: planData })

      // 全部生成：立即为已到期的计划创建流水记录
      if (data.generateAll !== false) {
        const pastDuePlans = planData.filter((p) => p.dueDate <= now)
        if (pastDuePlans.length > 0) {
          const createdPlans = await prisma.repaymentPlan.findMany({
            where: { recurringTransactionId: rt.id, period: { in: pastDuePlans.map(p => p.period) } },
            orderBy: { period: 'asc' },
          })

          for (const pp of createdPlans) {
            const tags = ensureFixedTag(JSON.parse(rt.tags))
            const record = await prisma.record.create({
              data: {
                accountBookId: rt.accountBookId,
                type: rt.type,
                amount: pp.totalPayment,
                date: pp.dueDate,
                remark: `${rt.remark || '还款'}\n本金: ${pp.principal.toFixed(2)} | 利息: ${pp.interest.toFixed(2)}`.trim(),
                tags: JSON.stringify(tags),
                accountId: rt.accountId,
                categoryCode: rt.categoryCode,
                payer: rt.payer,
                ownerId: rt.ownerId,
              },
            })

            await prisma.repaymentPlan.update({
              where: { id: pp.id },
              data: { status: 'GENERATED', generatedRecordId: record.id },
            })
          }

          // 更新剩余本金为最后已生成期的剩余本金
          const lastCreated = createdPlans[createdPlans.length - 1]
          await prisma.recurringTransaction.update({
            where: { id: rt.id },
            data: {
              loanRemainingAmount: lastCreated.remainingPrincipal,
              lastGeneratedAt: now,
              nextGenerateAt: getNextTriggerTime(data.cron, now),
            },
          })
        }
      }
    }

    return { ...rt, tags }
  })

  // 更新
  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateRecurringSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const existing = await prisma.recurringTransaction.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(existing.accountBookId, userId)

    const data = parsed.data as any
    if (data.tags) data.tags = JSON.stringify(ensureFixedTag(data.tags))
    if (data.cron) {
      data.nextGenerateAt = getNextTriggerTime(data.cron)
    }

    const updated = await prisma.recurringTransaction.update({
      where: { id },
      data,
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        owner: { select: { id: true, name: true, email: true } },
        repaymentPlans: { orderBy: { period: 'asc' } },
      },
    })

    return { ...updated, tags: JSON.parse(updated.tags) }
  })

  // 删除
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }

    const existing = await prisma.recurringTransaction.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(existing.accountBookId, userId)

    await prisma.recurringTransaction.delete({ where: { id } })
    return { success: true }
  })

  // 切换启用/停用
  app.patch('/:id/toggle', async (req, reply) => {
    const { id } = req.params as { id: string }

    const existing = await prisma.recurringTransaction.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(existing.accountBookId, userId)

    const updated = await prisma.recurringTransaction.update({
      where: { id },
      data: {
        active: !existing.active,
        nextGenerateAt: existing.active ? null : getNextTriggerTime(existing.cron),
      },
    })

    return { active: updated.active }
  })
}
