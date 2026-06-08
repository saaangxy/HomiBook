import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { zSchema } from '../lib/schema-helpers.js'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

export async function holidayRoutes(app: FastifyInstance) {
  // 查询指定年份节假日
  app.get('/', {
    schema: {
      tags: ['节假日'],
      summary: '查询节假日列表',
      querystring: zSchema(z.object({ year: z.coerce.number().int().optional() })),
    },
  }, async (req) => {
    const { year } = req.query as { year?: string }
    const where: any = {}
    if (year) {
      const y = parseInt(year)
      where.date = {
        gte: new Date(`${year}-01-01`),
        lte: new Date(`${year}-12-31`),
      }
    }
    return prisma.holiday.findMany({ where, orderBy: { date: 'asc' } })
  })

  // 管理员：从外部 API 同步节假日
  app.post('/sync', {
    onRequest: [authenticate, requireAdmin],
    schema: {
      tags: ['节假日'],
      summary: '同步外部节假日数据',
    },
  }, async (req, reply) => {
    // 从配置中获取 API 地址
    const config = await prisma.systemConfig.findUnique({ where: { key: 'holidayApiUrl' } })
    const apiUrl = config ? JSON.parse(config.value) : 'https://timor.tech/api/holiday/year'

    let imported = 0

    try {
      // 支持多个年份（当前年份前后各一年）
      const currentYear = new Date().getFullYear()
      const years = [currentYear - 1, currentYear, currentYear + 1]

      for (const y of years) {
        const url = apiUrl.replace('{year}', String(y))
        const response = await fetch(url)
        if (!response.ok) continue

        const data = await response.json() as any

        // 解析 timor.tech API 格式: { code: 0, holiday: { "01-01": { holiday: true, name: "元旦", ... } } }
        // 也兼容其他 API 格式
        let holidays: Array<{ date: string; name: string; isWorkday: boolean }> = []

        if (data.holiday && typeof data.holiday === 'object') {
          // timor.tech 格式
          for (const [dateKey, info] of Object.entries(data.holiday) as [string, any][]) {
            if (info && typeof info === 'object') {
              holidays.push({
                date: `${y}-${dateKey}`,
                name: info.name || '',
                isWorkday: !info.holiday, // holiday=false 表示调休工作日
              })
            }
          }
        } else if (Array.isArray(data)) {
          // 数组格式: [{ date: "2026-01-01", name: "元旦", isOffDay: true }]
          holidays = data.map((item: any) => ({
            date: item.date,
            name: item.name || item.holidayName || '',
            isWorkday: item.isWorkday ?? !(item.isOffDay ?? item.holiday ?? true),
          }))
        } else if (Array.isArray(data.data)) {
          // 嵌套格式: { data: [...] }
          holidays = data.data.map((item: any) => ({
            date: item.date,
            name: item.name || item.holidayName || '',
            isWorkday: item.isWorkday ?? !(item.isOffDay ?? item.holiday ?? true),
          }))
        }

        // 批量 upsert
        for (const h of holidays) {
          await prisma.holiday.upsert({
            where: { date: new Date(h.date) },
            create: { date: new Date(h.date), name: h.name, isWorkday: h.isWorkday },
            update: { name: h.name, isWorkday: h.isWorkday },
          })
          imported++
        }
      }

      return { imported }
    } catch (e: any) {
      return reply.status(500).send({ message: `同步失败：${e.message}` })
    }
  })
}
