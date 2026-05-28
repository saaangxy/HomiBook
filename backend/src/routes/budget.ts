import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import {
  createBudgetSchema,
  updateBudgetSchema,
  batchCreateSchema,
  copyBudgetsSchema,
  listBudgetsQuerySchema,
  summaryQuerySchema,
} from '../schemas/budget.js'
import { generateUniqueTag, computeBudgetSummary } from '../services/budget.js'

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
      return reply.status(400).send({ message: query.error.errors[0].message })
    }

    const { bookId, year, month, type } = query.data
    await assertIsMember(bookId, (req.user as { id: string }).id)

    const where: any = { accountBookId: bookId }
    if (year !== undefined) where.year = year
    if (month !== undefined) where.month = month
    if (type) where.type = type

    const budgets = await prisma.budget.findMany({
      where,
      orderBy: [{ type: 'asc' }, { month: 'asc' }, { name: 'asc' }],
    })

    return budgets
  })

  // 获取汇总
  app.get('/summary', async (req, reply) => {
    const query = summaryQuerySchema.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ message: query.error.errors[0].message })
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
      where: { accountBookId: bookId, type: 'FREE', tag: { not: null } },
      select: { tag: true },
      distinct: ['tag'],
    })

    return budgets.map(b => b.tag!)
  })

  // 创建单条预算
  app.post('/', async (req, reply) => {
    const parsed = createBudgetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0].message })
    }

    const { accountBookId, name, type, year, month, amount, categoryCode, remark } = parsed.data
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

    // FREE 类型自动生成标签
    let tag: string | undefined
    if (type === 'FREE') {
      tag = await generateUniqueTag(name, accountBookId, year, month)
    }

    const budget = await prisma.budget.create({
      data: { accountBookId, name, type, year, month, amount, categoryCode, tag, remark },
    })
    return budget
  })

  // 更新预算
  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateBudgetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0].message })
    }

    const existing = await prisma.budget.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '预算不存在' })
    await assertIsMember(existing.accountBookId, (req.user as { id: string }).id)

    const data: any = { ...parsed.data }

    // 如果 FREE 预算改名称，重新生成标签
    if (existing.type === 'FREE' && data.name && data.name !== existing.name) {
      data.tag = await generateUniqueTag(data.name, existing.accountBookId, existing.year, existing.month, id)
    }

    const budget = await prisma.budget.update({ where: { id }, data })
    return budget
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
      return reply.status(400).send({ message: parsed.error.errors[0].message })
    }

    const { accountBookId, name, type, amount, categoryCode, months, year, remark } = parsed.data
    await assertIsMember(accountBookId, (req.user as { id: string }).id)

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

        let tag: string | undefined
        if (type === 'FREE') {
          // 在事务中检查标签唯一性
          const baseTag = name
          let candidate = baseTag
          let seq = 0
          while (true) {
            const conflict = await tx.budget.findFirst({
              where: { accountBookId, type: 'FREE', tag: candidate, id: undefined as any },
            })
            if (!conflict) break
            seq++
            if (seq === 1) {
              const ym = `${String(year).slice(2)}${String(month).padStart(2, '0')}`
              candidate = `${baseTag}${ym}`
            } else {
              const ym = `${String(year).slice(2)}${String(month).padStart(2, '0')}`
              candidate = `${baseTag}${ym}-${seq}`
            }
          }
          tag = candidate
        }

        const budget = await tx.budget.create({
          data: { accountBookId, name, type, year, month, amount, categoryCode, tag, remark },
        })
        created.push(budget)
      }
      return created
    })

    return results
  })

  // 复制预算
  app.post('/copy', async (req, reply) => {
    const parsed = copyBudgetsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0].message })
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

          let tag: string | undefined
          if (budget.type === 'FREE') {
            tag = await generateUniqueTag(budget.name, accountBookId, target.year, target.month)
          }

          await tx.budget.create({
            data: {
              accountBookId,
              name: budget.name,
              type: budget.type,
              year: target.year,
              month: target.month,
              amount: budget.amount,
              categoryCode: budget.categoryCode,
              tag,
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
