import type {FastifyInstance} from 'fastify'
import {prisma} from '../app.js'
import {authenticate, assertIsMember} from '../middleware/auth.js'
import {z} from 'zod'
import {zSchema} from '../lib/schema-helpers.js'
import {createRecurringSchema, listRecurringSchema, updateRecurringSchema,} from '../schemas/recurring.js'
import {
  calcEqualInstallment,
  ensureFixedTag,
  generateEqualInstallmentPlan,
  generateEqualPrincipalPlan,
  getNextTriggerTime,
} from '../services/recurring.js'

export async function recurringRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 列表
  app.get('/', {
    schema: {
      tags: ['固定收支'],
      summary: '获取固定收支/贷款列表',
      querystring: zSchema(listRecurringSchema),
      response: {
        200: {
          type: 'array',
          description: '固定收支列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '记录ID' },
              accountBookId: { type: 'string', description: '所属账本ID' },
              name: { type: 'string', description: '名称' },
              type: { type: 'string', description: '类型' },
              amount: { type: 'number', description: '金额' },
              remark: { type: 'string', description: '备注' },
              tags: { type: 'array', items: { type: 'string' }, description: '标签' },
              accountId: { type: 'string', description: '账户ID' },
              toAccountId: { type: 'string', description: '目标账户ID' },
              categoryCode: { type: 'string', description: '分类编码' },
              payer: { type: 'string', description: '交易方' },
              ownerId: { type: 'string', description: '归属人ID' },
              cron: { type: 'string', description: '触发时间（cron表达式）' },
              active: { type: 'boolean', description: '是否启用' },
              recurringType: { type: 'string', description: '周期类型' },
              loanTotalAmount: { type: 'number', description: '贷款总额' },
              loanRemainingAmount: { type: 'number', description: '贷款剩余金额' },
              loanInterestRate: { type: 'number', description: '贷款利率' },
              loanInterestMethod: { type: 'string', description: '贷款计息方式' },
              loanStartDate: { type: 'string', description: '贷款开始日期' },
              loanTermMonths: { type: 'number', description: '贷款期数（月）' },
              loanMonthlyPayment: { type: 'number', description: '月还款额' },
              nextGenerateAt: { type: 'string', description: '下次生成时间' },
              lastGeneratedAt: { type: 'string', description: '上次生成时间' },
              account: { type: 'object', description: '账户信息', properties: { id: { type: 'string', description: '账户ID' }, name: { type: 'string', description: '账户名称' }, type: { type: 'string', description: '账户类型' } } },
              toAccount: { type: 'object', description: '目标账户信息', properties: { id: { type: 'string', description: '账户ID' }, name: { type: 'string', description: '账户名称' }, type: { type: 'string', description: '账户类型' } } },
              owner: { type: 'object', description: '归属人信息', properties: { id: { type: 'string', description: '用户ID' }, nickname: { type: 'string', description: '昵称' }, email: { type: 'string', description: '邮箱' } } },
              repaymentPlans: { type: 'array', description: '还款计划列表', items: { type: 'object' } },
              createdAt: { type: 'string', description: '创建时间' },
              updatedAt: { type: 'string', description: '更新时间' },
            },
          },
        },
      },
    },
  }, async (req) => {
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
        owner: { select: { id: true, nickname: true, email: true } },
        repaymentPlans: { orderBy: { period: 'asc' } },
      },
    })

    return list.map((r: { tags: string; nextGenerateAt: any; active: any; cron: string }) => ({
      ...r,
      tags: JSON.parse(r.tags),
      nextGenerateAt: r.nextGenerateAt || (r.active ? getNextTriggerTime(r.cron) : null),
    }))
  })

  // 计算贷款预览
  app.post('/loan-preview', {
    schema: {
      tags: ['固定收支'],
      summary: '贷款计算预览',
      body: zSchema(z.object({
        total: z.number().positive(),
        annualRate: z.number().min(0),
        months: z.number().int().min(1),
        startDate: z.string(),
        method: z.enum(['EQUAL_INSTALLMENT', 'EQUAL_PRINCIPAL']),
      })),
    },
  }, async (req) => {
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
  app.get('/:id/plan', {
    schema: {
      tags: ['固定收支'],
      summary: '获取还款计划',
      params: zSchema(z.object({ id: z.string() })),
      response: {
        200: {
          type: 'array',
          description: '还款计划列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '计划ID' },
              recurringTransactionId: { type: 'string', description: '所属固定收支ID' },
              period: { type: 'number', description: '期数' },
              dueDate: { type: 'string', description: '应还日期' },
              totalPayment: { type: 'number', description: '应还总额' },
              principal: { type: 'number', description: '本金' },
              interest: { type: 'number', description: '利息' },
              remainingPrincipal: { type: 'number', description: '剩余本金' },
              status: { type: 'string', description: '状态' },
              generatedRecordId: { type: 'string', description: '已生成流水ID' },
              createdAt: { type: 'string', description: '创建时间' },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const rt = await prisma.recurringTransaction.findUnique({ where: { id } })
    if (!rt) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(rt.accountBookId, userId)

    return prisma.repaymentPlan.findMany({
      where: {recurringTransactionId: id},
      orderBy: {period: 'asc'},
    });
  })

  // 详情
  app.get('/:id', {
    schema: {
      tags: ['固定收支'],
      summary: '获取固定收支详情',
      params: zSchema(z.object({ id: z.string() })),
      response: {
        200: {
          type: 'object',
          description: '固定收支详情',
          properties: {
            id: { type: 'string', description: '记录ID' },
            accountBookId: { type: 'string', description: '所属账本ID' },
            name: { type: 'string', description: '名称' },
            type: { type: 'string', description: '类型' },
            amount: { type: 'number', description: '金额' },
            remark: { type: 'string', description: '备注' },
            tags: { type: 'array', items: { type: 'string' }, description: '标签' },
            accountId: { type: 'string', description: '账户ID' },
            toAccountId: { type: 'string', description: '目标账户ID' },
            categoryCode: { type: 'string', description: '分类编码' },
            payer: { type: 'string', description: '交易方' },
            ownerId: { type: 'string', description: '归属人ID' },
            cron: { type: 'string', description: '触发时间（cron表达式）' },
            active: { type: 'boolean', description: '是否启用' },
            recurringType: { type: 'string', description: '周期类型' },
            loanTotalAmount: { type: 'number', description: '贷款总额' },
            loanRemainingAmount: { type: 'number', description: '贷款剩余金额' },
            loanInterestRate: { type: 'number', description: '贷款利率' },
            loanInterestMethod: { type: 'string', description: '贷款计息方式' },
            loanStartDate: { type: 'string', description: '贷款开始日期' },
            loanTermMonths: { type: 'number', description: '贷款期数（月）' },
            loanMonthlyPayment: { type: 'number', description: '月还款额' },
            nextGenerateAt: { type: 'string', description: '下次生成时间' },
            lastGeneratedAt: { type: 'string', description: '上次生成时间' },
            account: { type: 'object', description: '账户信息', properties: { id: { type: 'string', description: '账户ID' }, name: { type: 'string', description: '账户名称' }, type: { type: 'string', description: '账户类型' } } },
            toAccount: { type: 'object', description: '目标账户信息', properties: { id: { type: 'string', description: '账户ID' }, name: { type: 'string', description: '账户名称' }, type: { type: 'string', description: '账户类型' } } },
            owner: { type: 'object', description: '归属人信息', properties: { id: { type: 'string', description: '用户ID' }, nickname: { type: 'string', description: '昵称' }, email: { type: 'string', description: '邮箱' } } },
            repaymentPlans: { type: 'array', description: '还款计划列表', items: { type: 'object' } },
            createdAt: { type: 'string', description: '创建时间' },
            updatedAt: { type: 'string', description: '更新时间' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const rt = await prisma.recurringTransaction.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        owner: { select: { id: true, nickname: true, email: true } },
        repaymentPlans: { orderBy: { period: 'asc' } },
      },
    })
    if (!rt) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(rt.accountBookId, userId)

    return { ...rt, tags: JSON.parse(rt.tags) }
  })

  // 创建
  app.post('/', {
    schema: {
      tags: ['固定收支'],
      summary: '创建固定收支或贷款',
      body: zSchema(createRecurringSchema),
    },
  }, async (req, reply) => {
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
        owner: { select: { id: true, nickname: true, email: true } },
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
        if (isPastDue && data.generateAll) {
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
      if (data.generateAll) {
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
  app.patch('/:id', {
    schema: {
      tags: ['固定收支'],
      summary: '更新固定收支',
      body: zSchema(updateRecurringSchema),
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
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
        owner: { select: { id: true, nickname: true, email: true } },
        repaymentPlans: { orderBy: { period: 'asc' } },
      },
    })

    return { ...updated, tags: JSON.parse(updated.tags) }
  })

  // 删除
  app.delete('/:id', {
    schema: {
      tags: ['固定收支'],
      summary: '删除固定收支',
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const existing = await prisma.recurringTransaction.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    const userId = (req as any).user.id as string
    await assertIsMember(existing.accountBookId, userId)

    await prisma.recurringTransaction.delete({ where: { id } })
    return { success: true }
  })

  // 切换启用/停用
  app.patch('/:id/toggle', {
    schema: {
      tags: ['固定收支'],
      summary: '切换启用/停用状态',
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
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
