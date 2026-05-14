import type { FastifyInstance } from 'fastify'
import { authService } from '../services/auth.js'
import { registerSchema, loginSchema } from '../schemas/auth.js'

export async function authRoutes(app: FastifyInstance) {
  // 注册
  app.post('/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid request body' })
    }

    const { email, password, name } = parsed.data
    const user = await authService.register(email, password, name)

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    }
  })

  // 登录
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid request body' })
    }

    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return reply.status(401).send({ message: 'Invalid credentials' })
    }

    const valid = await authService.validatePassword(password, user.password)
    if (!valid) {
      return reply.status(401).send({ message: 'Invalid credentials' })
    }

    const token = app.jwt.sign({ id: user.id, email: user.email })

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    }
  })

  // 获取当前用户
  app.get('/me', async (req, reply) => {
    const user = (req as any).user
    if (!user) {
      return reply.status(401).send({ message: 'Unauthorized' })
    }

    const fullUser = await authService.getUserById(user.id)
    return fullUser
  })
}

// 导入 prisma 用于路由中查询用户
import { prisma } from '../app.js'