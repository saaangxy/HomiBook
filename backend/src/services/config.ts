import { prisma } from '../app.js'

export async function getConfigValue(key: string): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key } })
  return config?.value ?? null
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  })
}

export async function getAllConfig(): Promise<Record<string, unknown>> {
  const configs = await prisma.systemConfig.findMany()
  const result: Record<string, unknown> = {}
  for (const c of configs) {
    try {
      result[c.key] = JSON.parse(c.value)
    } catch {
      result[c.key] = c.value
    }
  }
  return result
}

export async function isRegistrationOpen(): Promise<boolean> {
  const val = await getConfigValue('registrationOpen')
  if (val === null) return true
  return JSON.parse(val)
}