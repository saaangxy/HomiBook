import { buildApp } from './app.js'
import { authRoutes } from './routes/auth.js'
import { adminRoutes } from './routes/admin.js'
import { bookRoutes } from './routes/book.js'
import { accountRoutes } from './routes/account.js'

async function main() {
  const app = await buildApp()

  // 注册路由
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(adminRoutes, { prefix: '/api/admin' })
  app.register(bookRoutes, { prefix: '/api/books' })
  app.register(accountRoutes, { prefix: '/api/accounts' })

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