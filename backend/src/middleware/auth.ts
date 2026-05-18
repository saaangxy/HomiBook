import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../app.js'

// JWT 认证中间件
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.status(401).send({ message: '未授权' })
  }
}

// 管理员权限中间件
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const payload = request.user as { id: string }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { role: true, status: true },
  })

  if (!user || user.status !== 'ACTIVE') {
    return reply.status(403).send({ message: '账户已被禁用' })
  }

  if (user.role !== 'ADMIN') {
    return reply.status(403).send({ message: '需要管理员权限' })
  }
}