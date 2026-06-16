import { prisma } from './app.js'

const DEFAULT_CONFIG: Record<string, string> = {
  registrationOpen: JSON.stringify(true),
  defaultCurrency: JSON.stringify('CNY'),
}

const DEFAULT_DICTIONARIES: Array<{ group: string; code: string; label: string; order: number }> = [
  // 账户类型
  { group: 'account_type', code: 'BANK_DEBIT', label: '借记卡', order: 0 },
  { group: 'account_type', code: 'CREDIT_CARD', label: '信用卡', order: 1 },
  { group: 'account_type', code: 'ALIPAY', label: '支付宝', order: 2 },
  { group: 'account_type', code: 'WECHAT', label: '微信', order: 3 },
  { group: 'account_type', code: 'CASH', label: '现金', order: 4 },
  { group: 'account_type', code: 'RECHARGE_CARD', label: '充值卡', order: 5 },
  { group: 'account_type', code: 'INVESTMENT', label: '投资账户', order: 6 },
  { group: 'account_type', code: 'OTHER', label: '其他', order: 7 },
  // 开户行
  { group: 'bank_name', code: '工商银行', label: '工商银行', order: 0 },
  { group: 'bank_name', code: '建设银行', label: '建设银行', order: 1 },
  { group: 'bank_name', code: '农业银行', label: '农业银行', order: 2 },
  { group: 'bank_name', code: '中国银行', label: '中国银行', order: 3 },
  { group: 'bank_name', code: '交通银行', label: '交通银行', order: 4 },
  { group: 'bank_name', code: '招商银行', label: '招商银行', order: 5 },
  { group: 'bank_name', code: '浦发银行', label: '浦发银行', order: 6 },
  { group: 'bank_name', code: '中信银行', label: '中信银行', order: 7 },
  { group: 'bank_name', code: '兴业银行', label: '兴业银行', order: 8 },
  { group: 'bank_name', code: '民生银行', label: '民生银行', order: 9 },
  // 交易分类 - 收入
  { group: 'transaction_category_income', code: '工资', label: '工资', order: 0 },
  { group: 'transaction_category_income', code: '奖金', label: '奖金', order: 1 },
  { group: 'transaction_category_income', code: '投资收益', label: '投资收益', order: 2 },
  { group: 'transaction_category_income', code: '兼职', label: '兼职', order: 3 },
  { group: 'transaction_category_income', code: '红包', label: '红包', order: 4 },
  { group: 'transaction_category_income', code: '退款', label: '退款', order: 5 },
  { group: 'transaction_category_income', code: '分红', label: '分红', order: 6 },
  { group: 'transaction_category_income', code: '其他收入', label: '其他收入', order: 99 },
  // 交易分类 - 支出
  { group: 'transaction_category_expense', code: '餐饮', label: '餐饮', order: 0 },
  { group: 'transaction_category_expense', code: '交通', label: '交通', order: 1 },
  { group: 'transaction_category_expense', code: '购物', label: '购物', order: 2 },
  { group: 'transaction_category_expense', code: '住房', label: '住房', order: 3 },
  { group: 'transaction_category_expense', code: '娱乐', label: '娱乐', order: 4 },
  { group: 'transaction_category_expense', code: '医疗', label: '医疗', order: 5 },
  { group: 'transaction_category_expense', code: '教育', label: '教育', order: 6 },
  { group: 'transaction_category_expense', code: '通讯', label: '通讯', order: 7 },
  { group: 'transaction_category_expense', code: '水电燃', label: '水电燃', order: 8 },
  { group: 'transaction_category_expense', code: '育儿', label: '育儿', order: 9 },
  { group: 'transaction_category_expense', code: '服饰', label: '服饰', order: 10 },
  { group: 'transaction_category_expense', code: '保险', label: '保险', order: 11 },
  { group: 'transaction_category_expense', code: '宠物', label: '宠物', order: 12 },
  { group: 'transaction_category_expense', code: '日用百货', label: '日用百货', order: 13 },
  { group: 'transaction_category_expense', code: '人情往来', label: '人情往来', order: 14 },
  { group: 'transaction_category_expense', code: '其他支出', label: '其他支出', order: 99 },
  // 交易分类 - 不计收支（转账）
  { group: 'transaction_category_transfer', code: '转账', label: '转账', order: 0 },
  { group: 'transaction_category_transfer', code: '投资理财', label: '投资理财', order: 1 },
  { group: 'transaction_category_transfer', code: '信用借还', label: '信用借还', order: 2 },
  { group: 'transaction_category_transfer', code: '定投', label: '定投', order: 3 },
]

export async function seedDefaults() {
  const configCount = await prisma.systemConfig.count()
  if (configCount === 0) {
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      await prisma.systemConfig.create({ data: { key, value } })
    }
  }

  const dictCount = await prisma.dictionary.count()
  if (dictCount === 0) {
    for (const item of DEFAULT_DICTIONARIES) {
      await prisma.dictionary.create({ data: item })
    }
  }
}
