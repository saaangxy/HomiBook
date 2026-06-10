import type { FastifyRequest, FastifyReply } from 'fastify'
import { createHash } from 'crypto'
import { prisma } from '../app.js'

// JWT + API Key 认证中间件
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // 第一关：尝试 JWT 验证
  try {
    await request.jwtVerify()
    return
  } catch (_jwtErr) {
    // JWT 失败，继续尝试 API Key
  }

  // 第二关：API Key 认证
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ message: '未授权' })
  }

  const token = authHeader.slice(7)

  // JWT 以 eyJ 开头，API Key 以 homibook_ 开头，快速区分避免无效的SHA-256计算
  if (!token.startsWith('homibook_')) {
    return reply.status(401).send({ message: '未授权' })
  }

  const hash = createHash('sha256').update(token).digest('hex')

  const apiKey = await prisma.apiKey.findUnique({
    where: { hash },
    include: {
      user: { select: { id: true, email: true, role: true, status: true } },
    },
  })

  if (!apiKey || apiKey.user.status !== 'ACTIVE') {
    return reply.status(401).send({ message: '未授权' })
  }

  // 注入用户信息到 request.user（与 JWT 登录时注入的 payload 形状一致）
  ;(request as any).user = {
    id: apiKey.user.id,
    email: apiKey.user.email,
    role: apiKey.user.role,
  }

  // 异步更新最后使用时间，不阻塞请求
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
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
