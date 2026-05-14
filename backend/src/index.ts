import { buildApp } from './app.js'
import { authRoutes } from './routes/auth.js'

async function main() {
  const app = await buildApp()

  // 注册路由
  app.register(authRoutes, { prefix: '/api/auth' })

  // 健康检查
  app.get('/health', async () => ({ status: 'ok' }))

  // 启动
  try {
    await app.listen({ port: 3001, host: '0.0.0.0' })
    console.log('Server running at http://localhost:3000')
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()