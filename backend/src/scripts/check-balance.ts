/**
 * 对账脚本:核对「流水逐笔累加」与「账户余额」是否一致。
 *
 * 用法:
 *   cd backend && npx tsx src/scripts/check-balance.ts
 *   # 对其它库:DATABASE_URL="file:/abs/path/dev.db" npx tsx src/scripts/check-balance.ts
 *
 * 只读,不改数据。输出:
 *   1) 每个账户的 期初/收入/支出/转入/转出/应有余额/系统余额,不一致的高亮
 *   2) 转账缺转入账户的记录(会导致目标账户余额偏低)
 *   3) 账本层面守恒:Σ各账户余额 = Σ期初 + Σ(收入 − 支出)
 */
import { rawPrisma as prisma } from '../lib/prisma.js'
import { computeBalanceValue, recordDeltaForAccount, roundMoney, sumsForAccount, type BalanceRecordLike } from '../services/balance.js'
import { computeAccountBalance } from '../services/account.js'
import { dayStartOf } from '../lib/date-time.js'

const books = await prisma.accountBook.findMany({ select: { id: true, name: true } })
let problems = 0

for (const book of books) {
  const accounts = await prisma.account.findMany({
    // rawPrisma 不过滤软删除,这里手动排除:已删账户的流水不再参与余额
    where: { accountBookId: book.id, deletedAt: null },
    select: { id: true, name: true, initialBalance: true, balance: true },
    orderBy: { createdAt: 'asc' },
  })
  if (accounts.length === 0) continue

  const records = await prisma.record.findMany({
    where: { accountBookId: book.id },
    select: { type: true, amount: true, accountId: true, fromAccountId: true, toAccountId: true, date: true, remark: true },
  })
  const adjustments = await prisma.balanceAdjustment.findMany({
    where: { account: { accountBookId: book.id } },
    select: { accountId: true, balanceAfter: true, date: true },
    orderBy: { date: 'asc' },
  })

  console.log(`\n=== 账本「${book.name}」 流水 ${records.length} 条 / 账户 ${accounts.length} 个 ===`)

  let expectedTotal = 0
  let actualTotal = 0

  for (const acc of accounts) {
    const latestAdj = [...adjustments].reverse().find(a => a.accountId === acc.id)
    const base = latestAdj?.balanceAfter ?? acc.initialBalance ?? 0
    // 调整日之后的流水才叠加(与 computeBalance 同口径:从调整日 0 点开始算)
    const since = latestAdj?.date ? dayStartOf(latestAdj.date) : null
    const scoped = since ? records.filter(r => r.date > since) : records

    const sums = sumsForAccount(scoped as BalanceRecordLike[], acc.id)
    const expected = computeBalanceValue(base, sums)
    // 「系统余额」必须取实时计算值:账户表上的 balance 只是缓存,可能长期未刷新
    const actual = roundMoney(await computeAccountBalance(acc.id))
    expectedTotal += expected
    actualTotal += actual

    const ok = Math.abs(expected - actual) < 0.005
    if (!ok) problems++

    // 独立校验:逐笔净额累加 vs 四项汇总。两条代码路径对不上 = 汇总漏项
    // (余额曲线曾把同账户转账的「转入」漏掉,就是这一层才能抓出来)
    const viaRecord = roundMoney(scoped.reduce((s, r) => s + recordDeltaForAccount(r as BalanceRecordLike, acc.id), 0))
    const viaSums = roundMoney(sums.income - sums.expense + sums.transferIn - sums.transferOut)
    if (Math.abs(viaRecord - viaSums) > 0.005) {
      problems++
      console.log(`❌ ${acc.name} 汇总与逐笔不一致:逐笔 ${viaRecord} / 汇总 ${viaSums}`)
    }

    console.log(
      `${ok ? '✅' : '❌'} ${acc.name.padEnd(24)} 收入 ${sums.income.toFixed(2).padStart(9)}`
      + ` 支出 ${sums.expense.toFixed(2).padStart(9)}`
      + ` 转入 ${sums.transferIn.toFixed(2).padStart(9)}`
      + ` 转出 ${sums.transferOut.toFixed(2).padStart(9)}`
      + ` | 应有 ${expected.toFixed(2).padStart(10)} 系统 ${actual.toFixed(2).padStart(10)}`,
    )
  }

  const diff = roundMoney(expectedTotal - actualTotal)
  const totalOk = Math.abs(diff) < 0.005
  if (!totalOk) problems++
  console.log(`${totalOk ? '✅' : '❌'} 合计:应有 ${expectedTotal.toFixed(2)} / 系统 ${actualTotal.toFixed(2)} / 差 ${diff.toFixed(2)}`)

  const brokenTransfers = records.filter((r: any) => r.type === 'TRANSFER' && !r.toAccountId)
  if (brokenTransfers.length > 0) {
    problems++
    console.log(`⚠️  转账缺转入账户 ${brokenTransfers.length} 条(目标账户余额会偏低):`)
    for (const r of brokenTransfers.slice(0, 10)) {
      const from = accounts.find(a => a.id === (r as any).accountId)?.name ?? '?'
      console.log(`   ${(r as any).date.toISOString().slice(0, 10)} ${String((r as any).amount).padStart(9)} ${from} → (空) | ${((r as any).remark ?? '').slice(0, 30)}`)
    }
  }
}

console.log(`\n${problems === 0 ? '✅ 全部一致' : `❌ 发现 ${problems} 处问题`}`)
await prisma.$disconnect()
process.exitCode = problems === 0 ? 0 : 1
