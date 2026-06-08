import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import {
  createBookSchema,
  updateBookSchema,
  generateShareCodeSchema,
  joinByCodeSchema,
  addMemberSchema,
  updateMemberRoleSchema,
} from '../schemas/book.js'
import { z } from 'zod'
import { zSchema } from '../lib/schema-helpers.js'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

async function assertIsOwner(bookId: string, userId: string) {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) {
    throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  }
  if (book.ownerId !== userId) {
    throw Object.assign(new Error('只有账本归属人可以执行此操作'), { statusCode: 403 })
  }
  return book
}

async function assertCanManage(bookId: string, userId: string) {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) {
    throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  }
  // 归属人始终可以管理
  if (book.ownerId === userId) return book
  // 检查是否为管理员
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) {
    throw Object.assign(new Error('你不是该账本的成员'), { statusCode: 403 })
  }
  if (member.role !== 'admin') {
    throw Object.assign(new Error('只有归属人或管理员可以执行此操作'), { statusCode: 403 })
  }
  return book
}

async function assertIsMember(bookId: string, userId: string) {
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) {
    throw Object.assign(new Error('你不是该账本的成员'), { statusCode: 403 })
  }
  return member
}

export async function bookRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ============= 查码（必须在 :id 路由之前注册，避免 share-codes 被当作 :id） =============

  app.get('/share-codes/:code', { schema: { description: '根据分享码查询账本信息', tags: ['账本'], params: zSchema(z.object({ code: z.string() })) } }, async (req, reply) => {
    const { code } = req.params as { code: string }

    const shareCode = await prisma.shareCode.findUnique({
      where: { code },
      include: { accountBook: { select: { id: true, name: true } } },
    })

    if (!shareCode) {
      return reply.status(404).send({ message: '分享码无效' })
    }

    if (shareCode.expiresAt && shareCode.expiresAt < new Date()) {
      return reply.status(400).send({ message: '分享码已过期' })
    }

    return {
      bookId: shareCode.accountBook.id,
      bookName: shareCode.accountBook.name,
      code: shareCode.code,
      expiresAt: shareCode.expiresAt,
    }
  })

  // ============= 加入账本 =============

  app.post('/join', { schema: { description: '通过分享码加入账本', tags: ['账本'], body: zSchema(joinByCodeSchema) } }, async (req, reply) => {
    const parsed = joinByCodeSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { code } = parsed.data
    const payload = req.user as { id: string }

    const shareCode = await prisma.shareCode.findUnique({ where: { code } })
    if (!shareCode) {
      return reply.status(400).send({ message: '分享码无效' })
    }

    if (shareCode.expiresAt && shareCode.expiresAt < new Date()) {
      return reply.status(400).send({ message: '分享码已过期' })
    }

    // 检查是否已经是成员
    const existing = await prisma.accountBookMember.findUnique({
      where: {
        accountBookId_userId: {
          accountBookId: shareCode.accountBookId,
          userId: payload.id,
        },
      },
    })
    if (existing) {
      return reply.status(400).send({ message: '你已经是该账本的成员' })
    }

    await prisma.accountBookMember.create({
      data: {
        accountBookId: shareCode.accountBookId,
        userId: payload.id,
      },
    })

    const book = await prisma.accountBook.findUnique({
      where: { id: shareCode.accountBookId },
      include: { _count: { select: { members: true } } },
    })

    if (!book) {
      return reply.status(404).send({ message: '账本不存在' })
    }

    return {
      id: book.id,
      name: book.name,
      ownerId: book.ownerId,
      role: 'member' as const,
      memberCount: book._count.members,
      createdAt: book.createdAt,
    }
  })

  // ============= 获取当前用户的账本列表 =============

  app.get('/', { schema: { description: '获取当前用户的所有账本', tags: ['账本'] } }, async (req) => {
    const payload = req.user as { id: string }

    const books = await prisma.accountBook.findMany({
      where: {
        OR: [
          { ownerId: payload.id },
          { members: { some: { userId: payload.id } } },
        ],
      },
      include: {
        _count: { select: { members: true } },
        members: {
          where: { userId: payload.id },
          select: { role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return books.map((book) => ({
      id: book.id,
      name: book.name,
      ownerId: book.ownerId,
      role: book.ownerId === payload.id ? 'owner' : (book.members[0]?.role || 'member'),
      memberCount: book._count.members,
      createdAt: book.createdAt,
    }))
  })

  // ============= 创建账本 =============

  app.post('/', { schema: { description: '创建新账本', tags: ['账本'], body: zSchema(createBookSchema) } }, async (req, reply) => {
    const parsed = createBookSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const payload = req.user as { id: string }
    const { name } = parsed.data

    const book = await prisma.accountBook.create({
      data: {
        name,
        ownerId: payload.id,
        members: {
          create: { userId: payload.id },
        },
      },
      include: {
        _count: { select: { members: true } },
      },
    })

    return reply.status(201).send({
      id: book.id,
      name: book.name,
      ownerId: book.ownerId,
      role: 'owner' as const,
      memberCount: book._count.members,
      createdAt: book.createdAt,
    })
  })

  // ============= 获取单个账本详情 =============

  app.get('/:id', { schema: { description: '获取账本详情', tags: ['账本'], params: zSchema(z.object({ id: z.string() })) } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }

    await assertIsMember(id, payload.id).catch((e) => {
      throw e
    })

    const book = await prisma.accountBook.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { members: true } },
      },
    })

    if (!book) {
      return reply.status(404).send({ message: '账本不存在' })
    }

    return {
      id: book.id,
      name: book.name,
      ownerId: book.ownerId,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      owner: book.owner,
      members: book.members,
      memberCount: book._count.members,
    }
  })

  // ============= 更新账本 =============

  app.patch('/:id', { schema: { description: '更新账本名称', tags: ['账本'], body: zSchema(updateBookSchema), params: zSchema(z.object({ id: z.string() })) } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }
    const parsed = updateBookSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    await assertIsOwner(id, payload.id)

    const updated = await prisma.accountBook.update({
      where: { id },
      data: parsed.data,
    })

    return {
      id: updated.id,
      name: updated.name,
      ownerId: updated.ownerId,
      role: 'owner' as const,
      createdAt: updated.createdAt,
    }
  })

  // ============= 删除账本 =============

  app.delete('/:id', { schema: { description: '删除账本及所有关联数据', tags: ['账本'], params: zSchema(z.object({ id: z.string() })) } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }

    await assertIsOwner(id, payload.id)

    // 手动级联删除（SQLite 不支持 onDelete: Cascade）
    // 顺序：Record → BalanceAdjustment → Account → CategoryMapping → ShareCode → Budget → AccountBookMember → AccountBook
    await prisma.$transaction([
      prisma.record.deleteMany({ where: { accountBookId: id } }),
      prisma.balanceAdjustment.deleteMany({ where: { account: { accountBookId: id } } }),
      prisma.account.deleteMany({ where: { accountBookId: id } }),
      prisma.categoryMapping.deleteMany({ where: { accountBookId: id } }),
      prisma.shareCode.deleteMany({ where: { accountBookId: id } }),
      prisma.budget.deleteMany({ where: { accountBookId: id } }),
      prisma.accountBookMember.deleteMany({ where: { accountBookId: id } }),
      prisma.accountBook.delete({ where: { id } }),
    ])

    return { success: true }
  })

  // ============= 成员管理 =============

  // 获取成员列表
  app.get('/:id/members', { schema: { description: '获取账本成员列表', tags: ['账本'], params: zSchema(z.object({ id: z.string() })) } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }

    await assertIsMember(id, payload.id)

    const members = await prisma.accountBookMember.findMany({
      where: { accountBookId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    })

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    }))
  })

  // 添加成员
  app.post('/:id/members', { schema: { description: '添加账本成员', tags: ['账本'], body: zSchema(addMemberSchema), params: zSchema(z.object({ id: z.string() })) } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }
    const parsed = addMemberSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请输入有效的邮箱地址' })
    }

    await assertCanManage(id, payload.id)

    const targetUser = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (!targetUser) {
      return reply.status(404).send({ message: '该邮箱未注册' })
    }

    // 检查是否已是成员
    const existing = await prisma.accountBookMember.findUnique({
      where: { accountBookId_userId: { accountBookId: id, userId: targetUser.id } },
    })
    if (existing) {
      return reply.status(400).send({ message: '该用户已是账本成员' })
    }

    const member = await prisma.accountBookMember.create({
      data: {
        accountBookId: id,
        userId: targetUser.id,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    return reply.status(201).send({
      id: member.id,
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      user: member.user,
    })
  })

  // 移除成员
  app.delete('/:id/members/:memberId', { schema: { description: '移除账本成员', tags: ['账本'], params: zSchema(z.object({ id: z.string(), memberId: z.string() })) } }, async (req, reply) => {
    const { id, memberId } = req.params as { id: string; memberId: string }
    const payload = req.user as { id: string }

    const member = await prisma.accountBookMember.findUnique({ where: { id: memberId } })
    if (!member || member.accountBookId !== id) {
      return reply.status(404).send({ message: '成员不存在' })
    }

    // owner/admin 可以删除成员，普通成员只能删除自己（退出）
    const book = await prisma.accountBook.findUnique({ where: { id } })
    if (!book) {
      return reply.status(404).send({ message: '账本不存在' })
    }

    // 检查操作者权限：归属人、管理员、或成员本人
    const actorMember = await prisma.accountBookMember.findUnique({
      where: { accountBookId_userId: { accountBookId: id, userId: payload.id } },
    })
    const canManage = payload.id === book.ownerId || actorMember?.role === 'admin'
    if (payload.id !== member.userId && !canManage) {
      return reply.status(403).send({ message: '无权操作' })
    }

    // 不能移除账本归属人
    if (book.ownerId === member.userId) {
      return reply.status(400).send({ message: '不能移除账本归属人' })
    }

    await prisma.accountBookMember.delete({ where: { id: memberId } })
    return { success: true }
  })

  // 修改成员角色
  app.patch('/:id/members/:memberId/role', { schema: { description: '更新成员角色', tags: ['账本'], body: zSchema(updateMemberRoleSchema), params: zSchema(z.object({ id: z.string(), memberId: z.string() })) } }, async (req, reply) => {
    const { id, memberId } = req.params as { id: string; memberId: string }
    const payload = req.user as { id: string }
    const parsed = updateMemberRoleSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    await assertIsOwner(id, payload.id)

    const member = await prisma.accountBookMember.findUnique({ where: { id: memberId } })
    if (!member || member.accountBookId !== id) {
      return reply.status(404).send({ message: '成员不存在' })
    }

    // 不能修改归属人的角色
    const book = await prisma.accountBook.findUnique({ where: { id } })
    if (book?.ownerId === member.userId) {
      return reply.status(400).send({ message: '不能修改账本归属人的角色' })
    }

    const updated = await prisma.accountBookMember.update({
      where: { id: memberId },
      data: { role: parsed.data.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    return {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      joinedAt: updated.joinedAt,
      user: updated.user,
    }
  })

  // ============= 分享码管理 =============

  // 生成分享码
  app.post('/:id/share-codes', { schema: { description: '生成分享码', tags: ['账本'], body: zSchema(generateShareCodeSchema), params: zSchema(z.object({ id: z.string() })) } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }
    const parsed = generateShareCodeSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    await assertCanManage(id, payload.id)

    const expiresAt = parsed.data.expiresInHours
      ? new Date(Date.now() + parsed.data.expiresInHours * 3600000)
      : null

    const code = generateCode()

    const shareCode = await prisma.shareCode.create({
      data: {
        accountBookId: id,
        code,
        expiresAt,
      },
    })

    return {
      id: shareCode.id,
      code: shareCode.code,
      expiresAt: shareCode.expiresAt,
      createdAt: shareCode.createdAt,
      isExpired: false,
    }
  })

  // 获取分享码列表
  app.get('/:id/share-codes', { schema: { description: '获取账本分享码列表', tags: ['账本'], params: zSchema(z.object({ id: z.string() })) } }, async (req) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }

    await assertCanManage(id, payload.id)

    const codes = await prisma.shareCode.findMany({
      where: { accountBookId: id },
      orderBy: { createdAt: 'desc' },
    })

    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
      isExpired: c.expiresAt ? c.expiresAt < new Date() : false,
    }))
  })

  // 删除分享码
  app.delete('/:id/share-codes/:codeId', { schema: { description: '删除分享码', tags: ['账本'], params: zSchema(z.object({ id: z.string(), codeId: z.string() })) } }, async (req, reply) => {
    const { id, codeId } = req.params as { id: string; codeId: string }
    const payload = req.user as { id: string }

    await assertCanManage(id, payload.id)

    const shareCode = await prisma.shareCode.findUnique({ where: { id: codeId } })
    if (!shareCode || shareCode.accountBookId !== id) {
      return reply.status(404).send({ message: '分享码不存在' })
    }

    await prisma.shareCode.delete({ where: { id: codeId } })
    return { success: true }
  })
}
