import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import { createRecordSchema, updateRecordSchema, listRecordsSchema, calendarQuerySchema } from '../schemas/record.js'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'

async function assertIsMember(bookId: string, userId: string) {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  if (book.ownerId === userId) return
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) throw Object.assign(new Error('无权访问该账本'), { statusCode: 403 })
}

// 计算账户实时余额：以 balanceAt 为时间分界，只计算之后的流水
async function computeBalance(accountId: string): Promise<{ balance: number; balanceAt: Date | null }> {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) throw Object.assign(new Error('账户不存在'), { statusCode: 404 })

  // 找到最近一次余额调整记录
  const latestAdjustment = await prisma.balanceAdjustment.findFirst({
    where: { accountId },
    orderBy: { date: 'desc' },
  })

  const baseBalance = latestAdjustment?.balanceAfter ?? account.initialBalance ?? 0
  const baseDate = latestAdjustment?.date ?? null

  // 以调整时间为起点，只计算该时间之后的流水（排除调整时间点本身）
  const dateFilter = baseDate
    ? { gt: baseDate }
    : undefined

  const [incomeResult, expenseResult, transferOutResult, transferInResult] = await Promise.all([
    prisma.record.aggregate({ where: { accountId, type: 'INCOME', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { accountId, type: 'EXPENSE', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { fromAccountId: accountId, type: 'TRANSFER', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { toAccountId: accountId, type: 'TRANSFER', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
  ])

  const income = incomeResult._sum.amount ?? 0
  const expense = expenseResult._sum.amount ?? 0
  const transferOut = transferOutResult._sum.amount ?? 0
  const transferIn = transferInResult._sum.amount ?? 0

  const balance = baseBalance + income - expense + transferIn - transferOut

  return { balance, balanceAt: baseDate }
}

// 批量更新账户余额
async function refreshAccountBalance(accountId: string) {
  const { balance, balanceAt } = await computeBalance(accountId)
  await prisma.account.update({
    where: { id: accountId },
    data: { balance, balanceAt },
  })
}

export async function recordRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 列表查询（分页 + 筛选）
  app.get('/', async (req, reply) => {
    const parsed = listRecordsSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const { bookId, page, pageSize, type, accountId, categoryCode, dateFrom, dateTo, ownerId, payer, amountFrom, amountTo, remark, tags } = parsed.data
    const userId = (req as any).user.id as string

    try {
      await assertIsMember(bookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const where: any = { accountBookId: bookId }
    if (type) {
      const ids = type.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.type = ids[0]
      else if (ids.length > 1) where.type = { in: ids }
    }
    if (accountId) {
      const ids = accountId.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.accountId = ids[0]
      else if (ids.length > 1) where.accountId = { in: ids }
    }
    if (categoryCode) {
      const ids = categoryCode.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.categoryCode = ids[0]
      else if (ids.length > 1) where.categoryCode = { in: ids }
    }
    if (ownerId) {
      const ids = ownerId.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.ownerId = ids[0]
      else if (ids.length > 1) where.ownerId = { in: ids }
    }
    if (dateFrom || dateTo) where.date = {}
    if (dateFrom) where.date.gte = new Date(dateFrom)
    if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    if (payer) where.payer = { contains: payer }
    if (amountFrom !== undefined || amountTo !== undefined) where.amount = {}
    if (amountFrom !== undefined) where.amount.gte = amountFrom
    if (amountTo !== undefined) where.amount.lte = amountTo
    if (remark) where.remark = { contains: remark }
    if (tags) {
      const tagList = tags.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (tagList.length > 0) {
        where.AND = tagList.map((tag) => ({
          tags: { contains: tag.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') },
        }))
      }
    }

    const [records, total] = await Promise.all([
      prisma.record.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, type: true } },
          fromAccount: { select: { id: true, name: true } },
          toAccount: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, email: true } },
          recordAttachments: { select: { id: true, path: true, originalFilename: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.record.count({ where }),
    ])

    return {
      records: records.map((r) => ({
        ...r,
        tags: JSON.parse(r.tags),
        attachments: r.recordAttachments.map((a) => ({ id: a.id, url: a.path, originalFilename: a.originalFilename })),
        ownerName: r.owner.name || r.owner.email,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  })

  // 汇总统计（与列表查询共用相同的筛选条件）
  app.get('/summary', async (req, reply) => {
    const parsed = listRecordsSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const { bookId, type, accountId, categoryCode, dateFrom, dateTo, ownerId, payer, amountFrom, amountTo, remark, tags } = parsed.data
    const userId = (req as any).user.id as string

    try {
      await assertIsMember(bookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 解析用户类型筛选（不放入 where，由各聚合自行判断）
    const typeFilter: string[] | null = type
      ? type.split(',').map((s: string) => s.trim()).filter(Boolean)
      : null

    const where: any = { accountBookId: bookId }
    if (accountId) {
      const ids = accountId.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.accountId = ids[0]
      else if (ids.length > 1) where.accountId = { in: ids }
    }
    if (categoryCode) {
      const ids = categoryCode.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.categoryCode = ids[0]
      else if (ids.length > 1) where.categoryCode = { in: ids }
    }
    if (ownerId) {
      const ids = ownerId.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.ownerId = ids[0]
      else if (ids.length > 1) where.ownerId = { in: ids }
    }
    if (dateFrom || dateTo) where.date = {}
    if (dateFrom) where.date.gte = new Date(dateFrom)
    if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    if (payer) where.payer = { contains: payer }
    if (amountFrom !== undefined || amountTo !== undefined) where.amount = {}
    if (amountFrom !== undefined) where.amount.gte = amountFrom
    if (amountTo !== undefined) where.amount.lte = amountTo
    if (remark) where.remark = { contains: remark }
    if (tags) {
      const tagList = tags.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (tagList.length > 0) {
        where.AND = tagList.map((tag) => ({
          tags: { contains: tag.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') },
        }))
      }
    }

    // 如果用户筛选了类型，只聚合匹配的类型；否则聚合全部
    const shouldAgg = (recordType: string) => !typeFilter || typeFilter.includes(recordType)

    const [income, expense, transfer] = await Promise.all([
      shouldAgg('INCOME')
        ? prisma.record.aggregate({ where: { ...where, type: 'INCOME' }, _sum: { amount: true } }).then(r => r._sum.amount ?? 0)
        : Promise.resolve(0),
      shouldAgg('EXPENSE')
        ? prisma.record.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { amount: true } }).then(r => r._sum.amount ?? 0)
        : Promise.resolve(0),
      shouldAgg('TRANSFER')
        ? prisma.record.aggregate({ where: { ...where, type: 'TRANSFER' }, _sum: { amount: true } }).then(r => r._sum.amount ?? 0)
        : Promise.resolve(0),
    ])

    return {
      income,
      expense,
      transfer,
      netIncome: income - expense,
    }
  })

  // 获取记录标签列表（用于筛选器下拉）
  app.get('/tags', async (req, reply) => {
    const { bookId } = req.query as { bookId?: string }
    if (!bookId) return reply.status(400).send({ message: '缺少 bookId 参数' })

    const userId = (req as any).user.id as string
    try {
      await assertIsMember(bookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const records = await prisma.record.findMany({
      where: { accountBookId: bookId },
      select: { tags: true },
    })

    const tagSet = new Set<string>()
    for (const r of records) {
      try {
        const parsed = JSON.parse(r.tags)
        if (Array.isArray(parsed)) {
          for (const t of parsed) {
            if (typeof t === 'string') tagSet.add(t)
          }
        }
      } catch { /* skip malformed */ }
    }

    return Array.from(tagSet).sort()
  })

  // 日历聚合：按天汇总当月收支
  app.get('/calendar', async (req, reply) => {
    const parsed = calendarQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const { bookId, year, month } = parsed.data
    const userId = (req as any).user.id as string

    try {
      await assertIsMember(bookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 当月起止时间
    const start = new Date(Date.UTC(year, month - 1, 1))
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

    const records = await prisma.record.findMany({
      where: { accountBookId: bookId, date: { gte: start, lte: end } },
      select: { type: true, amount: true, date: true },
    })

    // 按天分组聚合
    const dayMap: Record<string, { income: number; expense: number; transfer: number; count: number }> = {}
    for (const r of records) {
      const day = r.date.toISOString().slice(0, 10)
      if (!dayMap[day]) dayMap[day] = { income: 0, expense: 0, transfer: 0, count: 0 }
      dayMap[day].count++
      if (r.type === 'INCOME') dayMap[day].income += r.amount
      else if (r.type === 'EXPENSE') dayMap[day].expense += r.amount
      else if (r.type === 'TRANSFER') dayMap[day].transfer += r.amount
    }

    // 补全当月所有日期
    const daysInMonth = new Date(year, month, 0).getDate()
    const result = []
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      result.push({
        date: dateStr,
        income: dayMap[dateStr]?.income ?? 0,
        expense: dayMap[dateStr]?.expense ?? 0,
        transfer: dayMap[dateStr]?.transfer ?? 0,
        count: dayMap[dateStr]?.count ?? 0,
      })
    }

    return result
  })

  // 创建流水
  app.post('/', async (req, reply) => {
    const parsed = createRecordSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const userId = (req as any).user.id as string
    const data = parsed.data

    try {
      await assertIsMember(data.accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 转账类型校验
    if (data.type === 'TRANSFER') {
      if (!data.fromAccountId || !data.toAccountId) {
        return reply.status(400).send({ message: '转账记录需要填写源账户和目标账户' })
      }
    }

    // 信用卡支出校验：余额不能低于负数上限
    if (data.type === 'EXPENSE') {
      const account = await prisma.account.findUnique({ where: { id: data.accountId } })
      if (account?.type === 'CREDIT_CARD') {
        const { balance } = await computeBalance(data.accountId)
        if (balance - data.amount < -account.initialBalance) {
          return reply.status(400).send({ message: '信用卡余额不能超限' })
        }
      }
    }

    const record = await prisma.record.create({
      data: {
        accountBookId: data.accountBookId,
        type: data.type,
        amount: data.amount,
        date: new Date(data.date),
        remark: data.remark,
        tags: JSON.stringify(data.tags ?? []),
        recordAttachments: {
          connect: (data.attachmentIds ?? []).map((id: string) => ({ id })),
        },
        accountId: data.accountId,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        categoryCode: data.categoryCode,
        payer: data.payer,
        ownerId: data.ownerId || userId,
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true } },
        recordAttachments: { select: { id: true, path: true, originalFilename: true } },
      },
    })

    // 更新涉及的账户余额
    const affectedAccounts = [data.accountId, data.fromAccountId, data.toAccountId].filter(Boolean) as string[]
    for (const accId of [...new Set(affectedAccounts)]) {
      await refreshAccountBalance(accId)
    }

    return {
      ...record,
      tags: JSON.parse(record.tags),
      attachments: record.recordAttachments.map((a) => ({ id: a.id, url: a.path, originalFilename: a.originalFilename })),
      ownerName: record.owner.name || record.owner.email,
    }
  })

  // 批量更新
  app.patch('/batch', async (req, reply) => {
    const { ids, data } = req.body as {
      ids: string[]
      data: Record<string, any>
    }
    if (!ids?.length) return reply.status(400).send({ message: '请选择要更新的记录' })

    // 校验 data 字段（复用 updateRecordSchema，排除 attachmentIds 和 ownerId）
    const parsed = updateRecordSchema.safeParse(data)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const updateData: any = { ...parsed.data }
    delete updateData.attachmentIds
    delete updateData.ownerId
    if (updateData.tags) updateData.tags = JSON.stringify(updateData.tags)
    if (updateData.date) updateData.date = new Date(updateData.date)

    await prisma.record.updateMany({
      where: { id: { in: ids } },
      data: updateData,
    })

    return { success: true, updated: ids.length }
  })

  // 更新单条
  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateRecordSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }
    const userId = (req as any).user.id as string

    const existing = await prisma.record.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    try {
      await assertIsMember(existing.accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const updateData: any = { ...parsed.data }
    delete updateData.attachmentIds
    if (parsed.data.tags) updateData.tags = JSON.stringify(parsed.data.tags)
    if (parsed.data.date) updateData.date = new Date(parsed.data.date)

    // 附件关联：找出被移除的附件，删除文件 + DB 记录
    if (parsed.data.attachmentIds !== undefined) {
      const keptIds = new Set(parsed.data.attachmentIds)
      const oldAttachments = await prisma.recordAttachment.findMany({ where: { recordId: id } })
      const removed = oldAttachments.filter((a) => !keptIds.has(a.id))

      // 删除被移除的附件文件
      const uploadsDir = path.join(process.cwd(), 'uploads')
      for (const att of removed) {
        const filePath = path.join(uploadsDir, path.basename(att.path))
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }

      // 删除被移除的记录，关联保留的
      if (removed.length > 0) {
        await prisma.recordAttachment.deleteMany({
          where: { id: { in: removed.map((a) => a.id) } },
        })
      }
      if (parsed.data.attachmentIds.length > 0) {
        await prisma.recordAttachment.updateMany({
          where: { id: { in: parsed.data.attachmentIds } },
          data: { recordId: id },
        })
      }
    }

    const record = await prisma.record.update({
      where: { id },
      data: updateData,
      include: {
        account: { select: { id: true, name: true, type: true } },
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true } },
        recordAttachments: { select: { id: true, path: true, originalFilename: true } },
      },
    })

    // 刷新所有相关账户余额
    const affectedAccounts = [
      existing.accountId, existing.fromAccountId, existing.toAccountId,
      record.accountId, record.fromAccountId, record.toAccountId,
    ].filter(Boolean) as string[]
    for (const accId of [...new Set(affectedAccounts)]) {
      await refreshAccountBalance(accId)
    }

    return {
      ...record,
      tags: JSON.parse(record.tags),
      attachments: record.recordAttachments.map((a) => ({ id: a.id, url: a.path, originalFilename: a.originalFilename })),
      ownerName: record.owner.name || record.owner.email,
    }
  })

  // 删除
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req as any).user.id as string

    const existing = await prisma.record.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    try {
      await assertIsMember(existing.accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 删除关联的附件文件
    const attachments = await prisma.recordAttachment.findMany({ where: { recordId: id } })
    const uploadsDir = path.join(process.cwd(), 'uploads')
    for (const att of attachments) {
      const filePath = path.join(uploadsDir, path.basename(att.path))
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    await prisma.record.delete({ where: { id } })
    // Cascade 删除会清理 RecordAttachment DB 记录

    // 刷新相关账户余额
    const affectedAccounts = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[]
    for (const accId of [...new Set(affectedAccounts)]) {
      await refreshAccountBalance(accId)
    }

    return { success: true }
  })

  // 复制记录
  app.post('/:id/clone', async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req as any).user.id as string

    const existing = await prisma.record.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ message: '记录不存在' })

    try {
      await assertIsMember(existing.accountBookId, userId)
    } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const cloned = await prisma.record.create({
      data: {
        accountBookId: existing.accountBookId,
        type: existing.type,
        amount: existing.amount,
        date: existing.date,
        remark: existing.remark,
        tags: existing.tags,
        accountId: existing.accountId,
        fromAccountId: existing.fromAccountId,
        toAccountId: existing.toAccountId,
        categoryCode: existing.categoryCode,
        payer: existing.payer,
        ownerId: userId,
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true } },
        recordAttachments: { select: { id: true, path: true, originalFilename: true } },
      },
    })

    const affectedAccounts = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[]
    for (const accId of [...new Set(affectedAccounts)]) {
      await refreshAccountBalance(accId)
    }

    return {
      ...cloned,
      tags: JSON.parse(cloned.tags),
      attachments: cloned.recordAttachments.map((a) => ({ id: a.id, url: a.path, originalFilename: a.originalFilename })),
      ownerName: cloned.owner.name || cloned.owner.email,
    }
  })

  // 附件上传
  app.post('/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '未上传文件' })

    const ext = path.extname(data.filename)
    const filename = `${randomUUID()}${ext}`
    const uploadsDir = path.join(process.cwd(), 'uploads')
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
    const filePath = path.join(uploadsDir, filename)

    // 使用 toBuffer() 可靠读取整个文件
    const buffer = await data.toBuffer()
    await fs.promises.writeFile(filePath, buffer)

    const url = `/api/uploads/${filename}`
    // 持久化原文件名
    const attachment = await prisma.recordAttachment.create({
      data: { path: url, originalFilename: data.filename },
    })

    const origin = (req.headers.origin || 'http://localhost:3002').replace(/\/$/, '')
    return { id: attachment.id, url, fullUrl: `${origin}${url}`, originalFilename: data.filename }
  })

  // 附件下载（支持还原原始文件名）
  app.get('/download', async (req, reply) => {
    const { path: filePath, name } = req.query as { path: string; name?: string }
    if (!filePath) return reply.status(400).send({ message: '缺少 path 参数' })

    const uploadsDir = path.join(process.cwd(), 'uploads')
    const safeFilename = path.basename(filePath) // 防路径遍历
    const absolutePath = path.join(uploadsDir, safeFilename)
    if (!fs.existsSync(absolutePath)) return reply.status(404).send({ message: '文件不存在' })

    // 从数据库查找原文件名
    const storedPath = `/api/uploads/${safeFilename}`
    const attachment = await prisma.recordAttachment.findFirst({
      where: { path: storedPath },
    })

    const buffer = await fs.promises.readFile(absolutePath)
    const filename = attachment?.originalFilename || name || path.basename(filePath)
    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return reply.send(buffer)
  })

}