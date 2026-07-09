import type {FastifyInstance} from 'fastify'
import {prisma} from '../app.js'
import {authenticate, assertIsMember} from '../middleware/auth.js'
import {z} from 'zod'
import {zSchema} from '../lib/schema-helpers.js'
import {
  batchCreateSchema,
  batchUpdateBudgetSchema,
  copyBudgetsSchema,
  createBudgetSchema,
  fixedBudgetsQuerySchema,
  freeBudgetsQuerySchema,
  listBudgetsQuerySchema,
  updateBudgetSchema,
} from '../schemas/budget.js'
import { mapBudget, buildFreeBudgetDateFilter, computeActualAmount } from '../services/budget.js'

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 获取预算列表
  app.get('/', {
    schema: {
      tags: ['预算'],
      summary: '查询预算列表',
      querystring: zSchema(listBudgetsQuerySchema),
    },
  }, async (req, reply) => {
    const query = listBudgetsQuerySchema.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ message: query.error.issues[0].message })
    }

    const { bookId, year, month, type } = query.data
    await assertIsMember(bookId, (req.user as { id: string }).id)

    // FIXED 预算按年月筛选，FREE 预算始终全部返回
    const orConditions: any[] = []
    if (!type || type === 'FIXED') {
      const fixedWhere: any = { accountBookId: bookId, type: 'FIXED' }
      if (year !== undefined) fixedWhere.year = year
      if (month !== undefined) fixedWhere.month = month
      orConditions.push(fixedWhere)
    }
    if (!type || type === 'FREE') {
      orConditions.push({ accountBookId: bookId, type: 'FREE' })
    }

    const budgets = await prisma.budget.findMany({
      where: { OR: orConditions },
      orderBy: [{ type: 'asc' }, { month: 'asc' }, { name: 'asc' }],
    })

    return budgets.map(mapBudget)
  })

  // 固定预算列表（含 actualAmount）
  app.get('/fixed', {
    schema: {
      tags: ['预算'],
      summary: '固定预算列表（含实际金额）',
      querystring: zSchema(fixedBudgetsQuerySchema),
    },
  }, async (req, reply) => {
    const query = fixedBudgetsQuerySchema.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ message: query.error.issues[0].message })
    }
    const { bookId, year, month, name } = query.data
    const userId = (req as any).user.id as string
    await assertIsMember(bookId, userId)

    const where: any = { accountBookId: bookId, type: 'FIXED' }
    if (year !== undefined) where.year = year
    if (month !== undefined) where.month = month
    if (name?.trim()) where.name = { contains: name.trim() }

    const budgets = await prisma.budget.findMany({
      where,
      orderBy: [{ month: 'asc' }, { name: 'asc' }],
    })

    // 计算每个预算的实际金额
    return await Promise.all(budgets.map(async (budget) => ({
      ...mapBudget(budget),
      actualAmount: await computeActualAmount(budget, bookId),
    })))
  })

  // 自由预算列表
  app.get('/free', {
    schema: {
      tags: ['预算'],
      summary: '自由预算列表（含实际金额）',
      querystring: zSchema(freeBudgetsQuerySchema),
    },
  }, async (req, reply) => {
    const query = freeBudgetsQuerySchema.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ message: query.error.issues[0].message })
    }
    const { bookId, startDate, endDate, name } = query.data
    const userId = (req as any).user.id as string
    await assertIsMember(bookId, userId)

    const where: any = { accountBookId: bookId, type: 'FREE' }
    if (name?.trim()) where.name = { contains: name.trim() }

    // 按查询参数过滤自由预算的日期范围
    const overlapConditions = buildFreeBudgetDateFilter(startDate, endDate)
    if (overlapConditions) where.OR = overlapConditions

    const budgets = await prisma.budget.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    // 计算每个预算的实际金额
    return await Promise.all(budgets.map(async (budget) => ({
      ...mapBudget(budget),
      actualAmount: await computeActualAmount(budget, bookId),
    })))
  })

  // 获取可用标签列表
  app.get('/tags', {
    schema: {
      tags: ['预算'],
      summary: '获取所有预算的标签',
      querystring: zSchema(z.object({ bookId: z.string() })),
    },
  }, async (req, reply) => {
    const { bookId } = req.query as { bookId?: string }
    if (!bookId) return reply.status(400).send({ message: '缺少 bookId 参数' })
    await assertIsMember(bookId, (req.user as { id: string }).id)

    const budgets = await prisma.budget.findMany({
      where: { accountBookId: bookId, tags: { not: '[]' } },
      select: { tags: true },
    })

    const tagSet = new Set<string>()
    for (const b of budgets) {
      try {
        const parsed = JSON.parse(b.tags)
        if (Array.isArray(parsed)) {
          for (const t of parsed) {
            if (typeof t === 'string' && t.trim()) tagSet.add(t.trim())
          }
        }
      } catch { /* skip invalid JSON */ }
    }
    return Array.from(tagSet).sort()
  })

  // 创建单条预算
  app.post('/', {
    schema: {
      tags: ['预算'],
      summary: '创建预算',
      body: zSchema(createBudgetSchema),
    },
  }, async (req, reply) => {
    const parsed = createBudgetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { accountBookId, name, type, year, month, amount, categoryCode, tags, startDate, endDate, remark } = parsed.data
    await assertIsMember(accountBookId, (req.user as { id: string }).id)

    // 检查重复
    const existing = await prisma.budget.findUnique({
      where: {
        accountBookId_type_year_month_name: {
          accountBookId, type, year, month, name,
        },
      },
    })
    if (existing) {
      return reply.status(409).send({ message: '该月份已存在同名预算' })
    }

    const budget = await prisma.budget.create({
      data: {
        accountBookId, name, type, year, month, amount,
        categoryCode,
        tags: JSON.stringify(tags || []),
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        remark,
      },
    })
    return mapBudget(budget)
  })

  // 更新预算
  app.patch('/:id', {
    schema: {
      tags: ['预算'],
      summary: '更新预算',
      body: zSchema(updateBudgetSchema),
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateBudgetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const existing = await prisma.budget.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '预算不存在' })
    await assertIsMember(existing.accountBookId, (req.user as { id: string }).id)

    const data: any = { ...parsed.data }
    if (data.tags !== undefined) {
      data.tags = JSON.stringify(data.tags)
    }
    if (data.startDate !== undefined) {
      data.startDate = data.startDate ? new Date(data.startDate) : null
    }
    if (data.endDate !== undefined) {
      data.endDate = data.endDate ? new Date(data.endDate) : null
    }

    const budget = await prisma.budget.update({ where: { id }, data })
    return mapBudget(budget)
  })

  // 批量更新预算
  app.patch('/batch', {
    schema: {
      tags: ['预算'],
      summary: '批量更新预算',
      body: zSchema(batchUpdateBudgetSchema),
    },
  }, async (req, reply) => {
    const parsed = batchUpdateBudgetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { ids, data } = parsed.data

    // 验证所有预算存在且属于同一账本
    const budgets = await prisma.budget.findMany({ where: { id: { in: ids } } })
    if (budgets.length !== ids.length) {
      return reply.status(404).send({ message: '部分预算不存在' })
    }

    const accountBookId = budgets[0].accountBookId
    if (budgets.some((b) => b.accountBookId !== accountBookId)) {
      return reply.status(400).send({ message: '只能批量编辑同一账本的预算' })
    }

    await assertIsMember(accountBookId, (req.user as { id: string }).id)

    const updateData: any = { ...data }
    if (updateData.tags !== undefined) {
      updateData.tags = JSON.stringify(updateData.tags)
    }
    if (updateData.startDate !== undefined) {
      updateData.startDate = updateData.startDate ? new Date(updateData.startDate) : null
    }
    if (updateData.endDate !== undefined) {
      updateData.endDate = updateData.endDate ? new Date(updateData.endDate) : null
    }

    await prisma.budget.updateMany({
      where: { id: { in: ids } },
      data: updateData,
    })

    return { updated: ids.length }
  })

  // 删除预算
  app.delete('/:id', {
    schema: {
      tags: ['预算'],
      summary: '删除预算',
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = await prisma.budget.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '预算不存在' })
    await assertIsMember(existing.accountBookId, (req.user as { id: string }).id)

    await prisma.budget.delete({ where: { id } })
    return { success: true }
  })

  // 批量生成预算
  app.post('/batch', {
    schema: {
      tags: ['预算'],
      summary: '批量创建多月预算',
      body: zSchema(batchCreateSchema),
    },
  }, async (req, reply) => {
    const parsed = batchCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { accountBookId, name, type, amount, categoryCode, months, year, tags, startDate, endDate, remark } = parsed.data
    await assertIsMember(accountBookId, (req.user as { id: string }).id)

    const tagsJson = JSON.stringify(tags || [])

    const results = await prisma.$transaction(async (tx) => {
      const created: any[] = []
      for (const month of months) {
        // 检查重复
        const existing = await tx.budget.findUnique({
          where: {
            accountBookId_type_year_month_name: {
              accountBookId, type, year, month, name,
            },
          },
        })
        if (existing) continue // 已存在则跳过

        const budget = await tx.budget.create({
          data: {
            accountBookId, name, type, year, month, amount, categoryCode, tags: tagsJson,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            remark,
          },
        })
        created.push(budget)
      }
      return created
    })

    return results.map(mapBudget)
  })

  // 复制预算
  app.post('/copy', {
    schema: {
      tags: ['预算'],
      summary: '复制预算到目标月份',
      body: zSchema(copyBudgetsSchema),
    },
  }, async (req, reply) => {
    const parsed = copyBudgetsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { accountBookId, sourceYear, sourceMonth, targetMonths } = parsed.data
    await assertIsMember(accountBookId, (req.user as { id: string }).id)

    // 获取源月份所有预算
    const sourceBudgets = await prisma.budget.findMany({
      where: { accountBookId, year: sourceYear, month: sourceMonth },
    })

    let count = 0
    await prisma.$transaction(async (tx) => {
      for (const target of targetMonths) {
        for (const budget of sourceBudgets) {
          // 检查目标月份是否已存在同名预算
          const existing = await tx.budget.findUnique({
            where: {
              accountBookId_type_year_month_name: {
                accountBookId,
                type: budget.type,
                year: target.year,
                month: target.month,
                name: budget.name,
              },
            },
          })
          if (existing) continue

          await tx.budget.create({
            data: {
              accountBookId,
              name: budget.name,
              type: budget.type,
              year: target.year,
              month: target.month,
              amount: budget.amount,
              categoryCode: budget.categoryCode,
              tags: budget.tags,
              startDate: budget.startDate,
              endDate: budget.endDate,
              remark: budget.remark,
            },
          })
          count++
        }
      }
    })

    return { count }
  })
}
