import type {FastifyInstance} from 'fastify'
import {prisma} from '../app.js'
import {authenticate, assertIsMember} from '../middleware/auth.js'
import {
    createRecordSchema,
    updateRecordSchema,
    listRecordsSchema,
    calendarQuerySchema,
    categorySummarySchema,
    monthlyTrendSchema,
    categoryTrendSchema,
    groupSummarySchema
} from '../schemas/record.js'
import {z} from 'zod'
import {zSchema} from '../lib/schema-helpers.js'
import path from 'path'
import fs from 'fs'
import {randomUUID} from 'crypto'
import {buildRecordWhere, formatRecord, computeBalance, refreshAccountBalance} from '../services/record.js'

const RECORD_INCLUDE = {
    account: {select: {id: true, name: true, type: true}},
    fromAccount: {select: {id: true, name: true}},
    toAccount: {select: {id: true, name: true}},
    owner: {select: {id: true, nickname: true, username: true, email: true}},
    recordAttachments: {select: {id: true, path: true, originalFilename: true}},
} as const

export async function recordRoutes(app: FastifyInstance) {
    app.addHook('onRequest', authenticate)

    // 列表查询（分页 + 筛选）
    app.get('/', {
        schema: {
            description: '分页查询记录列表，支持多条件筛选',
            tags: ['记录'],
            querystring: zSchema(listRecordsSchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'object',
                    description: '分页记录列表',
                    properties: {
                        records: {type: 'array', description: '记录列表', items: {type: 'object'}},
                        total: {type: 'number', description: '总记录数'},
                        page: {type: 'number', description: '当前页码'},
                        pageSize: {type: 'number', description: '每页条数'},
                        totalPages: {type: 'number', description: '总页数'}
                    }
                }
            },
        },
    }, async (req, reply) => {
        const parsed = listRecordsSchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, page, pageSize, ...filter} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const where = buildRecordWhere(bookId, filter)

        const [records, total] = await Promise.all([
            prisma.record.findMany({
                where,
                include: RECORD_INCLUDE,
                orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.record.count({where}),
        ])

        return {
            records: records.map(formatRecord),
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        }
    })

    // 汇总统计（与列表查询共用相同的筛选条件）
    app.get('/summary', {
        schema: {
            description: '记录汇总统计（收入/支出/转账/净收入）',
            tags: ['记录'],
            querystring: zSchema(listRecordsSchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'object',
                    description: '收支汇总',
                    properties: {
                        income: { type: 'number', description: '总收入' },
                        expense: { type: 'number', description: '总支出' },
                        transfer: { type: 'number', description: '总转账金额' },
                        netIncome: { type: 'number', description: '净收入（收入-支出）' },
                    },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = listRecordsSchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, type, ...filter} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const typeFilter: string[] | null = type
            ? type.split(',').map((s: string) => s.trim()).filter(Boolean)
            : null

        const where = buildRecordWhere(bookId, filter)
        const shouldAgg = (recordType: string) => !typeFilter || typeFilter.includes(recordType)

        const [income, expense, transfer] = await Promise.all([
            shouldAgg('INCOME')
                ? prisma.record.aggregate({
                    where: {...where, type: 'INCOME'},
                    _sum: {amount: true}
                }).then(r => r._sum.amount ?? 0)
                : Promise.resolve(0),
            shouldAgg('EXPENSE')
                ? prisma.record.aggregate({
                    where: {...where, type: 'EXPENSE'},
                    _sum: {amount: true}
                }).then(r => r._sum.amount ?? 0)
                : Promise.resolve(0),
            shouldAgg('TRANSFER')
                ? prisma.record.aggregate({
                    where: {...where, type: 'TRANSFER'},
                    _sum: {amount: true}
                }).then(r => r._sum.amount ?? 0)
                : Promise.resolve(0),
        ])

        return {income, expense, transfer, netIncome: income - expense}
    })

    // 获取记录标签列表（用于筛选器下拉）
    app.get('/tags', {
        schema: {
            description: '获取账本下所有记录的标签',
            tags: ['记录'],
            querystring: zSchema(z.object({bookId: z.string()})),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'array',
                    description: '标签列表',
                    items: { type: 'string' },
                },
            },
        },
    }, async (req, reply) => {
        const {bookId} = req.query as { bookId?: string }
        if (!bookId) return reply.status(400).send({message: '缺少 bookId 参数'})

        const userId = (req as any).user.id as string
        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const records = await prisma.record.findMany({
            where: {accountBookId: bookId},
            select: {tags: true},
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
            } catch { /* skip malformed */
            }
        }

        return Array.from(tagSet).sort()
    })

    // 日历聚合：按天汇总当月收支
    app.get('/calendar', {
        schema: {
            description: '获取月视图每日汇总',
            tags: ['记录'],
            querystring: zSchema(calendarQuerySchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'array',
                    description: '每日汇总列表',
                    items: {
                        type: 'object',
                        properties: {
                            date: { type: 'string', description: '日期 (YYYY-MM-DD)' },
                            income: { type: 'number', description: '当日收入' },
                            expense: { type: 'number', description: '当日支出' },
                            transfer: { type: 'number', description: '当日转账金额' },
                            count: { type: 'number', description: '当日记录数量' },
                        },
                    },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = calendarQuerySchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, year, month} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const start = new Date(Date.UTC(year, month - 1, 1))
        const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

        const records = await prisma.record.findMany({
            where: {accountBookId: bookId, date: {gte: start, lte: end}},
            select: {type: true, amount: true, date: true},
        })

        const dayMap: Record<string, { income: number; expense: number; transfer: number; count: number }> = {}
        for (const r of records) {
            const day = r.date.toISOString().slice(0, 10)
            if (!dayMap[day]) dayMap[day] = {income: 0, expense: 0, transfer: 0, count: 0}
            dayMap[day].count++
            if (r.type === 'INCOME') dayMap[day].income += r.amount
            else if (r.type === 'EXPENSE') dayMap[day].expense += r.amount
            else if (r.type === 'TRANSFER') dayMap[day].transfer += r.amount
        }

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

    // 分类汇总：按分类统计金额，用于饼图
    app.get('/category-summary', {
        schema: {
            description: '分类汇总（饼图数据）',
            tags: ['记录'],
            querystring: zSchema(categorySummarySchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'array',
                    description: '分类汇总列表',
                    items: {
                        type: 'object',
                        properties: {
                            categoryCode: { type: ['string', 'null'], description: '分类编码' },
                            categoryName: { type: 'string', description: '分类名称' },
                            amount: { type: 'number', description: '金额' },
                            type: { type: 'string', description: '类型' },
                        },
                    },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = categorySummarySchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, type, ...filter} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const typeFilter: string[] | null = type
            ? type.split(',').map((s: string) => s.trim()).filter(Boolean)
            : null

        const where = buildRecordWhere(bookId, filter)
        if (typeFilter) {
            if (typeFilter.length === 1) (where as any).type = typeFilter[0]
            else (where as any).type = {in: typeFilter}
        }

        const records = await prisma.record.findMany({
            where,
            select: {amount: true, categoryCode: true, type: true},
        })

        const categoryMap: Record<string, { amount: number; type: string }> = {}
        for (const r of records) {
            const key = r.categoryCode || '__uncategorized__'
            if (!categoryMap[key]) categoryMap[key] = {amount: 0, type: r.type}
            categoryMap[key].amount += r.amount
        }

        const allCodes = Object.keys(categoryMap).filter((k) => k !== '__uncategorized__')
        const dictionaries = allCodes.length > 0
            ? await prisma.dictionary.findMany({
                where: {code: {in: allCodes}},
                select: {code: true, label: true},
            })
            : []

        const codeLabelMap: Record<string, string> = {}
        for (const d of dictionaries) {
            if (!codeLabelMap[d.code]) codeLabelMap[d.code] = d.label
        }

        return Object.entries(categoryMap).map(([code, data]) => ({
            categoryCode: code === '__uncategorized__' ? null : code,
            categoryName: code === '__uncategorized__' ? '未分类' : (codeLabelMap[code] || code),
            amount: data.amount,
            type: data.type,
        }))
    })

    // 月度趋势：按月份汇总收支
    app.get('/monthly-trend', {
        schema: {
            description: '月度收支趋势',
            tags: ['记录'],
            querystring: zSchema(monthlyTrendSchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'array',
                    description: '月度趋势数据列表',
                    items: {
                        type: 'object',
                        properties: {
                            month: { type: 'string', description: '月份 (YYYY-MM)' },
                            income: { type: 'number', description: '当月收入' },
                            expense: { type: 'number', description: '当月支出' },
                        },
                    },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = monthlyTrendSchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, dateFrom, dateTo, ...filter} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const where = buildRecordWhere(bookId, {...filter, dateFrom, dateTo})
        ;(where as any).type = {in: ['INCOME', 'EXPENSE']}

        const records = await prisma.record.findMany({
            where,
            select: {amount: true, type: true, date: true},
            orderBy: {date: 'asc'},
        })

        const monthMap: Record<string, { income: number; expense: number }> = {}
        for (const r of records) {
            const month = r.date.toISOString().slice(0, 7)
            if (!monthMap[month]) monthMap[month] = {income: 0, expense: 0}
            if (r.type === 'INCOME') monthMap[month].income += r.amount
            else if (r.type === 'EXPENSE') monthMap[month].expense += r.amount
        }

        if (dateFrom && dateTo) {
            const start = new Date(dateFrom)
            const end = new Date(dateTo)
            const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
            while (cursor <= end) {
                const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
                if (!monthMap[month]) monthMap[month] = {income: 0, expense: 0}
                cursor.setMonth(cursor.getMonth() + 1)
            }
        }

        return Object.entries(monthMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, data]) => ({month, ...data}))
    })

    // 分类趋势：按时间周期 + 分类维度聚合，用于堆叠柱状图
    app.get('/category-trend', {
        schema: {
            description: '分类趋势（按时间维度）',
            tags: ['记录'],
            querystring: zSchema(categoryTrendSchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'object',
                    description: '分类趋势数据',
                    properties: {
                        periods: { type: 'array', description: '时间周期列表', items: { type: 'string' } },
                        categories: {
                            type: 'array',
                            description: '分类数据列表',
                            items: {
                                type: 'object',
                                properties: {
                                    code: { type: ['string', 'null'], description: '分类编码' },
                                    name: { type: 'string', description: '分类名称' },
                                    data: { type: 'array', description: '各时间周期的金额', items: { type: 'number' } },
                                },
                            },
                        },
                    },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = categoryTrendSchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, type, granularity, year, month, dateFrom, dateTo, ...filter} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const typeFilter = type.split(',').map((s: string) => s.trim()).filter(Boolean)
        const where = buildRecordWhere(bookId, {...filter, dateFrom, dateTo})
        ;(where as any).type = typeFilter.length === 1 ? typeFilter[0] : {in: typeFilter}

        if (!dateFrom && !dateTo) {
            if (granularity === 'monthly' && year) {
                (where as any).date = {
                    gte: new Date(Date.UTC(year, 0, 1)),
                    lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
                }
            } else if (month && year) {
                (where as any).date = {
                    gte: new Date(Date.UTC(year, month - 1, 1)),
                    lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
                }
            }
        }

        const records = await prisma.record.findMany({
            where,
            select: {amount: true, categoryCode: true, date: true},
            orderBy: {date: 'asc'},
        })

        const periodKey = granularity === 'monthly'
            ? (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            : (d: Date) => d.toISOString().slice(0, 10)

        const periodMap: Record<string, Record<string, number>> = {}
        const allCategories = new Set<string>()

        for (const r of records) {
            const period = periodKey(new Date(r.date))
            const cat = r.categoryCode || '__uncategorized__'
            allCategories.add(cat)
            if (!periodMap[period]) periodMap[period] = {}
            periodMap[period][cat] = (periodMap[period][cat] || 0) + r.amount
        }

        const catCodes = Array.from(allCategories).filter((c) => c !== '__uncategorized__')
        const dictionaries = catCodes.length > 0
            ? await prisma.dictionary.findMany({where: {code: {in: catCodes}}, select: {code: true, label: true}})
            : []
        const labelMap: Record<string, string> = {}
        for (const d of dictionaries) labelMap[d.code] = d.label

        const periods: string[] = []
        if (dateFrom || dateTo) {
            const keys = Object.keys(periodMap).sort()
            periods.push(...keys)
        } else if (granularity === 'monthly' && year) {
            for (let m = 0; m < 12; m++) {
                periods.push(`${year}-${String(m + 1).padStart(2, '0')}`)
            }
        } else if (month && year) {
            const daysInMonth = new Date(year, month, 0).getDate()
            for (let d = 1; d <= daysInMonth; d++) {
                periods.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
            }
        } else {
            periods.push(...Object.keys(periodMap).sort())
        }

        const catList = Array.from(allCategories).sort()

        return {
            periods,
            categories: catList.map((code) => ({
                code: code === '__uncategorized__' ? null : code,
                name: code === '__uncategorized__' ? '未分类' : (labelMap[code] || code),
                data: periods.map((p) => periodMap[p]?.[code] || 0),
            })),
        }
    })

    // 分组汇总：按指定维度聚合
    app.get('/group-summary', {
        schema: {
            description: '按维度分组汇总',
            tags: ['记录'],
            querystring: zSchema(groupSummarySchema),
        },
        config: {
            swaggerResponse: {
                200: {
                    type: 'array',
                    description: '分组汇总列表',
                    items: {
                        type: 'object',
                        properties: {
                            key: { type: 'string', description: '分组键' },
                            label: { type: 'string', description: '分组标签' },
                            amount: { type: 'number', description: '分组金额' },
                        },
                    },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = groupSummarySchema.safeParse(req.query)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const {bookId, type, groupBy, ...filter} = parsed.data
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const where = buildRecordWhere(bookId, filter)
        ;(where as any).type = type

        const records = await prisma.record.findMany({
            where,
            select: {amount: true, categoryCode: true, ownerId: true, accountId: true},
        })

        const groupMap: Record<string, number> = {}
        for (const r of records) {
            let key: string
            if (groupBy === 'category') {
                key = r.categoryCode || '__uncategorized__'
            } else if (groupBy === 'ownerId') {
                key = r.ownerId
            } else {
                key = r.accountId
            }
            groupMap[key] = (groupMap[key] || 0) + r.amount
        }

        const keys = Object.keys(groupMap)
        let labelMap: Record<string, string> = {}

        if (groupBy === 'category') {
            const catCodes = keys.filter((k) => k !== '__uncategorized__')
            if (catCodes.length > 0) {
                const dicts = await prisma.dictionary.findMany({
                    where: {code: {in: catCodes}},
                    select: {code: true, label: true},
                })
                for (const d of dicts) labelMap[d.code] = d.label
            }
            labelMap['__uncategorized__'] = '未分类'
        } else if (groupBy === 'ownerId') {
            const users = await prisma.user.findMany({
                where: {id: {in: keys}},
                select: {id: true, nickname: true, email: true},
            })
            for (const u of users) labelMap[u.id] = u.nickname || u.email || u.id
        } else {
            const accts = await prisma.account.findMany({
                where: {id: {in: keys}},
                select: {id: true, name: true},
            })
            for (const a of accts) labelMap[a.id] = a.name
        }

        return Object.entries(groupMap).map(([key, amount]) => ({
            key,
            label: labelMap[key] || key,
            amount,
        }))
    })

    // 创建流水
    app.post('/', {
        schema: {
            description: '创建记录，自动刷新账户余额',
            tags: ['记录'],
            body: zSchema(createRecordSchema),
        },
    }, async (req, reply) => {
        const parsed = createRecordSchema.safeParse(req.body)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const userId = (req as any).user.id as string
        const data = parsed.data

        try {
            await assertIsMember(data.accountBookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        if (data.type === 'TRANSFER') {
            if (!data.fromAccountId || !data.toAccountId) {
                return reply.status(400).send({message: '转账记录需要填写源账户和目标账户'})
            }
        }

        if (data.type === 'EXPENSE') {
            const account = await prisma.account.findUnique({where: {id: data.accountId}})
            if (account?.type === 'CREDIT_CARD') {
                const {balance} = await computeBalance(data.accountId)
                if (balance - data.amount < -account.initialBalance) {
                    return reply.status(400).send({message: '信用卡余额不能超限'})
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
                    connect: (data.attachmentIds ?? []).map((id: string) => ({id})),
                },
                accountId: data.accountId,
                fromAccountId: data.fromAccountId,
                toAccountId: data.toAccountId,
                categoryCode: data.categoryCode,
                payer: data.payer,
                ownerId: data.ownerId || userId,
            },
            include: RECORD_INCLUDE,
        })

        const affectedAccounts = [data.accountId, data.fromAccountId, data.toAccountId].filter(Boolean) as string[]
        for (const accId of [...new Set(affectedAccounts)]) {
            await refreshAccountBalance(accId)
        }

        return formatRecord(record)
    })

    // 批量更新
    app.patch('/batch', {
        schema: {
            description: '批量更新记录',
            tags: ['记录'],
            body: zSchema(z.object({ids: z.array(z.string()).min(1), data: z.object({}).passthrough()})),
        },
    }, async (req, reply) => {
        const {ids, data} = req.body as { ids: string[]; data: Record<string, any> }
        if (!ids?.length) return reply.status(400).send({message: '请选择要更新的记录'})

        const userId = (req as any).user.id as string

        const records = await prisma.record.findMany({
            where: {id: {in: ids}},
            select: {accountBookId: true},
        })
        if (records.length === 0) return reply.status(404).send({message: '记录不存在'})

        const bookIds = new Set(records.map(r => r.accountBookId))
        for (const bookId of bookIds) {
            try {
                await assertIsMember(bookId, userId)
            } catch (e: any) {
                return reply.status(e.statusCode || 403).send({message: e.message})
            }
        }

        const parsed = updateRecordSchema.safeParse(data)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }

        const updateData: any = {...parsed.data}
        delete updateData.attachmentIds
        if (updateData.tags) updateData.tags = JSON.stringify(updateData.tags)
        if (updateData.date) updateData.date = new Date(updateData.date)

        await prisma.record.updateMany({
            where: {id: {in: ids}},
            data: updateData,
        })

        return {success: true, updated: ids.length}
    })

    // 检测重复记录
    app.post('/detect-duplicates', {
        schema: {
            description: '检测重复流水记录，按可配置字段分组',
            tags: ['记录'],
            body: zSchema(z.object({
                bookId: z.string().min(1),
                matchFields: z.object({
                    date: z.enum(['exact', 'date']).nullable(),
                    type: z.boolean(),
                    accountId: z.boolean(),
                    payer: z.boolean(),
                    amount: z.boolean(),
                }),
            })),
        },
    }, async (req, reply) => {
        const {bookId, matchFields} = req.body as {
            bookId: string
            matchFields: {
                date: 'exact' | 'date' | null;
                type: boolean;
                accountId: boolean;
                payer: boolean;
                amount: boolean
            }
        }
        const userId = (req as any).user.id as string

        try {
            await assertIsMember(bookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const records = await prisma.record.findMany({
            where: {accountBookId: bookId},
            include: RECORD_INCLUDE,
            orderBy: {date: 'asc'},
        })

        const groups = new Map<string, typeof records>()

        for (const r of records) {
            const parts: string[] = []

            if (matchFields.date === 'exact') {
                parts.push(r.date.toISOString())
            } else if (matchFields.date === 'date') {
                parts.push(r.date.toISOString().slice(0, 10))
            }

            if (matchFields.type) parts.push(r.type)
            if (matchFields.accountId) parts.push(r.accountId)
            if (matchFields.payer) parts.push(r.payer || '__empty__')
            if (matchFields.amount) parts.push(r.amount.toFixed(2))

            const key = parts.join('||')
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key)!.push(r)
        }

        const duplicateGroups = Array.from(groups.entries())
            .filter(([, recs]) => recs.length > 1)
            .map(([key, recs]) => ({
                key,
                count: recs.length,
                records: recs.map(formatRecord),
            }))
            .sort((a, b) => b.count - a.count)

        const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0)

        return {groups: duplicateGroups, totalDuplicates}
    })

    // 批量删除
    app.post('/batch-delete', {
        schema: {
            description: '批量删除记录',
            tags: ['记录'],
            body: zSchema(z.object({ids: z.array(z.string()).min(1)})),
        },
    }, async (req, reply) => {
        const {ids} = req.body as { ids: string[] }
        if (!ids?.length) return reply.status(400).send({message: '请选择要删除的记录'})

        const userId = (req as any).user.id as string

        const records = await prisma.record.findMany({
            where: {id: {in: ids}},
            include: {recordAttachments: true},
        })

        if (records.length === 0) return reply.status(404).send({message: '记录不存在'})

        const bookIds = new Set(records.map(r => r.accountBookId))
        for (const bookId of bookIds) {
            try {
                await assertIsMember(bookId, userId)
            } catch (e: any) {
                return reply.status(e.statusCode || 403).send({message: e.message})
            }
        }

        const uploadsDir = path.join(process.cwd(), 'uploads')
        for (const r of records) {
            for (const att of r.recordAttachments) {
                const filePath = path.join(uploadsDir, path.basename(att.path))
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            }
        }

        await prisma.record.deleteMany({where: {id: {in: ids}}})

        const affectedAccounts = new Set<string>()
        for (const r of records) {
            affectedAccounts.add(r.accountId)
            if (r.fromAccountId) affectedAccounts.add(r.fromAccountId)
            if (r.toAccountId) affectedAccounts.add(r.toAccountId)
        }
        for (const accId of affectedAccounts) {
            await refreshAccountBalance(accId)
        }

        return {success: true, deleted: records.length}
    })

    // 更新单条
    app.patch('/:id', {
        schema: {
            description: '更新单条记录',
            tags: ['记录'],
            body: zSchema(updateRecordSchema),
            params: zSchema(z.object({id: z.string()})),
        },
    }, async (req, reply) => {
        const {id} = req.params as { id: string }
        const parsed = updateRecordSchema.safeParse(req.body)
        if (!parsed.success) {
            return reply.status(400).send({message: parsed.error.issues[0].message})
        }
        const userId = (req as any).user.id as string

        const existing = await prisma.record.findUnique({where: {id}})
        if (!existing) return reply.status(404).send({message: '记录不存在'})

        try {
            await assertIsMember(existing.accountBookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const updateData: any = {...parsed.data}
        delete updateData.attachmentIds
        if (parsed.data.tags) updateData.tags = JSON.stringify(parsed.data.tags)
        if (parsed.data.date) updateData.date = new Date(parsed.data.date)

        if (parsed.data.attachmentIds !== undefined) {
            const keptIds = new Set(parsed.data.attachmentIds)
            const oldAttachments = await prisma.recordAttachment.findMany({where: {recordId: id}})
            const removed = oldAttachments.filter((a) => !keptIds.has(a.id))

            const uploadsDir = path.join(process.cwd(), 'uploads')
            for (const att of removed) {
                const filePath = path.join(uploadsDir, path.basename(att.path))
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            }

            if (removed.length > 0) {
                await prisma.recordAttachment.deleteMany({
                    where: {id: {in: removed.map((a) => a.id)}},
                })
            }
            if (parsed.data.attachmentIds.length > 0) {
                await prisma.recordAttachment.updateMany({
                    where: {id: {in: parsed.data.attachmentIds}},
                    data: {recordId: id},
                })
            }
        }

        const record = await prisma.record.update({
            where: {id},
            data: updateData,
            include: RECORD_INCLUDE,
        })

        const affectedAccounts = [
            existing.accountId, existing.fromAccountId, existing.toAccountId,
            record.accountId, record.fromAccountId, record.toAccountId,
        ].filter(Boolean) as string[]
        for (const accId of [...new Set(affectedAccounts)]) {
            await refreshAccountBalance(accId)
        }

        return formatRecord(record)
    })

    // 删除
    app.delete('/:id', {
        schema: {
            description: '删除记录及附件',
            tags: ['记录'],
            params: zSchema(z.object({id: z.string()})),
        },
    }, async (req, reply) => {
        const {id} = req.params as { id: string }
        const userId = (req as any).user.id as string

        const existing = await prisma.record.findUnique({where: {id}})
        if (!existing) return reply.status(404).send({message: '记录不存在'})

        try {
            await assertIsMember(existing.accountBookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
        }

        const attachments = await prisma.recordAttachment.findMany({where: {recordId: id}})
        const uploadsDir = path.join(process.cwd(), 'uploads')
        for (const att of attachments) {
            const filePath = path.join(uploadsDir, path.basename(att.path))
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        }

        await prisma.record.delete({where: {id}})

        const affectedAccounts = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[]
        for (const accId of [...new Set(affectedAccounts)]) {
            await refreshAccountBalance(accId)
        }

        return {success: true}
    })

    // 复制记录
    app.post('/:id/clone', {
        schema: {
            description: '克隆记录',
            tags: ['记录'],
            params: zSchema(z.object({id: z.string()})),
        },
    }, async (req, reply) => {
        const {id} = req.params as { id: string }
        const userId = (req as any).user.id as string

        const existing = await prisma.record.findUnique({where: {id}})
        if (!existing) return reply.status(404).send({message: '记录不存在'})

        try {
            await assertIsMember(existing.accountBookId, userId)
        } catch (e: any) {
            return reply.status(e.statusCode || 403).send({message: e.message})
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
            include: RECORD_INCLUDE,
        })

        const affectedAccounts = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[]
        for (const accId of [...new Set(affectedAccounts)]) {
            await refreshAccountBalance(accId)
        }

        return formatRecord(cloned)
    })

    // 附件上传
    app.post('/upload', {
        schema: {
            description: '上传附件',
            tags: ['记录'],
        },
    }, async (req, reply) => {
        const data = await req.file()
        if (!data) return reply.status(400).send({message: '未上传文件'})

        const ext = path.extname(data.filename)
        const filename = `${randomUUID()}${ext}`
        const uploadsDir = path.join(process.cwd(), 'uploads')
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, {recursive: true})
        const filePath = path.join(uploadsDir, filename)

        const buffer = await data.toBuffer()
        await fs.promises.writeFile(filePath, buffer)

        const url = `/api/uploads/${filename}`
        const attachment = await prisma.recordAttachment.create({
            data: {path: url, originalFilename: data.filename},
        })

        const origin = (req.headers.origin || 'http://localhost:3002').replace(/\/$/, '')
        return {id: attachment.id, url, fullUrl: `${origin}${url}`, originalFilename: data.filename}
    })

    // 附件下载
    app.get('/download', {
        schema: {
            description: '下载附件',
            tags: ['记录'],
            querystring: zSchema(z.object({path: z.string(), name: z.string().optional()})),
        },
    }, async (req, reply) => {
        const {path: filePath, name} = req.query as { path: string; name?: string }
        if (!filePath) return reply.status(400).send({message: '缺少 path 参数'})

        const uploadsDir = path.join(process.cwd(), 'uploads')
        const safeFilename = path.basename(filePath)
        const absolutePath = path.join(uploadsDir, safeFilename)
        if (!fs.existsSync(absolutePath)) return reply.status(404).send({message: '文件不存在'})

        const storedPath = `/api/uploads/${safeFilename}`
        const attachment = await prisma.recordAttachment.findFirst({
            where: {path: storedPath},
        })

        const buffer = await fs.promises.readFile(absolutePath)
        const filename = attachment?.originalFilename || name || path.basename(filePath)
        reply.header('Content-Type', 'application/octet-stream')
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
        return reply.send(buffer)
    })
}
