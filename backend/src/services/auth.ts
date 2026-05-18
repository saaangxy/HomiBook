import bcrypt from 'bcryptjs'
import { prisma } from '../app.js'

export class AuthService {
  // 注册
  async register(email: string, password: string, name?: string) {
    // 检查邮箱是否已存在
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      throw Object.assign(new Error('电子邮件已存在'), { statusCode: 400 })
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10)

    // 首个注册用户自动成为管理员
    const userCount = await prisma.user.count()
    const role = userCount === 0 ? 'ADMIN' : 'USER'

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        status: 'ACTIVE',
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
      select: { id: true, email: true, name: true, role: true, status: true },
    })
  }
}

export const authService = new AuthService()
