import { prisma } from '../app.js'

export async function getConfigValue(key: string): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key } })
  return config?.value ?? null
}