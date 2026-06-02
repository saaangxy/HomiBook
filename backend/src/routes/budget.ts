import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import {
  createBudgetSchema,
  updateBudgetSchema,
  batchCreateSchema,
  batchUpdateBudgetSchema,
  copyBudgetsSchema,
  listBudgetsQuerySchema,
  summaryQuerySchema,
} from '../schemas/budget.js'
import { computeBudgetSummary } from '../services/budget.js'

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapBudget(b: any) {
  return { ...b, tags: parseTags(b.tags) }
}

async function assertIsMember(bookId: string, userId: string) {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  if (book.ownerId === userId) return
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) throw Object.assign(new Error('无权访问该账本'), { statusCode: 403 })
}

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 获取预算列表
  app.get('/', async (req, reply) => {
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

  // 获取汇总
  app.get('/summary', async (req, reply) => {
    const query = summaryQuerySchema.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ message: query.error.issues[0].message })
    }

    const { bookId, year, month } = query.data
    await assertIsMember(bookId, (req.user as { id: string }).id)

    const summary = await computeBudgetSummary(bookId, year, month)
    return summary
  })

  // 获取可用标签列表
  app.get('/tags', async (req, reply) => {
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
  app.post('/', async (req, reply) => {
    const parsed = createBudgetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { accountBookId, name, type, year, month, amount, categoryCode, tags, remark } = parsed.data
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
        remark,
      },
    })
    return mapBudget(budget)
  })

  // 更新预算
  app.patch('/:id', async (req, reply) => {
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

    const budget = await prisma.budget.update({ where: { id }, data })
    return mapBudget(budget)
  })

  // 批量更新预算
  app.patch('/batch', async (req, reply) => {
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

    await prisma.budget.updateMany({
      where: { id: { in: ids } },
      data: updateData,
    })

    return { updated: ids.length }
  })

  // 删除预算
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = await prisma.budget.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '预算不存在' })
    await assertIsMember(existing.accountBookId, (req.user as { id: string }).id)

    await prisma.budget.delete({ where: { id } })
    return { success: true }
  })

  // 批量生成预算
  app.post('/batch', async (req, reply) => {
    const parsed = batchCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { accountBookId, name, type, amount, categoryCode, months, year, tags, remark } = parsed.data
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
          data: { accountBookId, name, type, year, month, amount, categoryCode, tags: tagsJson, remark },
        })
        created.push(budget)
      }
      return created
    })

    return results.map(mapBudget)
  })

  // 复制预算
  app.post('/copy', async (req, reply) => {
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
