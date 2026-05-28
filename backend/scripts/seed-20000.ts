import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min: number, max: number) {
  return +(Math.random() * (max - min) + min).toFixed(2)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

// 随机日期 (2023-01-01 到 当前)
function randomDate(): Date {
  const year = rand(2023, 2026)
  const month = rand(1, 12)
  const day = rand(1, 28) // 简化，都按28天
  const hour = rand(8, 22)
  const minute = rand(0, 59)
  const second = rand(0, 59)
  return new Date(year, month - 1, day, hour, minute, second)
}

// 让日期分布偏向近期（幂律分布：最近几个月更多）
function weightedRandomDate(): Date {
  const now = new Date()
  const daysBack = 1460 // 4 years
  // 使用平方根分布：越近期记录越多
  const r = Math.random()
  const days = Math.floor(r * r * daysBack)
  const d = new Date(now.getTime() - days * 86400000)
  d.setHours(rand(6, 23), rand(0, 59), rand(0, 59))
  return d
}

// 收入分类
const INCOME_CATEGORIES = [
  { code: '工资', weight: 40, minAmount: 5000, maxAmount: 35000, payers: ['XX科技公司', 'XX集团', 'XX银行', 'XX咨询公司', 'XX教育培训'] },
  { code: '奖金', weight: 10, minAmount: 3000, maxAmount: 80000, payers: ['XX科技公司', 'XX集团', 'XX咨询公司'] },
  { code: '投资收益', weight: 8, minAmount: 100, maxAmount: 20000, payers: ['XX基金', 'XX证券', 'XX理财', 'XX金服'] },
  { code: '兼职', weight: 12, minAmount: 300, maxAmount: 8000, payers: ['张三', '李四', '王五', '赵六', '甲方客户'] },
  { code: '红包', weight: 15, minAmount: 1, maxAmount: 200, payers: ['妈妈', '爸爸', '老公', '老婆', '朋友', '亲戚', '同事'] },
  { code: '退款', weight: 8, minAmount: 10, maxAmount: 500, payers: ['淘宝', '京东', '拼多多', '美团', '滴滴', '携程'] },
  { code: '其他收入', weight: 7, minAmount: 5, maxAmount: 3000, payers: ['银行返现', '保险理赔', '二手转卖', '其他'] },
]

// 支出分类
const EXPENSE_CATEGORIES = [
  { code: '餐饮', weight: 25, minAmount: 5, maxAmount: 300, payers: ['美团外卖', '饿了么', '肯德基', '麦当劳', '海底捞', '星巴克', '瑞幸咖啡', '老乡鸡', '沙县小吃', '兰州拉面', '喜茶', '奈雪的茶', '必胜客', '呷哺呷哺', '外婆家'] },
  { code: '交通', weight: 12, minAmount: 1, maxAmount: 150, payers: ['滴滴出行', '高德打车', '公交地铁', '中石化', '中石油', '哈啰单车', '曹操出行', 'T3出行', '神州专车', '首汽约车'] },
  { code: '购物', weight: 20, minAmount: 2, maxAmount: 5000, payers: ['淘宝', '京东', '拼多多', '天猫', '唯品会', '苏宁易购', '得物', '抖音商城', '快手小店', '网易严选'] },
  { code: '住房', weight: 5, minAmount: 1500, maxAmount: 8000, payers: ['链家地产', '自如', '万科物业', '碧桂园物业', 'XX房东', '公寓管家'] },
  { code: '娱乐', weight: 10, minAmount: 5, maxAmount: 500, payers: ['腾讯视频', '爱奇艺', '优酷', '网易云音乐', 'QQ音乐', 'B站', 'Steam', '电影院', 'KTV', '密室逃脱', '剧本杀', '迪士尼乐园'] },
  { code: '医疗', weight: 5, minAmount: 20, maxAmount: 2000, payers: ['XX医院', 'XX药房', '京东健康', '阿里健康', '丁香诊所', '体检中心', 'XX口腔'] },
  { code: '教育', weight: 5, minAmount: 50, maxAmount: 5000, payers: ['得到', '极客时间', '慕课网', 'B站课堂', '新东方', '学而思', '知乎盐选', '知识星球'] },
  { code: '通讯', weight: 4, minAmount: 20, maxAmount: 200, payers: ['中国移动', '中国联通', '中国电信', '腾讯云', '阿里云'] },
  { code: '水电', weight: 4, minAmount: 20, maxAmount: 400, payers: ['国家电网', 'XX燃气公司', 'XX自来水公司', 'XX供热公司'] },
  { code: '服饰', weight: 4, minAmount: 29, maxAmount: 2000, payers: ['优衣库', 'ZARA', 'HM', 'Nike', 'Adidas', '李宁', '安踏', 'URBAN REVIVO'] },
  { code: '日用品', weight: 3, minAmount: 5, maxAmount: 200, payers: ['名创优品', '无印良品', '屈臣氏', '沃尔玛', '盒马鲜生', '永辉超市', '大润发'] },
  { code: '其他支出', weight: 3, minAmount: 1, maxAmount: 1000, payers: ['顺丰速运', '中通快递', '圆通速递', '申通快递', 'EMS', '其他'] },
]

// 收入备注模板
const INCOME_REMARKS = [
  '{month}月工资', '年终奖', '项目奖金', '季度绩效', '季度分红', '股票分红',
  '接私活尾款', '周末兼职', '翻译兼职', '设计外包费', '咨询费',
  '生日红包', '过年红包', '结婚礼金', '理财收益', '基金赎回',
  '商品退货退款', '运费险赔付', '价保退款',
  '闲鱼二手卖出', '卖废旧物品',
]

// 支出备注模板
const EXPENSE_REMARKS = [
  '午餐', '晚餐', '早餐', '下午茶', '夜宵', '聚餐AA', '请客吃饭', '买零食',
  '打车上班', '地铁充值', '加油', '停车费', '共享单车月卡', '高铁票', '机票',
  '买衣服', '买书', '数码产品', '家电', '化妆品', '零食',
  '月付房租', '物业费', '维修费',
  '月度会员', '看电影', '音乐会门票', '游戏充值', '买皮肤',
  '看病挂号', '买药', '年度体检', '洗牙', '配眼镜',
  '在线课程', '买专栏', '买工具书', '英语流利说订阅',
  '话费充值', '宽带续费',
  '电费', '水费', '燃气费',
  'T恤', '牛仔裤', '运动鞋', '羽绒服', '连衣裙',
  '洗发水', '洗衣液', '纸巾', '牙膏',
  '快递费', '搬家费', '修手机', '配钥匙', '干洗费',
]

// 转账备注模板
const TRANSFER_REMARKS = [
  '零用钱转出', '资金归集', '还款', '工资转储蓄', '投资调拨',
  '信用卡还款', '日常支出备用', '定投转入', '应急备用金', '转账',
]

// 标签池
const TAG_POOL = [
  '日常', '必需', '可选', '冲动消费', '计划内', '计划外',
  '高频', '低频', '刚需', '享受', '学习', '社交',
  '家庭', '个人', '健康', '数码', '美食', '旅行',
  '冲动', '理性', '重要', '紧急', '长期', '短期',
]

function randomRemark(type: string): string {
  if (type === 'INCOME') return pick(INCOME_REMARKS)
  if (type === 'TRANSFER') return pick(TRANSFER_REMARKS)
  if (Math.random() < 0.3) return '' // 30% 无备注
  return pick(EXPENSE_REMARKS)
}

function randomTags(): string[] {
  const count = rand(0, 3)
  if (count === 0) return []
  return pickN(TAG_POOL, count)
}

// 加权随机选分类
function weightedPick(items: { code: string; weight: number }[]): string {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item.code
  }
  return items[items.length - 1].code
}

function getCategoryInfo(type: string, categoryCode: string) {
  const list = type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  return list.find(c => c.code === categoryCode)
}

async function main() {
  console.log('===== 初始化种子数据 =====\n')

  // 1. 获取或创建用户
  let user = await prisma.user.findFirst()
  if (!user) {
    console.log('创建测试用户...')
    const bcryptjs = await import('bcryptjs')
    const hash = await bcryptjs.default.hash('123456', 10)
    user = await prisma.user.create({
      data: { email: 'test@homibook.com', password: hash, name: '测试用户', role: 'ADMIN' },
    })
    console.log(`  用户: ${user.email} / 123456`)
  }
  console.log(`用户: ${user.name} (${user.email})\n`)

  // 2. 获取或创建账本
  let book = await prisma.accountBook.findFirst({ where: { ownerId: user.id } })
  if (!book) {
    book = await prisma.accountBook.create({
      data: { name: '家庭账本', ownerId: user.id },
    })
    console.log(`  创建账本: ${book.name}\n`)
  }
  console.log(`账本: ${book.name}\n`)

  // 3. 获取或创建账户
  const accountDefs = [
    { name: '工商银行储蓄卡', type: 'BANK_DEBIT' },
    { name: '招商银行信用卡', type: 'CREDIT_CARD' },
    { name: '支付宝', type: 'ALIPAY' },
    { name: '微信钱包', type: 'WECHAT' },
    { name: '现金', type: 'CASH' },
    { name: '建设银行储蓄卡', type: 'BANK_DEBIT' },
    { name: '投资账户', type: 'INVESTMENT' },
  ]

  const accounts: Array<{ id: string; name: string; type: string }> = []
  for (const def of accountDefs) {
    let acc = await prisma.account.findFirst({
      where: { accountBookId: book.id, ownerId: user.id, name: def.name },
    })
    if (!acc) {
      acc = await prisma.account.create({
        data: { ...def, accountBookId: book.id, ownerId: user.id },
      })
    }
    accounts.push(acc)
  }
  console.log(`账户: ${accounts.map(a => a.name).join(', ')}\n`)

  const accountMap = {
    BANK_DEBIT: accounts.filter(a => a.type === 'BANK_DEBIT'),
    CREDIT_CARD: accounts.filter(a => a.type === 'CREDIT_CARD'),
    ALIPAY: accounts,
    WECHAT: accounts,
    CASH: accounts,
    INVESTMENT: accounts.filter(a => a.type === 'INVESTMENT'),
  }

  // 4. 获取分类
  const categories = await prisma.category.findMany()
  console.log(`分类: ${categories.length} 个\n`)

  // 5. 生成 20000 条流水
  const TOTAL = 20000
  const BATCH_SIZE = 500
  console.log(`开始生成 ${TOTAL} 条流水...\n`)

  const recordCounts = { INCOME: 0, EXPENSE: 0, TRANSFER: 0 }
  const batch: any[] = []

  for (let i = 0; i < TOTAL; i++) {
    // 决定类型: INCOME 25%, EXPENSE 60%, TRANSFER 15%
    const typeRand = Math.random()
    let type: string
    if (typeRand < 0.25) type = 'INCOME'
    else if (typeRand < 0.85) type = 'EXPENSE'
    else type = 'TRANSFER'

    recordCounts[type as keyof typeof recordCounts]++

    const date = weightedRandomDate()
    const dateStr = date.toISOString()
    let amount: number
    let categoryCode: string | null = null
    let payer: string | null = null
    let remark: string | null = null
    let accountId: string
    let fromAccountId: string | null = null
    let toAccountId: string | null = null

    if (type === 'INCOME') {
      const code = weightedPick(INCOME_CATEGORIES)
      const info = getCategoryInfo(type, code)!
      amount = randFloat(info.minAmount, info.maxAmount)
      categoryCode = code
      payer = pick(info.payers)
      remark = randomRemark('INCOME')
      accountId = pick(accounts).id
    } else if (type === 'EXPENSE') {
      const code = weightedPick(EXPENSE_CATEGORIES)
      const info = getCategoryInfo(type, code)!
      amount = randFloat(info.minAmount, info.maxAmount)
      categoryCode = code
      payer = pick(info.payers)
      remark = randomRemark('EXPENSE')
      accountId = pick(accounts).id
    } else {
      // TRANSFER
      const fromAcc = pick(accounts)
      let toAcc = pick(accounts)
      while (toAcc.id === fromAcc.id) toAcc = pick(accounts)
      amount = randFloat(100, 50000)
      categoryCode = '转账'
      remark = randomRemark('TRANSFER')
      accountId = fromAcc.id // 主账户 = 转出账户
      fromAccountId = fromAcc.id
      toAccountId = toAcc.id
      payer = null
    }

    const tags = randomTags()

    batch.push({
      accountBookId: book.id,
      type,
      amount,
      date: new Date(dateStr),
      remark,
      tags: tags.length ? JSON.stringify(tags) : '[]',
      accountId,
      fromAccountId,
      toAccountId,
      categoryCode,
      payer,
      ownerId: user.id,
    })

    // 每 BATCH_SIZE 条批量写入
    if (batch.length >= BATCH_SIZE) {
      await prisma.record.createMany({ data: batch })
      process.stdout.write(`\r  已生成 ${Math.min(i + 1, TOTAL)} / ${TOTAL} (${((i + 1) / TOTAL * 100).toFixed(1)}%)`)
      batch.length = 0
    }
  }

  // 写入剩余
  if (batch.length > 0) {
    await prisma.record.createMany({ data: batch })
  }

  console.log(`\n\n===== 完成 =====`)
  console.log(`  收入: ${recordCounts.INCOME} 条`)
  console.log(`  支出: ${recordCounts.EXPENSE} 条`)
  console.log(`  转账: ${recordCounts.TRANSFER} 条`)
  console.log(`  总计: ${TOTAL} 条`)
  console.log(`\n测试用户: ${user.email} / 123456`)
}

main()
  .catch((e) => {
    console.error('错误:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

// npx tsx scripts/seed-20000.ts
