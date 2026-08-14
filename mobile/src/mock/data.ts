import type { AccountItem, BudgetItem, Category, RadarMetric, RecordItem, RecordSummary, Server } from '@/types';

// 分类(图标用 lucide 名称,由组件映射)
export const mockCategories: Category[] = [
  { code: '餐饮', label: '餐饮', type: 'EXPENSE', icon: 'utensils' },
  { code: '购物', label: '购物', type: 'EXPENSE', icon: 'shopping-bag' },
  { code: '交通', label: '交通', type: 'EXPENSE', icon: 'car' },
  { code: '住房', label: '住房', type: 'EXPENSE', icon: 'home' },
  { code: '教育', label: '教育', type: 'EXPENSE', icon: 'book-open' },
  { code: '医疗', label: '医疗', type: 'EXPENSE', icon: 'heart-pulse' },
  { code: '娱乐', label: '娱乐', type: 'EXPENSE', icon: 'gamepad-2' },
  { code: '保险', label: '保险', type: 'EXPENSE', icon: 'shield' },
  { code: '工资', label: '工资', type: 'INCOME', icon: 'wallet' },
  { code: '奖金', label: '奖金', type: 'INCOME', icon: 'gift' },
  { code: '投资收益', label: '投资收益', type: 'INCOME', icon: 'trending-up' },
  { code: '分红', label: '分红', type: 'INCOME', icon: 'landmark' },
];

export const mockAccounts: AccountItem[] = [
  { id: 'a1', name: '工资卡', type: 'BANK_DEBIT', balance: 12860.5, initialBalance: 0, bankName: '工商银行', status: 'ACTIVE' },
  { id: 'a2', name: '支付宝', type: 'ALIPAY', balance: 3450.2, initialBalance: 0, bankName: null, status: 'ACTIVE' },
  { id: 'a3', name: '微信零钱', type: 'WECHAT', balance: 880, initialBalance: 0, bankName: null, status: 'ACTIVE' },
  { id: 'a4', name: '信用卡', type: 'CREDIT_CARD', balance: -2300, initialBalance: 5000, bankName: '建设银行', status: 'ACTIVE' },
  { id: 'a5', name: '基金账户', type: 'INVESTMENT', balance: 52000, initialBalance: 0, bankName: null, status: 'ACTIVE' },
  { id: 'a6', name: '现金', type: 'CASH', balance: 600, initialBalance: 0, bankName: null, status: 'ACTIVE' },
];

export const mockRecords: RecordItem[] = [
  { id: 'r1', type: 'EXPENSE', amount: 58.5, date: '2026-08-14', remark: '午餐', categoryCode: '餐饮', categoryName: '餐饮', accountId: 'a2', accountName: '支付宝', ownerName: '我', tags: [] },
  { id: 'r2', type: 'EXPENSE', amount: 129, date: '2026-08-14', remark: '超市购物', categoryCode: '购物', categoryName: '购物', accountId: 'a3', accountName: '微信零钱', ownerName: '我', tags: [] },
  { id: 'r3', type: 'INCOME', amount: 15000, date: '2026-08-13', remark: '8月工资', categoryCode: '工资', categoryName: '工资', accountId: 'a1', accountName: '工资卡', ownerName: '我', tags: [] },
  { id: 'r4', type: 'EXPENSE', amount: 320, date: '2026-08-12', remark: '加油', categoryCode: '交通', categoryName: '交通', accountId: 'a2', accountName: '支付宝', ownerName: '我', tags: [] },
  { id: 'r5', type: 'EXPENSE', amount: 45, date: '2026-08-11', remark: null, categoryCode: '娱乐', categoryName: '娱乐', accountId: 'a2', accountName: '支付宝', ownerName: '我', tags: [] },
  { id: 'r6', type: 'EXPENSE', amount: 2600, date: '2026-08-10', remark: '房租', categoryCode: '住房', categoryName: '住房', accountId: 'a1', accountName: '工资卡', ownerName: '我', tags: [] },
  { id: 'r7', type: 'INCOME', amount: 800, date: '2026-08-08', remark: null, categoryCode: '投资收益', categoryName: '投资收益', accountId: 'a5', accountName: '基金账户', ownerName: '我', tags: [] },
  { id: 'r8', type: 'EXPENSE', amount: 180, date: '2026-08-07', remark: '体检', categoryCode: '医疗', categoryName: '医疗', accountId: 'a1', accountName: '工资卡', ownerName: '我', tags: [] },
];

export const mockSummary: RecordSummary = {
  income: 15800,
  expense: 3332.5,
  transfer: 0,
  netIncome: 12467.5,
};

export const mockBudgets: BudgetItem[] = [
  { id: 'b1', name: '餐饮', categoryCode: '餐饮', amount: 2000, actualAmount: 1860, year: 2026, month: 8 },
  { id: 'b2', name: '购物', categoryCode: '购物', amount: 1500, actualAmount: 1420, year: 2026, month: 8 },
  { id: 'b3', name: '交通', categoryCode: '交通', amount: 800, actualAmount: 320, year: 2026, month: 8 },
  { id: 'b4', name: '娱乐', categoryCode: '娱乐', amount: 500, actualAmount: 45, year: 2026, month: 8 },
];

export const mockMonthlyTrend = {
  months: ['9月', '10月', '11月', '12月', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'],
  income: [12000, 12000, 12800, 13000, 12600, 12000, 13200, 12800, 13000, 13500, 13200, 15800],
  expense: [5200, 4800, 5600, 6200, 8800, 4300, 5100, 4700, 5300, 5900, 5100, 3332],
};

export const mockRadar: RadarMetric[] = [
  { name: '应急能力', value: 78, detail: '备用金可覆盖 4.2 个月支出' },
  { name: '偿债压力', value: 100, detail: '无贷款,无负债压力' },
  { name: '杠杆水平', value: 88, detail: '负债率 8.1%' },
  { name: '储蓄能力', value: 82, detail: '储蓄率 35.2%' },
  { name: '投资积累', value: 64, detail: '投资占净资产 42%' },
  { name: '财务自由度', value: 30, detail: '被动收入覆盖支出 18%' },
  { name: '保障充足度', value: 55, detail: '保费占收入 6.2%' },
];

export const mockServers: Server[] = [
  { id: 's1', name: '演示站', baseUrl: 'https://demo.homibook.com' },
  { id: 's2', name: '本地开发', baseUrl: 'http://192.168.1.100:3002' },
  { id: 's3', name: '自建服务器', baseUrl: 'https://my.homibook.cn' },
];

export const mockAuth = {
  username: 'demo',
  nickname: '奶爸记账',
  isLoggedIn: false,
  serverId: null,
  remember: true,
};