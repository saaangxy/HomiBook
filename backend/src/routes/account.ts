import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import {
  createAccountSchema,
  updateAccountSchema,
  createAdjustmentSchema,
} from '../schemas/account.js'

// 校验用户是账本成员
async function assertIsMember(bookId: string, userId: string) {
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  const isOwner = book?.ownerId === userId
  if (!member && !isOwner) {
    throw Object.assign(new Error('无权访问该账本'), { statusCode: 403 })
  }
}

// 校验用户可管理账户（归属人、账本归属人、账本管理员）
async function assertCanManageAccount(accountId: string, userId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    throw Object.assign(new Error('账户不存在'), { statusCode: 404 })
  }
  if (account.ownerId === userId) return account

  const book = await prisma.accountBook.findUnique({ where: { id: account.accountBookId } })
  if (book?.ownerId === userId) return account

  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: account.accountBookId, userId } },
  })
  if (member?.role === 'admin') return account

  throw Object.assign(new Error('无权管理该账户'), { statusCode: 403 })
}

// 根据可见性过滤敏感字段（余额、卡号），仅归属人可见
function sanitizeAccount(account: any, userId: string) {
  if (account.visibility === 'PRIVATE' && account.ownerId !== userId) {
    return {
      ...account,
      balance: undefined,
      initialBalance: undefined,
      balanceAt: undefined,
      computedBalance: undefined,
      accountNo: null,
    }
  }
  return account
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 列出账本下所有账户
  app.get('/', async (req, reply) => {
    const { bookId } = req.query as { bookId?: string }
    if (!bookId) {
      return reply.status(400).send({ message: '缺少 bookId 参数' })
    }
    const userId = (req as any).user.id as string

    try {
      await assertIsMember(bookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const accounts = await prisma.account.findMany({
      where: { accountBookId: bookId },
      include: { owner: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return accounts.map((a) => {
      const base: Record<string, unknown> = {
        ...a,
        computedBalance: a.balance,
        ownerName: a.owner.name || a.owner.email,
      }
      delete (base as any).owner
      return sanitizeAccount(base, userId)
    })
  })

  // 创建账户
  app.post('/', async (req, reply) => {
    const userId = (req as any).user.id as string
    const parsed = createAccountSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const { accountBookId, name, type, currency, initialBalance, accountNo, bankName, visibility } = parsed.data

    try {
      await assertIsMember(accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 信用卡余额必须 <= 0
    if (type === 'CREDIT_CARD' && initialBalance > 0) {
      return reply.status(400).send({ message: '信用卡初始余额不能大于0' })
    }

    const account = await prisma.account.create({
      data: {
        accountBookId,
        ownerId: userId,
        name,
        type,
        currency,
        initialBalance,
        balance: initialBalance,
        balanceAt: initialBalance !== 0 ? new Date() : null,
        accountNo,
        bankName,
        visibility,
      },
      include: { owner: { select: { id: true, name: true, email: true } } },
    })

    const result: Record<string, unknown> = {
      ...account,
      computedBalance: account.balance,
      ownerName: account.owner.name || account.owner.email,
    }
    delete (result as any).owner
    return sanitizeAccount(result, userId)
  })

  // 获取单个账户详情
  app.get('/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const account = await prisma.account.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true, email: true } } },
    })
    if (!account) {
      return reply.status(404).send({ message: '账户不存在' })
    }

    try {
      await assertIsMember(account.accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const result: Record<string, unknown> = {
      ...account,
      computedBalance: account.balance,
      ownerName: account.owner.name || account.owner.email,
    }
    delete (result as any).owner
    return sanitizeAccount(result, userId)
  })

  // 更新账户元数据
  app.patch('/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }
    const parsed = updateAccountSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    let currentAccount
    try {
      currentAccount = await assertCanManageAccount(id, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 如果将类型改为信用卡，检查当前余额是否 <= 0
    const newType = parsed.data.type ?? currentAccount.type
    if (newType === 'CREDIT_CARD' && currentAccount.balance > 0) {
      return reply.status(400).send({ message: '信用卡余额不能大于0，请先调整余额再修改类型' })
    }

    const account = await prisma.account.update({
      where: { id },
      data: parsed.data,
      include: { owner: { select: { id: true, name: true, email: true } } },
    })

    const result: Record<string, unknown> = {
      ...account,
      computedBalance: account.balance,
      ownerName: account.owner.name || account.owner.email,
    }
    delete (result as any).owner
    return sanitizeAccount(result, userId)
  })

  // 删除账户
  app.delete('/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    try {
      await assertCanManageAccount(id, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 先删除关联的余额调整记录
    await prisma.balanceAdjustment.deleteMany({ where: { accountId: id } })
    await prisma.account.delete({ where: { id } })

    return { success: true }
  })

  // 获取余额调整历史
  app.get('/:id/adjustments', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const account = await prisma.account.findUnique({ where: { id } })
    if (!account) {
      return reply.status(404).send({ message: '账户不存在' })
    }

    try {
      await assertIsMember(account.accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    return prisma.balanceAdjustment.findMany({
      where: { accountId: id },
      orderBy: { date: 'desc' },
    })
  })

  // 创建余额调整
  app.post('/:id/adjustments', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }
    const parsed = createAdjustmentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const { date, balanceAfter, remark } = parsed.data

    try {
      await assertCanManageAccount(id, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const account = await prisma.account.findUnique({ where: { id } })
    if (!account) {
      return reply.status(404).send({ message: '账户不存在' })
    }

    // 信用卡余额必须 <= 0
    if (account.type === 'CREDIT_CARD' && balanceAfter > 0) {
      return reply.status(400).send({ message: '信用卡余额不能大于0' })
    }

    const balanceBefore = account.balance
    const amount = balanceAfter - balanceBefore

    const adjustment = await prisma.$transaction([
      prisma.balanceAdjustment.create({
        data: {
          accountId: id,
          date: new Date(date),
          amount,
          balanceBefore,
          balanceAfter,
          remark,
        },
      }),
      prisma.account.update({
        where: { id },
        data: { balance: balanceAfter, balanceAt: new Date(date) },
      }),
    ])

    return adjustment[0]
  })
}
