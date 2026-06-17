import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import { zSchema } from '../lib/schema-helpers.js'
import { refreshAccountBalance } from './account.js'
import * as XLSX from 'xlsx'

// 支付宝体系内账户关键词 — 统一映射到"支付宝"账户，其余（银行卡等）保持原名
const ALIPAY_INTERNAL_PATTERN = /花呗|余额宝|余额|账户余额|集分宝|红包|淘金币|支付宝|他人代付/
function resolveAlipayAccountName(name: string) {
  if (!name) return '支付宝'
  if (ALIPAY_INTERNAL_PATTERN.test(name)) return '支付宝'
  return name
}

// 微信体系内账户关键词 — 零钱/零钱通统一映射到"微信"账户
const WECHAT_INTERNAL_PATTERN = /零钱|零钱通/
function resolveWechatAccountName(name: string) {
  if (!name || name === '/' || name === '\\') return '微信'
  if (WECHAT_INTERNAL_PATTERN.test(name)) return '微信'
  return name
}

// 按名称关键词推断账户类型
const NAME_TYPE_RULES: { test: (name: string) => boolean; type: string }[] = [
  { test: (n) => /微信/.test(n), type: 'WECHAT' },
  { test: (n) => /支付宝/.test(n), type: 'ALIPAY' },
  { test: (n) => /信用卡/.test(n), type: 'CREDIT_CARD' },
  { test: (n) => /储蓄卡|借记卡/.test(n), type: 'BANK_DEBIT' },
  { test: (n) => /银行/.test(n), type: 'BANK_DEBIT' },
  { test: (n) => /投资|理财|基金|股票|余额宝/.test(n), type: 'INVESTMENT' },
  { test: (n) => /现金/.test(n), type: 'CASH' },
  { test: (n) => /充值/.test(n), type: 'RECHARGE_CARD' },
]

function inferAccount(paymentMethod: string): { type: string; defaultName: string; bankName?: string; accountNo?: string } | null {
  if (!paymentMethod) return null

  // 1. 银行卡：XX银行储蓄卡(NNNN) 或 XX银行信用卡(NNNN)
  const cardMatch = paymentMethod.match(/^(.+?银行).*?[储蓄信用]卡.*?[\(（](\d+)[\)）]/)
  if (cardMatch) {
    return {
      type: paymentMethod.includes('信用') ? 'CREDIT_CARD' : 'BANK_DEBIT',
      defaultName: paymentMethod,
      bankName: cardMatch[1],
      accountNo: cardMatch[2],
    }
  }

  // 2. 通用银行匹配（储蓄卡/信用卡，可能无卡号）
  const bankMatch = paymentMethod.match(/^(.+?银行)/)
  if (bankMatch) {
    const type = /信用/.test(paymentMethod) ? 'CREDIT_CARD' : 'BANK_DEBIT'
    return { type, defaultName: paymentMethod, bankName: bankMatch[1] }
  }

  // 3. 按名称关键词规则匹配
  for (const rule of NAME_TYPE_RULES) {
    if (rule.test(paymentMethod)) {
      return { type: rule.type, defaultName: paymentMethod }
    }
  }

  // 4. 其他
  return { type: 'OTHER', defaultName: paymentMethod }
}

async function assertIsMember(bookId: string, userId: string) {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  if (book.ownerId === userId) return
  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) throw Object.assign(new Error('无权访问该账本'), { statusCode: 403 })
}

// ======================== Alipay CSV 解析 ========================

interface ParsedRow {
  date: string
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN'
  amount: number
  accountName: string
  accountId: string | null
  toAccountName: string | null
  toAccountId: string | null
  categoryCode: string | null
  mappedCategoryCode: string | null  // 映射后的系统分类
  payer: string | null
  remark: string
  tags: string[]
  rowIndex: number
}

function detectEncoding(buffer: Buffer): string {
  // 检查 UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf8'
  }
  // 尝试 UTF-8 解码
  try {
    const test = buffer.toString('utf8')
    if (test.includes('交易时间') && test.includes('收/支')) return 'utf8'
  } catch { /* fall through */ }
  // 默认 GBK
  return 'gbk'
}

function parseAlipayCSV(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const encoding = detectEncoding(buffer)
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, 'gbk')

  // 查找表头行
  const lines = text.split(/\r?\n/)
  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('交易时间,')) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    return { rows: [], errors: ['无法找到CSV表头行，请确认是支付宝导出的交易明细文件'] }
  }

  // 截取表头+数据行重新组合
  const csvContent = lines.slice(headerIndex).join('\n')
  let records: string[][]
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })
  } catch (e: any) {
    return { rows: [], errors: [`CSV解析失败: ${e.message}`] }
  }

  const rows: ParsedRow[] = []
  const errors: string[] = []

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as unknown as Record<string, string>
    const rowIndex = i + 2 // CSV 原始行号
    try {
      const tradeTime = r['交易时间'] || ''
      const category = r['交易分类'] || ''
      const counterparty = r['交易对方'] || ''
      const counterpartyAccount = r['对方账号'] || ''
      const description = r['商品说明'] || ''
      const direction = r['收/支'] || ''
      const amountStr = r['金额'] || ''
      const paymentMethod = r['收/付款方式'] || r['收/支方式'] || ''
      const status = r['交易状态'] || ''
      const orderNo = (r['交易订单号'] || '').trim()
      const merchantNo = (r['商家订单号'] || '').trim()
      const remark = r['备注'] || ''

      // 跳过关闭的交易
      if (status === '交易关闭' || status === '已关闭') continue

      // 解析金额
      const amount = parseFloat(amountStr)
      if (isNaN(amount) || amount === 0) continue

      // 解析日期: YYYY-MM-DD HH:mm:ss → ISO
      const date = new Date(tradeTime.replace(' ', 'T') + '+08:00').toISOString()
      if (isNaN(new Date(date).getTime())) {
        errors.push(`第${rowIndex}行: 日期格式无法解析`)
        continue
      }

      // 确定记录类型
      let recordType: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN' = 'EXPENSE'
      let toAccountName: string | null = null

      if (direction === '收入') {
        recordType = 'INCOME'
      } else if (direction === '支出') {
        recordType = 'EXPENSE'
      } else if (direction === '不计支出' || direction === '不计收支') {
        // 花呗还款 → 转账
        const isHuabeiRepay = (category === '金融借贷' || category === '信用借还' || counterparty === '花呗')
          && (counterparty === '花呗' || /花呗/.test(description))
        // 余额宝转入/转出 → 转账
        const isYueBaoTransfer = category === '投资理财'
          && (counterparty === '余额宝' || /余额宝/.test(description))
        // 蚂蚁财富转入转出 → 转账
        const isAntTransfer = category === '投资理财'
          && (counterparty === '蚂蚁财富' || /蚂蚁财富/.test(description) || /蚂蚁智还/.test(description))
        // 余额宝收益 / 基金分红 → 收入
        const isIncome = /收益|分红/.test(description) || /收益/.test(counterparty)
        // 提现：支付宝→银行卡
        const isWithdraw = /提现/.test(description)
          && (counterparty || '').length > 0
          && !ALIPAY_INTERNAL_PATTERN.test(counterparty)
        // 充值：银行卡→支付宝
        const isTopup = /充值/.test(description)

        if (isHuabeiRepay) {
          recordType = 'TRANSFER'
          toAccountName = '支付宝'
        } else if (isIncome) {
          // 收益/分红优先于转账判断
          recordType = 'INCOME'
        } else if (isWithdraw) {
          // 提现：支付宝内部账户 → 银行卡
          recordType = 'TRANSFER'
          toAccountName = counterparty
        } else if (isTopup) {
          // 充值：银行卡 → 支付宝内部账户
          recordType = 'TRANSFER'
          toAccountName = '支付宝'
        } else if (isYueBaoTransfer) {
          recordType = 'TRANSFER'
          toAccountName = '支付宝'
        } else if (isAntTransfer) {
          if (/转出到银行卡/.test(description)) {
            recordType = 'TRANSFER'
            toAccountName = counterparty
          } else {
            recordType = 'TRANSFER'
            toAccountName = '蚂蚁财富'
          }
        } else if (status === '退款成功') {
          recordType = 'INCOME'
        } else {
          // 无法自动识别 → 标记为需手动处理
          recordType = 'UNKNOWN'
        }
      } else if (direction === '不计收入') {
        if (/余额宝.*收益/.test(description)) {
          recordType = 'INCOME'
        } else {
          recordType = 'INCOME'
        }
      } else {
        recordType = 'EXPENSE'
      }

      // 统一支付宝子账户
      const resolvedAccountName = resolveAlipayAccountName(paymentMethod)
      const resolvedToAccountName = toAccountName ? resolveAlipayAccountName(toAccountName) : null

      // 支付宝内部转账忽略（余额↔余额宝互转等）
      if (recordType === 'TRANSFER' && resolvedAccountName === '支付宝' && resolvedToAccountName === '支付宝') {
        continue
      }

      // 构建备注：商品说明 | 对方账号 | 交易状态 | 订单号 | 商家订单号 | 备注
      const remarkParts: string[] = []
      if (description) remarkParts.push(description)
      if (counterpartyAccount) remarkParts.push(`对方:${counterpartyAccount}`)
      if (status && status !== '交易成功') remarkParts.push(`状态:${status}`)
      if (orderNo) remarkParts.push(`订单:${orderNo}`)
      if (merchantNo) remarkParts.push(`商户单:${merchantNo}`)
      if (remark) remarkParts.push(remark)
      const combinedRemark = remarkParts.join(' | ')

      rows.push({
        date,
        type: recordType,
        amount,
        accountName: resolvedAccountName,
        accountId: null,
        toAccountName: resolvedToAccountName,
        toAccountId: null,
        categoryCode: category || null,
        mappedCategoryCode: null,
        payer: counterparty || null,
        remark: combinedRemark,
        tags: ['导入', '支付宝'],
        rowIndex,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// ======================== WeChat XLSX 解析 ========================

/** Excel 序列号转 ISO 日期字符串 */
function excelSerialToISO(serial: number): string {
  // Excel epoch: 1899-12-30 (考虑 Lotus 1-2-3 闰年 bug)
  const excelEpoch = Date.UTC(1899, 11, 30)
  return new Date(excelEpoch + serial * 86400000).toISOString()
}

function parseWechatXlsx(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  // 转为二维数组
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  // 查找表头行（包含"交易时间"）
  let headerIndex = -1
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (row.some(cell => String(cell).includes('交易时间'))) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    return { rows: [], errors: ['无法找到表头行，请确认是微信导出的账单文件'] }
  }

  const headerRow = data[headerIndex].map(h => String(h).trim())

  // 列索引映射
  const colIndex: Record<string, number> = {}
  for (let i = 0; i < headerRow.length; i++) {
    colIndex[headerRow[i]] = i
  }

  const getCell = (row: unknown[], colName: string): string =>
    String(row[colIndex[colName]] ?? '').trim()

  const rows: ParsedRow[] = []
  const errors: string[] = []

  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = data[i]
    const rowIndex = i + 1
    try {
      // 跳过空行和分隔行
      const firstCell = String(row[0] ?? '').trim()
      if (!firstCell || firstCell.startsWith('---')) continue

      const tradeTimeRaw = row[colIndex['交易时间']]
      const tradeType = getCell(row, '交易类型')
      const counterparty = getCell(row, '交易对方')
      const product = getCell(row, '商品')
      const direction = getCell(row, '收/支')
      const amountStr = getCell(row, '金额(元)')
      const paymentMethod = getCell(row, '支付方式')
      const status = getCell(row, '当前状态')
      const orderNo = getCell(row, '交易单号')
      const merchantNo = getCell(row, '商户单号')
      const remark = getCell(row, '备注')

      // 解析日期
      let date: string
      if (typeof tradeTimeRaw === 'number') {
        date = excelSerialToISO(tradeTimeRaw)
      } else {
        const parsed = new Date(String(tradeTimeRaw) + '+08:00')
        if (!isNaN(parsed.getTime())) {
          date = parsed.toISOString()
        } else {
          errors.push(`第${rowIndex}行: 日期格式无法解析`)
          continue
        }
      }
      if (isNaN(new Date(date).getTime())) {
        errors.push(`第${rowIndex}行: 日期格式无法解析`)
        continue
      }

      // 解析金额
      const amount = parseFloat(amountStr)
      if (isNaN(amount) || amount === 0) continue

      // 确定记录类型
      let recordType: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN' = 'EXPENSE'
      let toAccountName: string | null = null

      if (status.includes('退款') || status.includes('已退款')) {
        recordType = 'INCOME'
      } else if (tradeType === '零钱充值') {
        recordType = 'TRANSFER'
        toAccountName = '微信'
      } else if (tradeType === '零钱提现') {
        recordType = 'TRANSFER'
        toAccountName = paymentMethod || null
      } else if (direction === '收入') {
        recordType = 'INCOME'
      } else {
        recordType = 'EXPENSE'
      }

      // 统一账户名
      const resolvedAccountName = resolveWechatAccountName(paymentMethod)
      const resolvedToAccountName = toAccountName ? resolveWechatAccountName(toAccountName) : null

      // 微信内部转账忽略（微信↔微信）
      if (recordType === 'TRANSFER' && resolvedAccountName === '微信' && resolvedToAccountName === '微信') {
        continue
      }

      // 构建备注
      const remarkParts: string[] = []
      if (product && product !== '/') remarkParts.push(product)
      if (status && status !== '支付成功') remarkParts.push(`状态:${status}`)
      if (orderNo && orderNo !== '/') remarkParts.push(`订单:${orderNo}`)
      if (merchantNo && merchantNo !== '/') remarkParts.push(`商户单:${merchantNo}`)
      if (remark && remark !== '/') remarkParts.push(remark)
      const combinedRemark = remarkParts.join(' | ')

      rows.push({
        date,
        type: recordType,
        amount,
        accountName: resolvedAccountName,
        accountId: null,
        toAccountName: resolvedToAccountName,
        toAccountId: null,
        categoryCode: tradeType || null,
        mappedCategoryCode: null,
        payer: counterparty || null,
        remark: combinedRemark,
        tags: ['导入', '微信'],
        rowIndex,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// ======================== 京东 CSV 解析 ========================

// 京东体系内账户关键词 — 白条统一映射到"京东"账户
const JD_INTERNAL_PATTERN = /京东白条/
function resolveJdAccountName(name: string) {
  if (!name) return '京东'
  if (JD_INTERNAL_PATTERN.test(name)) return '京东'
  return name
}

function parseJdCSV(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const encoding = detectEncoding(buffer)
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, 'gbk')

  // 查找表头行
  const lines = text.split(/\r?\n/)
  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('交易时间,')) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    return { rows: [], errors: ['无法找到CSV表头行，请确认是京东导出的交易明细文件'] }
  }

  // 截取表头+数据行重新组合
  const csvContent = lines.slice(headerIndex).join('\n')
  let records: string[][]
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })
  } catch (e: any) {
    return { rows: [], errors: [`CSV解析失败: ${e.message}`] }
  }

  const rows: ParsedRow[] = []
  const errors: string[] = []

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as unknown as Record<string, string>
    const rowIndex = i + 2
    try {
      const tradeTime = r['交易时间'] || ''
      const merchantName = r['商户名称'] || ''
      const description = r['交易说明'] || ''
      const direction = r['收/支'] || ''
      const amountStr = r['金额'] || ''
      const paymentMethod = r['收/付款方式'] || ''
      const status = r['交易状态'] || ''
      const category = r['交易分类'] || ''
      const orderNo = (r['交易订单号'] || '').trim()
      const merchantOrderNo = (r['商家订单号'] || '').trim()
      const remark = r['备注'] || ''

      // 解析金额
      const amount = parseFloat(amountStr)
      if (isNaN(amount) || amount === 0) continue

      // 解析日期: YYYY-MM-DD HH:mm:ss → ISO
      const date = new Date(tradeTime.replace(' ', 'T') + '+08:00').toISOString()
      if (isNaN(new Date(date).getTime())) {
        errors.push(`第${rowIndex}行: 日期格式无法解析`)
        continue
      }

      // 确定记录类型
      let recordType: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN' = 'EXPENSE'
      let toAccountName: string | null = null

      if (direction === '支出') {
        recordType = 'EXPENSE'
      } else if (direction === '收入') {
        recordType = 'INCOME'
      } else if (direction === '不计收支') {
        // 白条主动还款 → 转账（银行卡→京东白条）
        if (/白条主动还款|白条还款/.test(description)) {
          recordType = 'TRANSFER'
          toAccountName = '京东'
        } else if (/退款/.test(status) || /退款/.test(description)) {
          // 全额退款 → 收入
          recordType = 'INCOME'
        } else {
          recordType = 'UNKNOWN'
        }
      }

      // 统一京东子账户
      const resolvedAccountName = resolveJdAccountName(paymentMethod)
      const resolvedToAccountName = toAccountName ? resolveJdAccountName(toAccountName) : null

      // 京东内部转账忽略（京东白条↔京东内部账户互转）
      if (recordType === 'TRANSFER' && resolvedAccountName === '京东' && resolvedToAccountName === '京东') {
        continue
      }

      // 构建备注：说明 | 商户名称 | 状态(非成功) | 订单号 | 商家订单号 | 备注
      const remarkParts: string[] = []
      if (description) remarkParts.push(description)
      if (merchantName) remarkParts.push(`商户:${merchantName}`)
      if (status && status !== '交易成功') remarkParts.push(`状态:${status}`)
      if (orderNo) remarkParts.push(`订单:${orderNo}`)
      if (merchantOrderNo) remarkParts.push(`商户单:${merchantOrderNo}`)
      if (remark) remarkParts.push(remark)
      const combinedRemark = remarkParts.join(' | ')

      rows.push({
        date,
        type: recordType,
        amount,
        accountName: resolvedAccountName,
        accountId: null,
        toAccountName: resolvedToAccountName,
        toAccountId: null,
        categoryCode: category || null,
        mappedCategoryCode: null,
        payer: merchantName || null,
        remark: combinedRemark,
        tags: ['导入', '京东'],
        rowIndex: i + 2,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// ======================== 账户匹配 & 分类映射 ========================

async function resolveAccounts(bookId: string, rows: ParsedRow[]) {
  // 收集所有唯一账户名
  const accountNames = new Set<string>()
  for (const r of rows) {
    accountNames.add(r.accountName)
    if (r.toAccountName) accountNames.add(r.toAccountName)
  }

  // 查询已有账户
  const existingAccounts = await prisma.account.findMany({
    where: {
      accountBookId: bookId,
      name: { in: Array.from(accountNames) },
    },
    select: { id: true, name: true },
  })
  const nameToId = new Map(existingAccounts.map(a => [a.name, a.id]))

  // 未匹配的账户
  const unmatched: { csvName: string; suggestedType: string; suggestedName: string; bankName?: string; accountNo?: string }[] = []
  const seen = new Set<string>()

  for (const name of accountNames) {
    if (nameToId.has(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    const inferred = inferAccount(name)
    if (inferred) {
      unmatched.push({
        csvName: name,
        suggestedType: inferred.type,
        suggestedName: inferred.defaultName,
        bankName: inferred.bankName,
        accountNo: inferred.accountNo,
      })
    }
  }

  // 填充 accountId / toAccountId
  for (const r of rows) {
    r.accountId = nameToId.get(r.accountName) || null
    if (r.toAccountName) {
      r.toAccountId = nameToId.get(r.toAccountName) || null
    }
  }

  return unmatched
}

async function resolveCategories(source: string, rows: ParsedRow[]) {
  const sourceCategories = [...new Set(rows.map(r => r.categoryCode).filter(Boolean))] as string[]
  const allTypes = [...new Set(rows.map(r => r.type))]

  // 查询所有相关映射（匹配空 recordType 或当前导入数据的类型）
  const allMappings = await prisma.importCategoryMapping.findMany({
    where: {
      source,
      sourceCategory: { in: sourceCategories },
      OR: [
        { recordType: '' },
        { recordType: { in: allTypes } },
      ],
    },
    orderBy: [{ sourceCategory: 'asc' }, { payerContains: 'desc' }, { descriptionContains: 'desc' }],
  })

  // 按 sourceCategory 分组
  const mappingsByCat = new Map<string, typeof allMappings>()
  for (const m of allMappings) {
    const list = mappingsByCat.get(m.sourceCategory) || []
    list.push(m)
    mappingsByCat.set(m.sourceCategory, list)
  }

  // 获取所有系统字典分类
  const allDictItems = await prisma.dictionary.findMany({
    where: { group: { in: ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer'] } },
    select: { code: true, label: true, group: true },
  })
  const expenseCodes = new Set(allDictItems.filter(d => d.group === 'transaction_category_expense').map(d => d.code))
  const allCodes = allDictItems.map(d => d.code)

  // 匹配映射 — 选择最匹配的（条件匹配优先于无条件匹配）
  function findBestMapping(row: ParsedRow): string | null {
    const candidates = mappingsByCat.get(row.categoryCode!)
    if (!candidates || candidates.length === 0) return null

    let best: string | null = null
    let bestScore = -1

    for (const m of candidates) {
      // recordType 不匹配则跳过（空表示通用映射，适用于所有类型）
      if (m.recordType && m.recordType !== row.type) continue
      let score = 0
      // 精确类型匹配加分
      if (m.recordType === row.type) score += 1
      if (m.payerContains) {
        if (row.payer && row.payer.includes(m.payerContains)) score += 2
        else continue // payerContains 不匹配，跳过此映射
      }
      if (m.descriptionContains) {
        if (row.remark && row.remark.includes(m.descriptionContains)) score += 1
        else continue // descriptionContains 不匹配，跳过此映射
      }
      if (score > bestScore) {
        bestScore = score
        best = m.targetCategoryCode
      }
    }

    return best
  }

  // 收集每个分类出现的记录类型
  const categoryTypes = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.categoryCode) continue
    const types = categoryTypes.get(r.categoryCode) || new Set()
    types.add(r.type)
    categoryTypes.set(r.categoryCode, types)
  }

  // 先填充 mappedCategoryCode，再判断哪些分类真正未匹配
  for (const r of rows) {
    if (r.categoryCode) {
      r.mappedCategoryCode = findBestMapping(r)
    }
  }

  // 收集仍有未匹配记录的分类
  const categoriesWithUnmatched = new Set<string>()
  for (const r of rows) {
    if (r.categoryCode && r.mappedCategoryCode === null) {
      categoriesWithUnmatched.add(r.categoryCode)
    }
  }

  // 未映射的分类：只有至少有一条记录没匹配上的分类才算
  const unmatched: { sourceCategory: string; suggestedCode: string | null; types: string[] }[] = []
  const seen = new Set<string>()

  for (const cat of sourceCategories) {
    if (!categoriesWithUnmatched.has(cat)) continue
    if (seen.has(cat)) continue
    seen.add(cat)

    // 尝试模糊匹配
    let matched: string | null = null
    for (const code of expenseCodes) {
      if (cat.includes(code) || code.includes(cat)) {
        matched = code
        break
      }
    }
    unmatched.push({ sourceCategory: cat, suggestedCode: matched, types: [...(categoryTypes.get(cat) || [])] })
  }

  return { unmatched, allDictItems: allDictItems.map(d => ({ code: d.code, label: d.label, group: d.group })) }
}

// ======================== 路由 ========================

const previewSchema = z.object({
  source: z.enum(['alipay', 'wechat', 'csv', 'jd']),
  accountBookId: z.string().min(1),
})

const importConfirmSchema = z.object({
  accountBookId: z.string().min(1),
  source: z.enum(['alipay', 'wechat', 'csv', 'jd']),
  records: z.array(z.object({
    date: z.string(),
    type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
    amount: z.number().positive(),
    accountId: z.string().min(1),
    toAccountId: z.string().optional(),
    categoryCode: z.string().optional().nullable(),
    payer: z.string().optional().nullable(),
    remark: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).min(1),
  accountCreations: z.array(z.object({
    csvName: z.string(),
    name: z.string().min(1).max(30),
    type: z.string().min(1),
    bankName: z.string().optional(),
    accountNo: z.string().optional(),
  })).optional(),
  newMappings: z.array(z.object({
    sourceCategory: z.string(),
    targetCategoryCode: z.string(),
    payerContains: z.string().optional(),
    descriptionContains: z.string().optional(),
    recordType: z.string().optional(),
  })).optional(),
})

export async function importExportRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ===== 预览导入 =====
  app.post('/import/preview', {
    schema: {
      description: '上传CSV文件并预览解析结果',
      tags: ['导入导出'],
      consumes: ['multipart/form-data'],
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }

    // 读取 multipart 数据
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '请上传CSV文件' })

    const buffer = await data.toBuffer()
    const fields = data.fields as unknown as Record<string, { value: string }>

    const source = fields.source?.value || ''
    const accountBookId = fields.accountBookId?.value || ''

    const parsedQuery = previewSchema.safeParse({ source, accountBookId })
    if (!parsedQuery.success) {
      return reply.status(400).send({ message: '参数无效' })
    }

    await assertIsMember(accountBookId, payload.id)

    // 解析 CSV
    let parseResult: { rows: ParsedRow[]; errors: string[] }
    if (source === 'alipay') {
      parseResult = parseAlipayCSV(buffer)
    } else if (source === 'wechat') {
      parseResult = parseWechatXlsx(buffer)
    } else if (source === 'jd') {
      parseResult = parseJdCSV(buffer)
    } else {
      return reply.status(400).send({ message: '通用CSV导入暂未支持' })
    }

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return reply.status(400).send({ message: parseResult.errors[0] })
    }

    // 匹配账户
    const unmatchedAccounts = await resolveAccounts(accountBookId, parseResult.rows)

    // 匹配分类
    const { unmatched: unmatchedCategories, allDictItems } = await resolveCategories(source, parseResult.rows)

    // 分离正常记录和无法自动识别的记录
    const normalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')
    const unrecognizedRecords = parseResult.rows.filter(r => r.type === 'UNKNOWN')

    const mapRow = (r: ParsedRow) => ({
      date: r.date,
      type: r.type,
      amount: r.amount,
      accountName: r.accountName,
      accountId: r.accountId,
      toAccountName: r.toAccountName,
      toAccountId: r.toAccountId,
      categoryCode: r.categoryCode,
      mappedCategoryCode: r.mappedCategoryCode,
      payer: r.payer,
      remark: r.remark,
      tags: r.tags,
      rowIndex: r.rowIndex,
    })

    return {
      records: normalRecords.map(mapRow),
      unrecognizedRecords: unrecognizedRecords.map(mapRow),
      unmatchedAccounts,
      unmatchedCategories,
      allDictItems,
      stats: {
        totalRows: parseResult.rows.length + parseResult.errors.length,
        parsedRows: normalRecords.length,
        skippedRows: parseResult.errors.length,
        unrecognizedCount: unrecognizedRecords.length,
        errors: parseResult.errors,
      },
    }
  })

  // ===== 确认导入 =====
  app.post('/import', {
    schema: {
      description: '确认导入流水记录',
      tags: ['导入导出'],
      body: zSchema(importConfirmSchema),
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const parsed = importConfirmSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { accountBookId, source, records, accountCreations = [], newMappings = [] } = parsed.data

    await assertIsMember(accountBookId, payload.id)

    const accountMap = new Map<string, string>()
    let accountsCreated = 0
    const affectedAccounts = new Set<string>()

    // 所有写操作在一个事务中完成，任一步骤失败则整体回滚
    await prisma.$transaction(async (tx) => {
      // 创建新账户
      for (const acct of accountCreations) {
        const existing = await tx.account.findFirst({
          where: { accountBookId, name: acct.name },
        })
        if (existing) {
          accountMap.set(acct.csvName, existing.id)
          accountMap.set(acct.name, existing.id)
          continue
        }
        accountsCreated++
        const created = await tx.account.create({
          data: {
            accountBookId,
            ownerId: payload.id,
            name: acct.name,
            type: acct.type,
            bankName: acct.bankName || null,
            accountNo: acct.accountNo || null,
            balance: 0,
          },
        })
        accountMap.set(acct.csvName, created.id)
        accountMap.set(acct.name, created.id)
      }

      // 保存分类映射
      for (const m of newMappings) {
        const recordType = m.recordType || ''
        await tx.importCategoryMapping.upsert({
          where: {
            source_sourceCategory_payerContains_descriptionContains_recordType: {
              source,
              sourceCategory: m.sourceCategory,
              payerContains: m.payerContains || '',
              descriptionContains: m.descriptionContains || '',
              recordType,
            },
          },
          create: {
            source,
            sourceCategory: m.sourceCategory,
            payerContains: m.payerContains || '',
            descriptionContains: m.descriptionContains || '',
            recordType,
            targetCategoryCode: m.targetCategoryCode,
          },
          update: { targetCategoryCode: m.targetCategoryCode },
        })
      }

      // 解析所有记录的账户 ID
      const nameCache = new Map<string, string>()
      const resolveAccountId = async (idOrName: string): Promise<string> => {
        if (accountMap.has(idOrName)) return accountMap.get(idOrName)!
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName)) return idOrName
        if (nameCache.has(idOrName)) return nameCache.get(idOrName)!
        const acc = await tx.account.findFirst({ where: { accountBookId, name: idOrName } })
        if (acc) {
          nameCache.set(idOrName, acc.id)
          return acc.id
        }
        throw Object.assign(new Error(`账户不存在: ${idOrName}`), { statusCode: 400 })
      }

      // 批量创建记录
      const batchSize = 100
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize)
        const resolvedAccounts = await Promise.all(batch.map(async r => ({
          accountId: await resolveAccountId(r.accountId),
          toAccountId: r.toAccountId ? await resolveAccountId(r.toAccountId) : null,
        })))

        const createData = batch.map((r, idx) => {
          const accountId = resolvedAccounts[idx].accountId
          const toAccountId = resolvedAccounts[idx].toAccountId
          affectedAccounts.add(accountId)
          if (toAccountId) affectedAccounts.add(toAccountId)

          return {
            accountBookId,
            type: r.type,
            amount: r.amount,
            date: new Date(r.date),
            remark: r.remark || null,
            tags: JSON.stringify(r.tags ?? []),
            accountId,
            fromAccountId: r.type === 'TRANSFER' ? accountId : null,
            toAccountId: r.type === 'TRANSFER' ? toAccountId : null,
            categoryCode: r.categoryCode || null,
            payer: r.payer || null,
            ownerId: payload.id,
          }
        })

        await Promise.all(
          createData.map(d =>
            tx.record.create({ data: d })
          )
        )
      }
    })

    // 刷新所有受影响账户的余额（事务外，刷新失败不影响导入结果）
    for (const accId of affectedAccounts) {
      try {
        await refreshAccountBalance(accId)
      } catch { /* 单个账户刷新失败不中断整体 */ }
    }

    return {
      imported: records.length,
      accountsCreated,
      newAccountIds: Object.fromEntries(accountMap),
    }
  })

  // ===== 分类映射 CRUD =====
  app.get('/import/mappings', {
    schema: {
      description: '获取导入分类映射列表',
      tags: ['导入导出'],
    },
  }, async (req) => {
    const { source } = req.query as { source?: string }
    const where = source ? { source } : {}
    const mappings = await prisma.importCategoryMapping.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
    return { mappings }
  })

  app.post('/import/mappings', {
    schema: {
      description: '批量保存导入分类映射',
      tags: ['导入导出'],
    },
  }, async (req, reply) => {
    const body = req.body as { mappings: { source: string; sourceCategory: string; payerContains?: string; descriptionContains?: string; recordType?: string; targetCategoryCode: string }[] }
    if (!body.mappings || !Array.isArray(body.mappings)) {
      return reply.status(400).send({ message: '参数无效' })
    }

    for (const m of body.mappings) {
      const payerContains = m.payerContains || ''
      const descriptionContains = m.descriptionContains || ''
      await prisma.importCategoryMapping.upsert({
        where: {
          source_sourceCategory_payerContains_descriptionContains_recordType: {
            source: m.source,
            sourceCategory: m.sourceCategory,
            payerContains,
            descriptionContains,
            recordType: m.recordType || '',
          },
        },
        create: { source: m.source, sourceCategory: m.sourceCategory, payerContains, descriptionContains, recordType: m.recordType || '', targetCategoryCode: m.targetCategoryCode },
        update: { targetCategoryCode: m.targetCategoryCode },
      })
    }

    return { success: true }
  })

  app.delete('/import/mappings/:id', {
    schema: {
      description: '删除导入分类映射',
      tags: ['导入导出'],
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    await prisma.importCategoryMapping.delete({ where: { id } })
    return { success: true }
  })

  // ===== 导出 CSV =====
  app.get('/export', {
    schema: {
      description: '导出流水记录为CSV文件',
      tags: ['导入导出'],
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const query = req.query as Record<string, string>
    const bookId = query.bookId

    if (!bookId) return reply.status(400).send({ message: '缺少bookId参数' })
    await assertIsMember(bookId, payload.id)

    // 构建查询条件
    const where: any = { accountBookId: bookId }
    if (query.type) {
      where.type = { in: query.type.split(',') }
    }
    if (query.accountId) {
      where.accountId = { in: query.accountId.split(',') }
    }
    if (query.categoryCode) {
      where.categoryCode = { in: query.categoryCode.split(',') }
    }
    if (query.dateFrom || query.dateTo) {
      where.date = {}
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom)
      if (query.dateTo) where.date.lte = new Date(query.dateTo)
    }

    const records = await prisma.record.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        account: { select: { name: true } },
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
        owner: { select: { nickname: true, email: true } },
      },
      take: 10000,
    })

    // 构建 CSV
    const typeLabels: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' }
    const header = '日期,类型,金额,账户,转账来源,转账目标,分类,交易方,备注,归属人,标签'
    const csvRows = records.map(r => {
      const tags = JSON.parse(r.tags || '[]') as string[]
      const owner = r.owner.nickname || r.owner.email
      return [
        r.date.toISOString().slice(0, 10),
        typeLabels[r.type] || r.type,
        String(r.amount),
        r.account?.name || '',
        r.fromAccount?.name || '',
        r.toAccount?.name || '',
        r.categoryCode || '',
        r.payer || '',
        (r.remark || '').replace(/,/g, '，'),
        owner,
        tags.join('、'),
      ].map(f => f.includes(',') || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f).join(',')
    })

    const csv = [header, ...csvRows].join('\n')
    const filename = `records_export_${new Date().toISOString().slice(0, 10)}.csv`

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return reply.send('\uFEFF' + csv) // BOM for Excel
  })
}
