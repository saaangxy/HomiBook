import { buildApp } from './app.js'
import { authRoutes } from './routes/auth.js'
import { adminRoutes } from './routes/admin.js'
import { bookRoutes } from './routes/book.js'
import { accountRoutes } from './routes/account.js'
import { recordRoutes } from './routes/record.js'
import { settingsRoutes } from './routes/settings.js'
import { holidayRoutes } from './routes/holiday.js'
import { budgetRoutes } from './routes/budget.js'
import { recurringRoutes } from './routes/recurring.js'
import { apiKeyRoutes } from './routes/apikey.js'
import { importExportRoutes } from './routes/import-export.js'
import { chatRoutes } from './routes/chat.js'
import { seedDefaults } from './seed.js'
import { startScheduler } from './services/scheduler.js'

async function main() {
  const app = await buildApp()

  // 初始化默认数据
  await seedDefaults()

  // 注册路由
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(adminRoutes, { prefix: '/api/admin' })
  app.register(bookRoutes, { prefix: '/api/books' })
  app.register(accountRoutes, { prefix: '/api/accounts' })
  app.register(recordRoutes, { prefix: '/api/records' })
  app.register(settingsRoutes, { prefix: '/api/settings' })
  app.register(holidayRoutes, { prefix: '/api/holidays' })
  app.register(budgetRoutes, { prefix: '/api/budgets' })
  app.register(recurringRoutes, { prefix: '/api/recurring' })
  app.register(apiKeyRoutes, { prefix: '/api/apikeys' })
  app.register(importExportRoutes, { prefix: '/api/records' })
  app.register(chatRoutes, { prefix: '/api/chat' })

  // 启动固定收支调度器
  startScheduler()

  // 健康检查
  app.get('/health', async () => ({ status: 'ok' }))

  // 启动
  try {
    await app.listen({ port: 3002, host: '0.0.0.0' })
    console.log('Server running at http://localhost:3002')
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()