import bcrypt from 'bcryptjs'
import { prisma } from '../app.js'
import { registerSchema, loginSchema } from '../schemas/auth.js'

export class AuthService {
  // 注册
  async register(email: string, password: string, name?: string) {
    // 检查邮箱是否已存在
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      throw Object.assign(new Error('Email already exists'), { statusCode: 400 })
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10)

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
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
      select: { id: true, email: true, name: true },
    })
  }
}

export const authService = new AuthService()
