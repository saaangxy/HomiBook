import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import * as XLSX from 'xlsx'
import type { ParsedRow } from './shared.js'

// ---- 通用工具 ----

function detectEncoding(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf8'
  }
  try {
    const test = buffer.toString('utf8')
    if (test.includes('交易时间') && test.includes('收/支')) return 'utf8'
  } catch { /* fall through */ }
  return 'gbk'
}

function parseDateStr(raw: string): string | null {
  if (!raw) return null
  const nums = raw.match(/\d+/g)
  if (!nums || nums.length < 3) return null
  const [y, m, d, h = '0', min = '0', s = '0'] = nums
  const pad = (n: string, len = 2) => n.padStart(len, '0')
  const date = new Date(`${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:${pad(s)}+08:00`)
  if (isNaN(date.getTime())) return null
  return date.toISOString()
}

// ---- 支付宝 ----

const ALIPAY_INTERNAL_PATTERN = /花呗|余额宝|余额|账户余额|集分宝|红包|淘金币|支付宝|他人代付/
export function resolveAlipayAccountName(name: string) {
  if (!name) return '支付宝'
  if (ALIPAY_INTERNAL_PATTERN.test(name)) return '支付宝'
  return name
}

export function parseAlipayCSV(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const encoding = detectEncoding(buffer)
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, 'gbk')

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

  const csvContent = lines.slice(headerIndex).join('\n')
  let records: string[][]
  try {
    records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
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

      if (status === '交易关闭' || status === '已关闭') continue

      const amount = parseFloat(amountStr)
      if (isNaN(amount) || amount === 0) continue

      const date = parseDateStr(tradeTime)
      if (!date) {
        errors.push(`第${rowIndex}行: 日期格式无法解析 "${tradeTime}"`)
        continue
      }

      let recordType: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN' = 'EXPENSE'
      let toAccountName: string | null = null

      if (direction === '收入') {
        recordType = 'INCOME'
      } else if (direction === '支出') {
        recordType = 'EXPENSE'
      } else if (direction === '不计支出' || direction === '不计收支') {
        const isHuabeiRepay = (category === '金融借贷' || category === '信用借还' || counterparty === '花呗')
          && (counterparty === '花呗' || /花呗/.test(description))
        const isYueBaoTransfer = category === '投资理财'
          && (counterparty === '余额宝' || /余额宝/.test(description))
        const isAntTransfer = category === '投资理财'
          && (counterparty === '蚂蚁财富' || /蚂蚁财富/.test(description) || /蚂蚁智还/.test(description))
        const isIncome = /收益|分红/.test(description) || /收益/.test(counterparty)
        const isWithdraw = /提现/.test(description)
          && (counterparty || '').length > 0
          && !ALIPAY_INTERNAL_PATTERN.test(counterparty)
        const isTopup = /充值/.test(description)

        if (isHuabeiRepay) {
          recordType = 'TRANSFER'
          toAccountName = '支付宝'
        } else if (isIncome) {
          recordType = 'INCOME'
        } else if (isWithdraw) {
          recordType = 'TRANSFER'
          toAccountName = counterparty
        } else if (isTopup) {
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
          recordType = 'UNKNOWN'
        }
      } else if (direction === '不计收入') {
        recordType = 'INCOME'
      } else {
        recordType = 'EXPENSE'
      }

      const resolvedAccountName = resolveAlipayAccountName(paymentMethod)
      const resolvedToAccountName = toAccountName ? resolveAlipayAccountName(toAccountName) : null

      if (recordType === 'TRANSFER' && resolvedAccountName === '支付宝' && resolvedToAccountName === '支付宝') {
        continue
      }

      const remarkParts: string[] = []
      if (description) remarkParts.push(description)
      if (counterpartyAccount) remarkParts.push(`对方:${counterpartyAccount}`)
      if (status && status !== '交易成功') remarkParts.push(`状态:${status}`)
      if (orderNo) remarkParts.push(`订单:${orderNo}`)
      if (merchantNo) remarkParts.push(`商户单:${merchantNo}`)
      if (remark) remarkParts.push(remark)
      const combinedRemark = remarkParts.join(' | ')

      rows.push({
        date, type: recordType, amount, accountName: resolvedAccountName, accountId: null,
        toAccountName: resolvedToAccountName, toAccountId: null,
        categoryCode: category || null, mappedCategoryCode: null,
        payer: counterparty || null, remark: combinedRemark,
        tags: ['导入', '支付宝'], rowIndex,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// ---- 微信 ----

const WECHAT_INTERNAL_PATTERN = /零钱|零钱通/
export function resolveWechatAccountName(name: string) {
  if (!name || name === '/' || name === '\\') return '微信'
  if (WECHAT_INTERNAL_PATTERN.test(name)) return '微信'
  return name
}

function excelSerialToISO(serial: number): string {
  const excelEpoch = Date.UTC(1899, 11, 30)
  return new Date(excelEpoch + serial * 86400000).toISOString()
}

export function parseWechatXlsx(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

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
  const colIndex: Record<string, number> = {}
  for (let i = 0; i < headerRow.length; i++) colIndex[headerRow[i]] = i

  const getCell = (row: unknown[], colName: string): string =>
    String(row[colIndex[colName]] ?? '').trim()

  const rows: ParsedRow[] = []
  const errors: string[] = []

  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = data[i]
    const rowIndex = i + 1
    try {
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

      const amount = parseFloat(amountStr)
      if (isNaN(amount) || amount === 0) continue

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

      const resolvedAccountName = resolveWechatAccountName(paymentMethod)
      const resolvedToAccountName = toAccountName ? resolveWechatAccountName(toAccountName) : null

      if (recordType === 'TRANSFER' && resolvedAccountName === '微信' && resolvedToAccountName === '微信') {
        continue
      }

      const remarkParts: string[] = []
      if (product && product !== '/') remarkParts.push(product)
      if (status && status !== '支付成功') remarkParts.push(`状态:${status}`)
      if (orderNo && orderNo !== '/') remarkParts.push(`订单:${orderNo}`)
      if (merchantNo && merchantNo !== '/') remarkParts.push(`商户单:${merchantNo}`)
      if (remark && remark !== '/') remarkParts.push(remark)
      const combinedRemark = remarkParts.join(' | ')

      rows.push({
        date, type: recordType, amount, accountName: resolvedAccountName, accountId: null,
        toAccountName: resolvedToAccountName, toAccountId: null,
        categoryCode: tradeType || null, mappedCategoryCode: null,
        payer: counterparty || null, remark: combinedRemark,
        tags: ['导入', '微信'], rowIndex,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// ---- 京东 ----

const JD_INTERNAL_PATTERN = /京东白条/
function resolveJdAccountName(name: string) {
  if (!name) return '京东'
  if (JD_INTERNAL_PATTERN.test(name)) return '京东'
  return name
}

export function parseJdCSV(buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  const encoding = detectEncoding(buffer)
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, 'gbk')

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

  const csvContent = lines.slice(headerIndex).join('\n')
  let records: string[][]
  try {
    records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
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

      const amount = parseFloat(amountStr)
      if (isNaN(amount) || amount === 0) continue

      const date = parseDateStr(tradeTime)
      if (!date) {
        errors.push(`第${rowIndex}行: 日期格式无法解析 "${tradeTime}"`)
        continue
      }

      let recordType: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN' = 'EXPENSE'
      let toAccountName: string | null = null

      if (direction === '支出') {
        recordType = 'EXPENSE'
      } else if (direction === '收入') {
        recordType = 'INCOME'
      } else if (direction === '不计收支') {
        if (/白条主动还款|白条还款/.test(description)) {
          recordType = 'TRANSFER'
          toAccountName = '京东'
        } else if (/退款/.test(status) || /退款/.test(description)) {
          recordType = 'INCOME'
        } else {
          recordType = 'UNKNOWN'
        }
      }

      const resolvedAccountName = resolveJdAccountName(paymentMethod)
      const resolvedToAccountName = toAccountName ? resolveJdAccountName(toAccountName) : null

      if (recordType === 'TRANSFER' && resolvedAccountName === '京东' && resolvedToAccountName === '京东') {
        continue
      }

      const remarkParts: string[] = []
      if (description) remarkParts.push(description)
      if (merchantName) remarkParts.push(`商户:${merchantName}`)
      if (status && status !== '交易成功') remarkParts.push(`状态:${status}`)
      if (orderNo) remarkParts.push(`订单:${orderNo}`)
      if (merchantOrderNo) remarkParts.push(`商户单:${merchantOrderNo}`)
      if (remark) remarkParts.push(remark)
      const combinedRemark = remarkParts.join(' | ')

      rows.push({
        date, type: recordType, amount, accountName: resolvedAccountName, accountId: null,
        toAccountName: resolvedToAccountName, toAccountId: null,
        categoryCode: category || null, mappedCategoryCode: null,
        payer: merchantName || null, remark: combinedRemark,
        tags: ['导入', '京东'], rowIndex: i + 2,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// ---- 通用 CSV ----

export function detectHeaderIndex(lines: string[], maxScan = 60): number {
  const headerPatterns: { pattern: RegExp; score: number }[] = [
    { pattern: /日期|时间|date|time/i, score: 3 },
    { pattern: /金额|amount/i, score: 3 },
    { pattern: /收支|方向|类型|type/i, score: 2 },
    { pattern: /账户|账号|支付方式|付款方式|收款方式|account/i, score: 2 },
    { pattern: /分类|category/i, score: 1 },
    { pattern: /说明|备注|remark|note|desc|附言/i, score: 1 },
    { pattern: /交易方|商户|对方|payer|merchant|counterparty/i, score: 1 },
    { pattern: /商品|描述|description/i, score: 1 },
    { pattern: /状态|status/i, score: 1 },
    { pattern: /订单|order|单号/i, score: 1 },
  ]

  let bestIndex = 0
  let bestScore = -Infinity

  for (let i = 0; i < Math.min(lines.length, maxScan); i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const cols = line.split(',')
    if (cols.length < 3) continue

    let score = 0
    let numericCols = 0
    let emptyCols = 0

    for (const col of cols) {
      const c = col.trim().replace(/^["']|["']$/g, '')
      if (!c) { emptyCols++; continue }

      if (/^\d+(\.\d+)?$/.test(c)) numericCols++
      if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(c)) numericCols++
      if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(c)) numericCols++

      for (const { pattern, score: s } of headerPatterns) {
        if (pattern.test(c)) {
          score += s
          break
        }
      }
    }

    const validCols = cols.length - emptyCols
    if (validCols > 0) {
      const numericRatio = numericCols / validCols
      if (numericRatio > 0.5) score -= 4
      else if (numericRatio > 0.3) score -= 2
    }

    score += Math.min(validCols, 12) * 0.3

    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestScore >= 2 ? bestIndex : 0
}

export function parseCsvWithMapping(
  buffer: Buffer,
  columnMapping: Record<string, string>,
  typeMapping: Record<string, string>,
  headerRow?: number,
): { rows: ParsedRow[]; errors: string[] } {
  const encoding = detectEncoding(buffer)
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, 'gbk')

  const lines = text.split(/\r?\n/)
  let headerIndex = -1
  if (headerRow !== undefined && headerRow > 0) {
    headerIndex = headerRow - 1
    if (headerIndex >= lines.length) {
      return { rows: [], errors: [`表头行号 ${headerRow} 超出文件总行数 ${lines.length}`] }
    }
  } else {
    const colNames = Object.values(columnMapping)
    for (let i = 0; i < lines.length; i++) {
      const matchCount = colNames.filter(c => lines[i].includes(c)).length
      if (matchCount >= 2) {
        headerIndex = i
        break
      }
    }
    if (headerIndex === -1) {
      return { rows: [], errors: ['无法定位CSV表头行，请检查列名是否正确或手动指定表头行号'] }
    }
  }

  const csvContent = lines.slice(headerIndex).join('\n')
  let records: string[][]
  try {
    records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
  } catch (e: any) {
    return { rows: [], errors: [`CSV解析失败: ${e.message}`] }
  }

  const rows: ParsedRow[] = []
  const errors: string[] = []

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as unknown as Record<string, string>
    const rowIndex = headerIndex + i + 2

    const values = Object.values(r).filter(v => v)
    if (values.length === 0) continue

    try {
      const getField = (field: string): string => {
        const col = columnMapping[field]
        if (!col) return ''
        return (r[col] || '').trim()
      }

      const dateStr = getField('date')
      const amountStr = getField('amount')
      const typeStr = getField('type')
      const account = getField('account')
      const toAccount = getField('toAccount')
      const payer = getField('payer')
      const category = getField('category')
      const description = getField('description')
      const remark = getField('remark')

      const date = parseDateStr(dateStr)
      if (!date) {
        errors.push(`第${rowIndex}行: 日期格式无法解析 "${dateStr}"`)
        continue
      }

      const amount = parseFloat(amountStr.replace(/[¥¥$，,\s元€£]/g, ''))
      if (isNaN(amount) || amount === 0) continue

      let recordType: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN'
      if (typeStr && typeMapping[typeStr]) {
        recordType = typeMapping[typeStr] as 'INCOME' | 'EXPENSE' | 'TRANSFER'
      } else if (typeStr) {
        if (/^收入|^入账|^收款|income/i.test(typeStr)) recordType = 'INCOME'
        else if (/^不计收支|^不计|^转账|^transfer/i.test(typeStr)) recordType = 'TRANSFER'
        else if (/^支出|^出账|^付款|^expense/i.test(typeStr)) recordType = 'EXPENSE'
        else recordType = 'UNKNOWN'
      } else {
        recordType = 'UNKNOWN'
      }

      const remarkParts: string[] = []
      if (description) remarkParts.push(description)
      if (remark) remarkParts.push(remark)

      rows.push({
        date, type: recordType, amount,
        accountName: account || '导入账户', accountId: null,
        toAccountName: toAccount || null, toAccountId: null,
        categoryCode: category || null, mappedCategoryCode: null,
        payer: payer || null,
        remark: remarkParts.join(' | '),
        tags: ['导入', 'CSV'], rowIndex,
      })
    } catch (e: any) {
      errors.push(`第${rowIndex}行: ${e.message}`)
    }
  }

  return { rows, errors }
}

// 兼容：导出 detectEncoding 供 CSV analyze 路由使用
export { detectEncoding, parseDateStr }
