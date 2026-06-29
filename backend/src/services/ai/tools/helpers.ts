import { prisma } from '../../../app.js'

/** 解析账户标识符（UUID 或 accountNo）为实际的数据库 ID */
export async function resolveAccountId(
  identifier: string,
  accountBookId: string,
): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      accountBookId,
      OR: [{ id: identifier }, { accountNo: identifier }],
    },
    select: { id: true },
  })
  return account?.id || null
}
