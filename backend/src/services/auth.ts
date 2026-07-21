import bcrypt from 'bcryptjs'
import { prisma } from '../app.js'

export class AuthService {
  // 注册
  async register(username: string, email: string, password: string, nickname?: string) {
    // 检查邮箱是否已存在
    const existingEmail = await prisma.user.findFirst({ where: { email } })
    if (existingEmail) {
      throw Object.assign(new Error('电子邮件已存在'), { statusCode: 400 })
    }

    // 检查用户名是否已存在
    const existingUsername = await prisma.user.findFirst({ where: { username } })
    if (existingUsername) {
      throw Object.assign(new Error('账号已存在'), { statusCode: 400 })
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10)

    // 首个注册用户自动成为管理员
    const userCount = await prisma.user.count()
    const role = userCount === 0 ? 'ADMIN' : 'USER'

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        nickname,
        role,
        status: 'ACTIVE',
      },
    })

    // 为新用户创建默认账本
    await prisma.accountBook.create({
      data: {
        name: '我的账本',
        ownerId: user.id,
        members: {
          create: { userId: user.id },
        },
      },
    })

    return user
  }

  // 验证密码
  async validatePassword(password: string, hashedPassword: string) {
    return bcrypt.compare(password, hashedPassword)
  }

  // 获取用户
  async getUserById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, nickname: true, role: true, status: true, theme: true },
    })
  }
}

export const authService = new AuthService()
